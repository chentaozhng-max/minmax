/**
 * 问卷的纯规则层。
 *
 * 这里只做四件事，全部是纯函数：
 *   1. 归一化：把模型/表单/文档里来的脏数据收成统一形状
 *   2. 校验：题目能不能用、答卷合不合法、能不能发布
 *   3. 规则版生成：没有模型时，从文档文本里按编号/选项/问号拆题
 *   4. 判定：分数与通过线的关系、达标人数统计
 *
 * 不碰数据库、不调模型、不认识 HTTP —— 与 booking-rules / experiment-rules 同一路数。
 */

import type { Rejection } from "@/domain/booking-rules";

export const QuestionType = {
  SINGLE: "SINGLE",
  MULTI: "MULTI",
  SCALE: "SCALE",
  TEXT: "TEXT",
} as const;
export type QuestionType = (typeof QuestionType)[keyof typeof QuestionType];

export const QUESTION_TYPE_LABEL: Record<QuestionType, string> = {
  SINGLE: "单选",
  MULTI: "多选",
  SCALE: "量表",
  TEXT: "填空",
};

/** 一份问卷最多多少题 —— 超过这个数，被试填不完，主试也看不过来 */
export const MAX_QUESTIONS = 40;
/** 单选题最多几个选项 */
export const MAX_OPTIONS = 10;
/** 题干长度上限（防止把整段材料塞进标题） */
export const MAX_QUESTION_TITLE = 200;
/** 默认量表区间 */
export const DEFAULT_SCALE_MIN = 1;
export const DEFAULT_SCALE_MAX = 5;

export type QuestionDraft = {
  type: QuestionType;
  title: string;
  required: boolean;
  /** 选择题选项；量表/填空为空数组 */
  options: string[];
  scaleMin: number | null;
  scaleMax: number | null;
};

export type QuestionnaireDraft = {
  title: string;
  intro: string;
  questions: QuestionDraft[];
};

/** 计分只需要题目的这几个字段，不必依赖完整记录 */
export type QuestionForScoring = {
  id: string;
  type: string;
  title: string;
  options: string[];
};

export type AnswerValue = string | string[] | number;
export type AnswerMap = Record<string, AnswerValue>;

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function asType(value: unknown): QuestionType {
  const raw = str(value).toUpperCase();
  if (raw === "MULTI" || raw === "MULTIPLE") return QuestionType.MULTI;
  if (raw === "SCALE" || raw === "RATING" || raw === "LIKERT") return QuestionType.SCALE;
  if (raw === "TEXT" || raw === "INPUT" || raw === "TEXTAREA") return QuestionType.TEXT;
  return QuestionType.SINGLE;
}

/** 选项去重去空，保持原顺序 */
export function normalizeOptions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const text = str(item).slice(0, 80);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= MAX_OPTIONS) break;
  }
  return out;
}

/** 把任意来源的一条题目收成合法形状；题干为空返回 null（调用方直接丢掉） */
export function normalizeQuestion(raw: unknown): QuestionDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const input = raw as Record<string, unknown>;
  const title = str(input.title ?? input.question ?? input.label).slice(0, MAX_QUESTION_TITLE);
  if (!title) return null;

  const type = asType(input.type);
  const options = normalizeOptions(input.options ?? input.choices);

  if (type === QuestionType.SINGLE || type === QuestionType.MULTI) {
    // 选择题不足两个选项就没有意义，降级成填空而不是丢掉（主试还能改）
    if (options.length < 2) {
      return { type: QuestionType.TEXT, title, required: input.required !== false, options: [], scaleMin: null, scaleMax: null };
    }
  }

  const isScale = type === QuestionType.SCALE;
  const scaleMin = isScale ? clampInt(input.scaleMin, 0, 10, DEFAULT_SCALE_MIN) : null;
  const scaleMax = isScale ? clampInt(input.scaleMax, 2, 10, DEFAULT_SCALE_MAX) : null;

  return {
    type,
    title,
    required: input.required !== false,
    options: type === QuestionType.SINGLE || type === QuestionType.MULTI ? options : [],
    scaleMin,
    scaleMax: isScale && scaleMin !== null && scaleMax !== null && scaleMax <= scaleMin ? scaleMin + 4 : scaleMax,
  };
}

/** 归一化整份草稿：丢空题、截断到上限、补默认标题 */
export function normalizeQuestionnaireDraft(raw: unknown, fallbackTitle = "实验问卷"): QuestionnaireDraft {
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const rawQuestions = Array.isArray(input.questions) ? input.questions : [];
  const questions: QuestionDraft[] = [];
  for (const item of rawQuestions) {
    const q = normalizeQuestion(item);
    if (q) questions.push(q);
    if (questions.length >= MAX_QUESTIONS) break;
  }
  return {
    title: str(input.title).slice(0, 120) || fallbackTitle,
    intro: str(input.intro).slice(0, 1000),
    questions,
  };
}

/** 能不能发布 —— 返回第一条阻止发布的理由 */
export function assertQuestionnaireReady(draft: {
  title: string;
  intro?: string;
  questions: { title: string; type: string; options: string[] }[];
}): Rejection | null {
  if (!draft.title.trim()) return { status: 400, message: "问卷需要一个标题" };
  if (draft.questions.length === 0) return { status: 400, message: "问卷至少需要一道题" };
  if (draft.questions.length > MAX_QUESTIONS) {
    return { status: 400, message: `一份问卷最多 ${MAX_QUESTIONS} 题` };
  }
  const empty = draft.questions.findIndex((q) => !q.title.trim());
  if (empty >= 0) return { status: 400, message: `第 ${empty + 1} 题还没有题干` };
  const badChoice = draft.questions.findIndex(
    (q) => (q.type === QuestionType.SINGLE || q.type === QuestionType.MULTI) && q.options.length < 2,
  );
  if (badChoice >= 0) {
    return { status: 400, message: `第 ${badChoice + 1} 题是选择题，至少需要两个选项` };
  }
  return null;
}

/* ─────────────────────────────────────────────
 * 规则版生成：没有模型时，从文档正文里拆题
 * ───────────────────────────────────────────── */

const QUESTION_START = /^(?:第\s*)?(\d{1,2})\s*[.、．)）]\s*(.+)$/;
const Q_PREFIX = /^[Qq](\d{1,2})\s*[.、．:：)）]\s*(.+)$/;
const OPTION_LINE = /^[(（]?([A-Ha-h])[)）.、．]\s*(.+)$/;
const SECTION_LINE = /^(第[一二三四五六七八九十]+[部分章节]|[一二三四五六七八九十]+[、.])/;

function looksLikeScale(text: string): boolean {
  return /(量表|1\s*[-~—至到]\s*5|1\s*[-~—至到]\s*7|五级|七级|李克特|likert)/i.test(text);
}

function looksLikeMulti(text: string): boolean {
  return /(多选|可多选|选择所有|不限项|多选一|选出所有)/.test(text);
}

function looksLikeText(text: string): boolean {
  return /(简答|简述|请说明|请描述|为什么|原因|填空|补充说明|请写|谈谈)/.test(text);
}

/**
 * 从纯文本里拆出一份问卷草稿。
 *
 * 策略刻意保守：只认「编号 + 选项」这种结构清晰的块，认不出来就返回空，
 * 让主试在编辑器里手写。硬凑出来的题比没有题更烦人 —— 用户以为 AI 读懂了，
 * 实际是把目录/页眉当成了题目。
 */
export function composeQuestionnaireFromText(text: string, title = "实验问卷"): QuestionnaireDraft {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const questions: QuestionDraft[] = [];
  let current: { title: string; options: string[] } | null = null;

  const flush = () => {
    if (!current) return;
    const q = buildQuestion(current.title, current.options);
    if (q) questions.push(q);
    current = null;
  };

  for (const line of lines) {
    if (questions.length >= MAX_QUESTIONS) break;

    const start = line.match(QUESTION_START) ?? line.match(Q_PREFIX);
    if (start) {
      const body = start[2].trim();
      // 「1. 实验目的」这种章节标题不是题，靠长度和是否带问号粗筛
      if (body.length >= 4) {
        flush();
        current = { title: body, options: [] };
        continue;
      }
    }

    if (current) {
      const option = line.match(OPTION_LINE);
      if (option) {
        current.options.push(option[2].trim());
        continue;
      }
      // 同一题的续行（题干被换行拆开），拼回去
      if (!SECTION_LINE.test(line) && current.options.length === 0 && line.length <= 60) {
        current.title = `${current.title}${current.title.endsWith("？") || current.title.endsWith("?") ? "" : " "}${line}`;
        continue;
      }
    }

    // 独立成行的问句：没有编号也算一题
    if (/[？?]$/.test(line) && line.length <= 120) {
      flush();
      const q = buildQuestion(line, []);
      if (q) questions.push(q);
    }
  }
  flush();

  return { title, intro: "", questions: dedupeQuestions(questions) };
}

function buildQuestion(title: string, options: string[]): QuestionDraft | null {
  const clean = title.replace(/^[Q\d.、．)）\s]+/, "").trim().slice(0, MAX_QUESTION_TITLE);
  if (clean.length < 4) return null;
  if (options.length >= 2) {
    return {
      type: looksLikeMulti(clean) ? QuestionType.MULTI : QuestionType.SINGLE,
      title: clean,
      required: true,
      options: normalizeOptions(options),
      scaleMin: null,
      scaleMax: null,
    };
  }
  if (looksLikeScale(clean)) {
    return {
      type: QuestionType.SCALE,
      title: clean,
      required: true,
      options: [],
      scaleMin: DEFAULT_SCALE_MIN,
      scaleMax: DEFAULT_SCALE_MAX,
    };
  }
  if (looksLikeText(clean) || /[？?]$/.test(clean)) {
    return { type: QuestionType.TEXT, title: clean, required: true, options: [], scaleMin: null, scaleMax: null };
  }
  return null;
}

function dedupeQuestions(questions: QuestionDraft[]): QuestionDraft[] {
  const seen = new Set<string>();
  return questions.filter((q) => {
    if (seen.has(q.title)) return false;
    seen.add(q.title);
    return true;
  });
}

/* ─────────────────────────────────────────────
 * 答卷校验
 * ───────────────────────────────────────────── */

/**
 * 校验提交的答案。返回第一条问题，null 表示可以入库。
 *
 * 只校验「必填有没有填」和「选项在不在范围内」——
 * 不做「答得对不对」，那是计分 agent 的事。
 */
export function validateAnswers(questions: QuestionForScoring[], answers: AnswerMap): Rejection | null {
  for (const [index, question] of questions.entries()) {
    const value = answers[question.id];
    const empty =
      value === undefined ||
      value === null ||
      (typeof value === "string" && !value.trim()) ||
      (Array.isArray(value) && value.length === 0);

    const required = (question as QuestionForScoring & { required?: boolean }).required !== false;
    if (empty) {
      if (required) return { status: 400, message: `第 ${index + 1} 题还没有回答` };
      continue;
    }

    if (question.type === QuestionType.SINGLE) {
      if (typeof value !== "string" || !question.options.includes(value)) {
        return { status: 400, message: `第 ${index + 1} 题的选项不在范围内` };
      }
    }
    if (question.type === QuestionType.MULTI) {
      const list = Array.isArray(value) ? value : [value];
      if (list.some((item) => typeof item !== "string" || !question.options.includes(item))) {
        return { status: 400, message: `第 ${index + 1} 题的选项不在范围内` };
      }
    }
    if (question.type === QuestionType.SCALE) {
      const n = Number(value);
      const min = (question as QuestionForScoring & { scaleMin?: number | null }).scaleMin ?? DEFAULT_SCALE_MIN;
      const max = (question as QuestionForScoring & { scaleMax?: number | null }).scaleMax ?? DEFAULT_SCALE_MAX;
      if (!Number.isFinite(n) || n < min || n > max) {
        return { status: 400, message: `第 ${index + 1} 题需要填 ${min}–${max} 之间的数字` };
      }
    }
  }
  return null;
}

/** 把答案转成给模型看的可读文本（选项值本身就是文本，这里是统一格式） */
export function formatAnswer(question: QuestionForScoring, value: AnswerValue | undefined): string {
  if (value === undefined || value === null || value === "") return "（未作答）";
  if (Array.isArray(value)) return value.length ? value.join("、") : "（未作答）";
  return String(value);
}

/* ─────────────────────────────────────────────
 * 分数判定
 * ───────────────────────────────────────────── */

export type PassState = "PASS" | "FAIL" | "UNKNOWN";

/** 分数与通过线的关系。分数未知时一律 UNKNOWN，不能默认「通过」 */
export function passState(score: number | null | undefined, passScore: number | null | undefined): PassState {
  if (score === null || score === undefined) return "UNKNOWN";
  if (passScore === null || passScore === undefined) return "UNKNOWN";
  return score >= passScore ? "PASS" : "FAIL";
}

export type ResponseScoreSummary = {
  total: number;
  scored: number;
  unscored: number;
  passed: number;
  failed: number;
  unknown: number;
  average: number | null;
  highest: number | null;
  lowest: number | null;
};

/** 后台顶部的统计条 —— 只统计有分数的，未打分的单独计数 */
export function summarizeScores(
  responses: { score: number | null; passed: boolean | null }[],
  passScore: number | null,
): ResponseScoreSummary {
  const scored = responses.filter((r) => typeof r.score === "number") as { score: number }[];
  const values = scored.map((r) => r.score);
  const passed = responses.filter((r) => r.passed === true || (r.passed === null && passState(r.score, passScore) === "PASS")).length;
  const failed = responses.filter((r) => r.passed === false || (r.passed === null && passState(r.score, passScore) === "FAIL")).length;
  return {
    total: responses.length,
    scored: scored.length,
    unscored: responses.length - scored.length,
    passed,
    failed,
    unknown: responses.length - passed - failed,
    average: values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null,
    highest: values.length ? Math.max(...values) : null,
    lowest: values.length ? Math.min(...values) : null,
  };
}

/** 达标名单：分数 ≥ 通过线，且没被主试手动否掉 */
export function selectQualified<T extends { score: number | null; passed: boolean | null }>(
  responses: T[],
  passScore: number | null,
): T[] {
  if (passScore === null) return [];
  return responses.filter((r) => r.passed === true || (r.passed === null && passState(r.score, passScore) === "PASS"));
}

/** 一句话概括筛选条件，用于通知文案与确认弹窗 */
export function thresholdText(passScore: number | null): string {
  return passScore === null ? "未设置分数线" : `得分 ≥ ${passScore} 分`;
}
