/**
 * 发布助手编排 —— 主试侧，「一句话 → 一份能发的实验草稿」。
 *
 * ## 与另外两个 agent 的分工
 *
 *   server/agent.ts          房间：锁死一门实验，7 个工具排期/预约
 *   server/assistant-agent.ts 门厅：跨实验搜索，只有 search_experiments
 *   本文件                    发布台：还没有实验，只有 write_experiment_draft
 *
 * 三个上下文的形状不同，所以是三份编排，不是一份「可选 experiment」的万能编排。
 *
 * ## 这边的 AI 权限比另外两个都窄
 *
 * 它不能建实验、不能发布、不能查库 —— 只输出一份字段草稿。
 * 真正的落库仍然走 `/api/experiments` → `publishExperiment()`，
 * 与手动填写完全同一条路。模型写错了顶多是草稿难看，不会产生一条脏数据。
 */
import {
  addDraftDays,
  composeDraftFromBrief,
  draftToday,
  normalizeExperimentDraft,
  reviewExperimentDraft,
  type DraftIssue,
  type ExperimentDraft,
} from "@/domain/experiment-draft";
import { getLlm, type LlmMessage } from "@/adapters/llm";
import { createDraftToolRegistry } from "@/tools";
import type { DraftContext } from "@/tools/draft-context";

const toolRegistry = createDraftToolRegistry();

/** 最多带几轮历史。发布场景通常两三轮就定了，太长只会让模型跑偏 */
const MAX_HISTORY = 6;

export type DraftTurn = { role: "user" | "assistant"; content: string };

export type GenerateDraftInput = {
  brief: string;
  /** 上一版草稿：用户说「再便宜点」时需要它，否则模型不知道在改什么 */
  previousDraft?: ExperimentDraft | null;
  history?: DraftTurn[];
  now?: Date;
};

export type GenerateDraftResult = {
  reply: string;
  draft: ExperimentDraft;
  issues: DraftIssue[];
  /** 模型/规则替用户做的假设，页面逐条提示核对 */
  assumptions: string[];
  mode: "llm" | "fallback";
  notice: string | null;
};

export async function generatePublishDraft(
  input: GenerateDraftInput,
): Promise<GenerateDraftResult> {
  const now = input.now ?? new Date();
  const ctx: DraftContext = { now, anchorDate: addDraftDays(draftToday(now), 1) };
  const brief = input.brief.trim();

  if (!getLlm().configured()) {
    return fallback(brief, ctx, "模型还没配置，先用规则起了一版，字段都是全的。");
  }

  try {
    const reply = await getLlm().chat({
      messages: buildMessages(brief, input),
      tools: toolRegistry.specs(),
      temperature: 0.4,
      // 草稿比聊天长得多：说明 300 字 + 要求 + 计划，800 token 会被截断
      maxTokens: 1400,
    });

    const call = reply.toolCalls.find((c) => c.name === "write_experiment_draft");
    if (call) {
      const result = await toolRegistry.exec(call.name, call.args, { ctx, sink: {}, now });
      const draft = result.draft as ExperimentDraft | undefined;
      if (result.ok && draft) {
        return {
          reply: reply.content || "写好了，核对一下再发布。",
          draft,
          issues: (result.issues as DraftIssue[] | undefined) ?? reviewExperimentDraft(draft, { now }),
          assumptions: (result.notes as string[] | undefined) ?? [],
          mode: "llm",
          notice: null,
        };
      }
    }

    // 有的模型不调工具、直接把 JSON 写在正文里 —— 能救就救，救不回来再降级
    const inline = extractJson(reply.content);
    if (inline) {
      const normalized = normalizeExperimentDraft(inline, {
        now,
        anchorDate: ctx.anchorDate,
      });
      return {
        reply: reply.content.replace(/```[\s\S]*?```/g, "").trim() || "写好了，核对一下再发布。",
        draft: normalized.draft,
        issues: normalized.issues,
        assumptions: normalized.notes,
        mode: "llm",
        notice: null,
      };
    }

    return fallback(brief, ctx, "模型这轮没给出结构化草稿，我先按规则起了一版。");
  } catch (error) {
    // 超时 / 429 / 返回体异常：降级而不是把错误甩给主试
    console.error("[publish-agent] llm failed", error instanceof Error ? error.message : error);
    return fallback(brief, ctx, "模型刚才没响应，先用规则起了一版。");
  }
}

/* ---------------- 内部 ---------------- */

function fallback(brief: string, ctx: DraftContext, notice: string): GenerateDraftResult {
  const { draft, issues, assumptions } = composeDraftFromBrief(brief, {
    now: ctx.now,
    anchorDate: ctx.anchorDate,
  });
  return {
    reply: `我先按你说的起了一版：${draft.title}。地点还空着，换成真实房间就能发。`,
    draft,
    issues,
    assumptions,
    mode: "fallback",
    notice,
  };
}

function buildMessages(brief: string, input: GenerateDraftInput): LlmMessage[] {
  const history = (input.history ?? []).slice(-MAX_HISTORY);
  const messages: LlmMessage[] = [{ role: "system", content: SYSTEM_PROMPT }];

  // 历史里的助手消息只保留文字：上一版草稿单独以 JSON 附在最后，
  // 避免同一份内容在上下文里出现两次。
  for (const turn of history) {
    messages.push({ role: turn.role, content: turn.content });
  }

  if (input.previousDraft) {
    messages.push({
      role: "user",
      content: `上一版草稿（JSON，仅供参考，不要原样复述）：\n${compactDraft(input.previousDraft)}`,
    });
  }

  messages.push({ role: "user", content: brief });
  return messages;
}

/** 只留模型改稿需要的字段：60 个时段全塞进去会吃掉大半上下文 */
function compactDraft(draft: ExperimentDraft): string {
  return JSON.stringify({
    title: draft.title,
    description: draft.description,
    location: draft.location,
    durationMin: draft.durationMin,
    rewardYuan: draft.rewardYuan,
    type: draft.type,
    groupSize: draft.groupSize,
    requirements: draft.requirements,
    minCreditScore: draft.minCreditScore,
    needsVerification: draft.needsVerification,
    slotPlan: draft.slotPlan ?? null,
    slotCount: Array.isArray(draft.slots) ? draft.slots.length : 0,
  });
}

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

/**
 * 系统提示词。
 *
 * 三条是硬约束，其余是文风：
 *   1. 必须调工具（不调的话页面拿不到结构化字段）
 *   2. 不许编房间号/伦理批号（这类信息编出来会直接进公开招募页）
 *   3. 时段只给星期，不给日期（日期换算在领域层）
 */
const SYSTEM_PROMPT = [
  "你是「PsyMatch」的发布助手，帮心理学主试把一句话想法写成一条完整、可直接发布的实验招募信息。",
  "",
  "## 必须做的事",
  "1. 每次回复都要调用 write_experiment_draft，把完整草稿放在工具参数里；正文只写 2–3 句。",
  "2. 字段一个都不能少：标题、说明、地点、时长、报酬、类型、团体人数、参加要求、信誉门槛、认证要求、时段计划。",
  "3. 用户没说的地方按心理实验的常见做法给默认值，并在 notes 里逐条写清「我假设了什么」。",
  "",
  "## 绝对不能做的事",
  "- 不能编造具体房间号。用户没提就填「待补充」。",
  "- 不能编造伦理批号、导师姓名、机构承诺、数据保密认证 —— 这些不是你能生成的。",
  "- 不能自己算日期。时段一律用 slotPlan（weekdays 1–7、startTime、endTime、weeks、anchor）。",
  "- 不能写「名额有限速来」「最后 X 个名额」这类招募话术。",
  "",
  "## 怎么写",
  "- 标题 6–24 字，写清研究主题，不要加感叹号和 emoji。",
  "- 说明 120–320 字，分段写：要做什么、要多久、报酬怎么结算、需要注意什么。",
  "- 报酬没说就按 30 元/半小时估；时长没说按 30 分钟。",
  "- 参加要求只写能从用户描述里推出来的；推不出来就留空字符串。",
  "- 全程中文，正文口语、简短，不要复述整份草稿（卡片会显示）。",
].join("\n");
