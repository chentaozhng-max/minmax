/**
 * 问卷相关的三个模型编排：生成、计分、建议分数线。
 *
 * 与 publish-agent 一样的原则：
 *   - 模型只产出「结构化草稿/分数」，落库仍走正常用例
 *   - 无 key、超时、返回不成形 → 一律降级，不把异常甩给用户
 *   - 降级不是「什么都不做」：生成有规则版拆题，计分则明确返回「待人工评分」
 */
import { getLlm, type LlmMessage } from "@/adapters/llm";
import {
  composeQuestionnaireFromText,
  normalizeQuestionnaireDraft,
  passState,
  type AnswerMap,
  type QuestionnaireDraft,
  type QuestionForScoring,
} from "@/domain/questionnaire";
import type { QuestionnaireRecord } from "@/domain/ports/questionnaire";

/** 送进模型的材料上限：再长就只取前面这些字 */
const MAX_SOURCE_CHARS = 12_000;

/**
 * undici 抛的 "fetch failed" 本身没有信息量，真正的原因（超时 / DNS / 证书）在 cause 里。
 * 只打 message 会让人以为「网络好好的为什么说失败」，所以把 cause 一起带出来。
 */
function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = (error as Error & { cause?: unknown }).cause;
  if (cause instanceof Error) return `${error.message}（${cause.name}: ${cause.message}）`;
  if (cause) return `${error.message}（${String(cause)}）`;
  return error.message;
}

export type GenerateQuestionnaireInput = {
  /** 从文档里解析出的正文 */
  text?: string;
  /** 主试口头补充的要求（没有文件时也可能只有这句话） */
  brief?: string;
  title: string;
  /** 上一版草稿：用户说「再加两道量表题」时需要 */
  previous?: QuestionnaireDraft | null;
};

export type GenerateQuestionnaireResult = {
  draft: QuestionnaireDraft;
  mode: "llm" | "fallback";
  notice: string | null;
};

export async function generateQuestionnaireDraft(
  input: GenerateQuestionnaireInput,
): Promise<GenerateQuestionnaireResult> {
  const text = (input.text ?? "").trim();
  const brief = (input.brief ?? "").trim();
  const fallbackDraft = buildFallbackDraft(text, brief, input.title);

  if (!getLlm().configured()) {
    return {
      draft: fallbackDraft,
      mode: "fallback",
      notice: "模型还没配置，先按文档里的编号和选项拆了一版，题量和措辞需要你改。",
    };
  }

  if (!text && !brief) {
    return {
      draft: fallbackDraft,
      mode: "fallback",
      notice: "没有可读的材料，先给了一个空白起步版。",
    };
  }

  try {
    const reply = await getLlm().chat({
      messages: buildGenerateMessages(input, text, brief),
      tools: [],
      temperature: 0.35,
      maxTokens: 2200,
    });
    const parsed = extractJson(reply.content);
    if (!parsed) {
      return {
        draft: fallbackDraft,
        mode: "fallback",
        notice: "模型这轮没给出结构化题目，先按规则拆了一版。",
      };
    }
    const draft = normalizeQuestionnaireDraft(parsed, input.title);
    if (draft.questions.length === 0) {
      return {
        draft: fallbackDraft,
        mode: "fallback",
        notice: "模型没生成出可用题目，先按规则拆了一版。",
      };
    }
    return { draft, mode: "llm", notice: null };
  } catch (error) {
    console.error("[questionnaire-agent] generate failed", describeError(error));
    return {
      draft: fallbackDraft,
      mode: "fallback",
      notice: "模型刚才没响应，先按规则拆了一版。",
    };
  }
}

function buildFallbackDraft(text: string, brief: string, title: string): QuestionnaireDraft {
  if (text) return composeQuestionnaireFromText(text, title);
  if (brief) {
    // 只有一句话要求时，给一道开放题起步，主试再补
    return {
      title,
      intro: "",
      questions: [
        {
          type: "TEXT",
          title: brief.slice(0, 200),
          required: true,
          options: [],
          scaleMin: null,
          scaleMax: null,
        },
      ],
    };
  }
  return { title, intro: "", questions: [] };
}

function buildGenerateMessages(
  input: GenerateQuestionnaireInput,
  text: string,
  brief: string,
): LlmMessage[] {
  const parts: string[] = [];
  parts.push(`实验标题：${input.title}`);
  if (text) parts.push(`## 材料原文\n${text.slice(0, MAX_SOURCE_CHARS)}`);
  if (brief) parts.push(`## 主试的补充要求\n${brief}`);
  if (input.previous) {
    parts.push(`## 上一版题目（在此基础上修改）\n${JSON.stringify(input.previous.questions)}`);
  }

  return [
    { role: "system", content: GENERATE_SYSTEM_PROMPT },
    { role: "user", content: parts.join("\n\n") },
  ];
}

/* ─────────────────────────────────────────────
 * 计分
 * ───────────────────────────────────────────── */

export type ScoreResponseInput = {
  questionnaire: Pick<QuestionnaireRecord, "title" | "scoringRule" | "passScore">;
  questions: QuestionForScoring[];
  answers: AnswerMap;
  /** 题目 id → 答案的可读文本，由调用方用 formatAnswer 生成 */
  rendered: { title: string; answer: string }[];
};

export type ScoreResponseResult = {
  score: number | null;
  reason: string;
  mode: "llm" | "fallback";
};

export async function scoreQuestionnaireResponse(
  input: ScoreResponseInput,
): Promise<ScoreResponseResult> {
  if (!getLlm().configured()) {
    return { score: null, reason: "模型未配置，需要主试手动评分", mode: "fallback" };
  }

  const answerText = input.rendered
    .map((item, index) => `${index + 1}. ${item.title}\n   答：${item.answer}`)
    .join("\n");

  const user = [
    `问卷：${input.questionnaire.title}`,
    input.questionnaire.scoringRule
      ? `评分要求：${input.questionnaire.scoringRule}`
      : "评分要求：按答案与实验目的的匹配程度打分，0–100。",
    input.questionnaire.passScore !== null
      ? `通过线：${input.questionnaire.passScore} 分`
      : "通过线：未设置",
    "",
    "答卷：",
    answerText,
  ].join("\n");

  try {
    const reply = await getLlm().chat({
      messages: [
        { role: "system", content: SCORE_SYSTEM_PROMPT },
        { role: "user", content: user },
      ],
      tools: [],
      temperature: 0.1,
      maxTokens: 500,
    });
    const parsed = extractJson(reply.content) as { score?: unknown; reason?: unknown } | null;
    const rawScore = Number(parsed?.score);
    if (!Number.isFinite(rawScore)) {
      return { score: null, reason: "模型没有给出有效分数，需要主试手动评分", mode: "fallback" };
    }
    const score = Math.max(0, Math.min(100, Math.round(rawScore)));
    const reason =
      typeof parsed?.reason === "string" && parsed.reason.trim()
        ? parsed.reason.trim().slice(0, 300)
        : "模型未给出理由";
    return { score, reason, mode: "llm" };
  } catch (error) {
    console.error("[questionnaire-agent] score failed", describeError(error));
    return { score: null, reason: "模型调用失败，需要主试手动评分", mode: "fallback" };
  }
}

/* ─────────────────────────────────────────────
 * 分数线建议
 * ───────────────────────────────────────────── */

export type SuggestThresholdInput = {
  goal: string;
  scores: number[];
  currentPassScore: number | null;
};

export type SuggestThresholdResult = {
  passScore: number | null;
  explanation: string;
  mode: "llm" | "fallback";
};

export async function suggestPassScore(
  input: SuggestThresholdInput,
): Promise<SuggestThresholdResult> {
  const direct = /(\d{1,3})\s*分/.exec(input.goal);
  if (direct) {
    const value = Math.max(0, Math.min(100, Number(direct[1])));
    return {
      passScore: value,
      explanation: `按你说的「${direct[0]}」设为 ${value} 分。当前已有 ${input.scores.length} 份答卷，其中 ${input.scores.filter((s) => s >= value).length} 份达标。`,
      mode: "fallback",
    };
  }

  if (!getLlm().configured()) {
    return {
      passScore: input.currentPassScore,
      explanation: "看不出具体分数，模型也没配置。可以直接填一个数字，比如 60。",
      mode: "fallback",
    };
  }

  try {
    const reply = await getLlm().chat({
      messages: [
        {
          role: "system",
          content:
            "你是实验主试的助手。用户会用一句话描述筛选要求，你要给出一个 0–100 的分数线。只输出 JSON：{\"passScore\": 数字, \"explanation\": \"一句话说明\"}。",
        },
        {
          role: "user",
          content: `要求：${input.goal}\n当前分数分布：${input.scores.slice(0, 50).join(", ") || "暂无答卷"}\n当前分数线：${input.currentPassScore ?? "未设置"}`,
        },
      ],
      tools: [],
      temperature: 0.1,
      maxTokens: 300,
    });
    const parsed = extractJson(reply.content) as { passScore?: unknown; explanation?: unknown } | null;
    const value = Number(parsed?.passScore);
    if (!Number.isFinite(value)) {
      return { passScore: input.currentPassScore, explanation: "模型没给出分数线，保持原值。", mode: "fallback" };
    }
    return {
      passScore: Math.max(0, Math.min(100, Math.round(value))),
      explanation:
        typeof parsed?.explanation === "string" && parsed.explanation.trim()
          ? parsed.explanation.trim()
          : `建议设为 ${Math.round(value)} 分`,
      mode: "llm",
    };
  } catch (error) {
    console.error("[questionnaire-agent] threshold failed", describeError(error));
    return {
      passScore: input.currentPassScore,
      explanation: "模型调用失败，分数线保持不变。",
      mode: "fallback",
    };
  }
}

/* ---------------- 内部 ---------------- */

function extractJson(text: string): unknown | null {
  if (!text) return null;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** 导出给测试用：分数与通过线的关系只在领域层判，这里不重复实现 */
export { passState };

const GENERATE_SYSTEM_PROMPT = [
  "你是「PsyMatch」的问卷设计助手，帮心理学主试把实验材料变成一份可以直接发给被试填的问卷。",
  "",
  "## 输出格式（只能输出 JSON，不要任何解释文字）",
  '{"title":"问卷标题","intro":"给被试的引导语，1-2 句","questions":[{"type":"SINGLE|MULTI|SCALE|TEXT","title":"题干","required":true,"options":["选项A","选项B"],"scaleMin":1,"scaleMax":5}]}',
  "",
  "## 硬约束",
  "1. 题目 6–15 道；材料里已有的题目优先原样保留，不要改写题意。",
  "2. 只问与实验筛选/分组真正相关的内容；不要问身份证号、家庭住址、银行卡等敏感信息。",
  "3. 选择题必须有 2–6 个互斥选项；量表题 scaleMin=1、scaleMax=5；填空题为开放题，options 留空。",
  "4. 不要编造材料里没有的测量工具名称、量表出处、伦理批号。",
  "5. 题干不超过 60 字，一题只问一件事，不要出现「以上都对」这类选项。",
  "",
  "## 语气",
  "对被测者说话，用「你」；不要用「受试者」；不要写「本问卷用于科研，请如实填写」这种套话超过一句。",
].join("\n");

const SCORE_SYSTEM_PROMPT = [
  "你是心理学实验的问卷评分员。按主试给出的评分要求给这份答卷打分。",
  "只输出 JSON：{\"score\": 0-100 的整数, \"reason\": \"不超过 60 字，说明扣分点\"}。",
  "评分要稳定：同样的答案每次应得到相近的分数。只依据评分要求，不要臆测被试的动机。",
  "如果某题未作答，按缺失处理并在 reason 里提一句，不要因此直接给 0 分。",
].join("\n");
