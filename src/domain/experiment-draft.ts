/**
 * 实验草稿 —— 领域层的「发布助手」与「发布前体检」共用的纯规则。
 *
 * 三种入口，同一份判断：
 *   1. 主试在发布助手说一句话 → 模型/规则生成草稿 → normalize
 *   2. 主试自己逐项填表单 → 点发布前 review 一次
 *   3. 主试从草稿回填表单 → 仍按同一套规则再体检
 *
 * 为什么放在领域层而不是页面里：
 *   「什么样的实验算填完了」是业务规则，不是 if。规则必须能在不连数据库、
 *   不调模型的情况下被测试；模型乱写时也得由这里兜住 —— 模型只负责写，
 *   不负责决定什么算合法。
 *
 * 这个文件里没有一行 IO：不查库、不发请求、不读环境变量。
 */

import { ExperimentType } from "@/domain/constants";

const DAY_MS = 24 * 60 * 60 * 1000;
const TZ_OFFSET_MS = 8 * 60 * 60 * 1000;

/** 与 createExperimentSchema / 发布用例保持一致的边界，改这里要同步那两处 */
export const DRAFT_LIMITS = {
  titleMin: 4,
  titleMax: 60,
  descriptionMin: 10,
  descriptionMax: 800,
  requirementsMax: 300,
  durationMin: 5,
  durationMax: 480,
  rewardMin: 1,
  rewardMax: 9999,
  groupMin: 2,
  groupMax: 30,
  maxSlots: 60,
} as const;

/** 地点占位符：模型不知道具体房间时留这个，发布前必须换掉 */
export const PLACEHOLDER_LOCATION = "待补充";

const LOCATION_PLACEHOLDER_RE = /待(补充|确认|定)|TBD|TODO|XXX/i;

/**
 * 地点是不是「待补充」这类占位词。
 *
 * 导出是因为表单要用它做当场提示：不能让主试填到第 3 步才发现
 * 地点还是助手留下的「待补充」。
 */
export function isPlaceholderLocation(location: string): boolean {
  return LOCATION_PLACEHOLDER_RE.test(location.trim());
}

export type DraftSlot = { startAt: string; endAt: string; capacity: number };

/** 时段计划：模型只给「星期 + 起止 + 周数」，具体日期由系统算 */
export type SlotPlan = {
  /** 1=周一 … 7=周日 */
  weekdays: number[];
  startTime: string;
  endTime: string;
  /** 连续几周，1–4 */
  weeks: number;
  /** TOMORROW = 从明天起算；NEXT_WEEK = 下周一起算 */
  anchor: "TOMORROW" | "NEXT_WEEK";
};

export type ExperimentDraft = {
  title: string;
  description: string;
  location: string;
  durationMin: number;
  rewardYuan: number;
  type: ExperimentType;
  groupSize: number | null;
  requirements: string;
  minCreditScore: number;
  needsVerification: boolean;
  slots: DraftSlot[];
  /** 由模型/规则给出的计划；主试手填的草稿为 null */
  slotPlan?: SlotPlan | null;
};

export type DraftIssueField =
  | "title"
  | "description"
  | "location"
  | "durationMin"
  | "rewardYuan"
  | "groupSize"
  | "requirements"
  | "minCreditScore"
  | "signupDeadline"
  | "slots";

export type DraftIssue = {
  field: DraftIssueField;
  /** block = 不能发布；warn = 能发但值得看一眼 */
  level: "block" | "warn";
  message: string;
};

export const DRAFT_FIELD_LABEL: Record<DraftIssueField, string> = {
  title: "实验标题",
  description: "实验说明",
  location: "地点",
  durationMin: "时长",
  rewardYuan: "报酬",
  groupSize: "团体人数",
  requirements: "参加要求",
  minCreditScore: "信誉门槛",
  signupDeadline: "报名截止",
  slots: "时段",
};

export const DRAFT_ISSUE_LEVEL_LABEL: Record<DraftIssue["level"], string> = {
  block: "待补",
  warn: "提醒",
};

/* ---------------- 日期（上海时区，无外部依赖） ---------------- */

/** 上海时区的今天，YYYY-MM-DD */
export function draftToday(now: Date): string {
  return new Date(now.getTime() + TZ_OFFSET_MS).toISOString().slice(0, 10);
}

/** 在 YYYY-MM-DD 上加天数（按上海日历日，不能直接取 UTC 日期） */
export function addDraftDays(dateStr: string, days: number): string {
  const base = new Date(`${dateStr}T00:00:00+08:00`);
  const shifted = new Date(base.getTime() + days * DAY_MS + TZ_OFFSET_MS);
  return shifted.toISOString().slice(0, 10);
}

/** 星期几：1=周一 … 7=周日 */
export function draftWeekday(dateStr: string): number {
  const d = new Date(`${dateStr}T12:00:00+08:00`).getUTCDay();
  return d === 0 ? 7 : d;
}

/** 所在周的周一 */
export function draftStartOfWeek(dateStr: string): string {
  return addDraftDays(dateStr, -(draftWeekday(dateStr) - 1));
}

function minutesOf(time: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

function isoAt(dateStr: string, minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hh = String(h).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  return new Date(`${dateStr}T${hh}:${mm}:00+08:00`).toISOString();
}

/* ---------------- 时段规划 ---------------- */

/**
 * 把「星期 + 起止 + 周数」摊成具体时段。
 *
 * 起算点放在明天而不是今天：今天剩下的时段往往已经来不及报名，
 * 生成一批当天上午的时段只会让主试手动删。
 */
export function planSlots(
  plan: SlotPlan,
  opts: { anchorDate: string; durationMin: number; capacity: number; maxSlots?: number },
): DraftSlot[] {
  const startMin = minutesOf(plan.startTime);
  const endMin = minutesOf(plan.endTime);
  if (startMin === null || endMin === null || endMin <= startMin) return [];

  const duration = Math.max(
    DRAFT_LIMITS.durationMin,
    Math.min(DRAFT_LIMITS.durationMax, Math.round(opts.durationMin)),
  );
  // 与批量生成同一规则：段长向上取整到半小时，格子永远落在整点/半点
  const step = Math.max(30, Math.ceil(duration / 30) * 30);
  const capacity = Math.max(1, Math.min(50, Math.round(opts.capacity)));
  const maxSlots = opts.maxSlots ?? DRAFT_LIMITS.maxSlots;

  const weekdays = new Set(
    plan.weekdays.filter((d) => Number.isInteger(d) && d >= 1 && d <= 7),
  );
  if (weekdays.size === 0) return [];

  const weeks = Math.max(1, Math.min(4, Math.round(plan.weeks) || 1));
  const first =
    plan.anchor === "NEXT_WEEK"
      ? addDraftDays(draftStartOfWeek(opts.anchorDate), 7)
      : opts.anchorDate;

  const out: DraftSlot[] = [];
  for (let i = 0; i < weeks * 7 && out.length < maxSlots; i += 1) {
    const date = addDraftDays(first, i);
    if (!weekdays.has(draftWeekday(date))) continue;
    for (let m = startMin; m + duration <= endMin && out.length < maxSlots; m += step) {
      out.push({
        startAt: isoAt(date, m),
        endAt: isoAt(date, m + duration),
        capacity,
      });
    }
  }
  return out;
}

/**
 * 丢掉已经开始的时段。
 *
 * 为什么必须丢：报名截止要「晚于现在」且「早于最早时段」，一旦最早那个时段
 * 已经过去，这两条规则就互相矛盾 —— 怎么改都不可能同时成立，实验永远发不出去。
 * 已经开始的时间本来也约不到人，留着只是占位。
 *
 * 发布用例（服务端）与表单回填（前端）都用这一处，避免两边各写一份。
 */
export function prunePastSlots<T extends { startAt: string | Date }>(slots: T[], now: Date): T[] {
  const t = now.getTime();
  return slots.filter((slot) => {
    const start = new Date(slot.startAt).getTime();
    return Number.isFinite(start) && start > t;
  });
}

/**
 * 报名截止的建议值：最早一个「还没开始」的时段往前 2 小时。
 *
 * 如果这个值已经过去（首个时段就在两小时内），退回到现在 + 10 分钟，
 * 前提是仍早于那个时段；否则返回 null —— 说明时段排得太近，
 * 只能让主试把最早的一段往后挪，这里不硬编一个不合法的值。
 */
export function suggestSignupDeadline(
  slots: Array<{ startAt: string }>,
  now: Date,
  leadMs = 2 * 60 * 60 * 1000,
): Date | null {
  const t = now.getTime();
  let first = Number.POSITIVE_INFINITY;
  for (const slot of slots) {
    const start = new Date(slot.startAt).getTime();
    if (Number.isFinite(start) && start > t && start < first) first = start;
  }
  if (!Number.isFinite(first)) return null;

  const wanted = first - leadMs;
  if (wanted > t) return new Date(wanted);

  const floor = t + 10 * 60 * 1000;
  return floor < first ? new Date(floor) : null;
}

/* ---------------- 归一化（模型输出 → 可发布草稿） ---------------- */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asString(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function asInt(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function asSlot(v: unknown): DraftSlot | null {
  if (!isRecord(v)) return null;
  const start = new Date(String(v.startAt ?? ""));
  const end = new Date(String(v.endAt ?? ""));
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  if (end.getTime() <= start.getTime()) return null;
  return {
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    capacity: asInt(v.capacity, 1, 1, 50),
  };
}

/** 排序、去重、丢掉重叠的时段 —— 重叠会被发布规则拒绝，不如在这里先收敛 */
function tidySlots(list: DraftSlot[], max: number): DraftSlot[] {
  const sorted = [...list].sort(
    (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
  );
  const out: DraftSlot[] = [];
  let lastEnd = Number.NEGATIVE_INFINITY;
  for (const slot of sorted) {
    const start = new Date(slot.startAt).getTime();
    const end = new Date(slot.endAt).getTime();
    if (start < lastEnd) continue;
    out.push(slot);
    lastEnd = end;
    if (out.length >= max) break;
  }
  return out;
}

function asSlotPlan(v: unknown): SlotPlan | null {
  if (!isRecord(v)) return null;
  const weekdays = Array.isArray(v.weekdays)
    ? v.weekdays
        .map((d) => Number(d))
        .filter((d) => Number.isInteger(d) && d >= 1 && d <= 7)
    : [];
  const startTime = asString(v.startTime, 5);
  const endTime = asString(v.endTime, 5);
  if (weekdays.length === 0) return null;
  if (minutesOf(startTime) === null || minutesOf(endTime) === null) return null;
  return {
    weekdays: [...new Set(weekdays)].sort((a, b) => a - b),
    startTime,
    endTime,
    weeks: asInt(v.weeks, 1, 1, 4),
    anchor: v.anchor === "NEXT_WEEK" ? "NEXT_WEEK" : "TOMORROW",
  };
}

export type NormalizeOptions = { now: Date; anchorDate?: string };

/**
 * 把任意形状的输入整理成草稿。
 *
 * 注意它**不抛异常**：模型给错字段是常态，抛错会让整个对话中断。
 * 缺什么就留空 + 在 issues 里说明，由用户补。
 */
export function normalizeExperimentDraft(
  raw: unknown,
  opts: NormalizeOptions,
): { draft: ExperimentDraft; issues: DraftIssue[]; notes: string[] } {
  const rec = isRecord(raw) ? raw : {};

  const type: ExperimentType =
    rec.type === ExperimentType.GROUP ? ExperimentType.GROUP : ExperimentType.INDIVIDUAL;

  const durationMin = asInt(rec.durationMin, 30, DRAFT_LIMITS.durationMin, DRAFT_LIMITS.durationMax);
  const groupSize =
    type === ExperimentType.GROUP
      ? asInt(rec.groupSize, 3, DRAFT_LIMITS.groupMin, DRAFT_LIMITS.groupMax)
      : null;
  const capacity = groupSize ?? 1;

  const plan = asSlotPlan(rec.slotPlan);
  const explicitSlots = Array.isArray(rec.slots)
    ? rec.slots.map(asSlot).filter((s): s is DraftSlot => Boolean(s))
    : [];

  const anchorDate = opts.anchorDate ?? addDraftDays(draftToday(opts.now), 1);
  const planned = plan
    ? planSlots(plan, { anchorDate, durationMin, capacity })
    : [];

  // 已经开始的时段一律不收：它们会让「截止时间晚于现在 / 早于最早时段」互相矛盾
  const slots = prunePastSlots(
    tidySlots(
      explicitSlots.length > 0 ? explicitSlots : planned,
      DRAFT_LIMITS.maxSlots,
    ),
    opts.now,
  );

  const draft: ExperimentDraft = {
    title: asString(rec.title, DRAFT_LIMITS.titleMax),
    description: asString(rec.description, DRAFT_LIMITS.descriptionMax),
    location: asString(rec.location, 60),
    durationMin,
    rewardYuan: asInt(rec.rewardYuan, 30, DRAFT_LIMITS.rewardMin, DRAFT_LIMITS.rewardMax),
    type,
    groupSize,
    requirements: asString(rec.requirements, DRAFT_LIMITS.requirementsMax),
    minCreditScore: asInt(rec.minCreditScore, 0, 0, 100),
    needsVerification: rec.needsVerification !== false,
    slots,
    slotPlan: plan,
  };

  const notes = Array.isArray(rec.notes)
    ? rec.notes.map((n) => asString(n, 120)).filter(Boolean).slice(0, 5)
    : [];

  return { draft, issues: reviewExperimentDraft(draft, { now: opts.now }), notes };
}

/* ---------------- 发布前体检 ---------------- */

/**
 * 逐项体检。表单第 3 步、助手卡片、发布按钮前的拦截都用这一份结果，
 * 避免「页面说能发、服务端说不能发」。
 *
 * `signupDeadline`（ISO 字符串或 Date）是可选的：发布助手不产这个字段，
 * 只有手填表单时才知道它。传了才检查 —— 判定文案与 `assertExperimentDraft`
 * 逐字一致，因为真正拒绝发布的是那个函数。
 */
export function reviewExperimentDraft(
  draft: ExperimentDraft,
  opts: { now?: Date; signupDeadline?: string | Date | null; mode?: "ONLINE" | "OFFLINE" } = {},
): DraftIssue[] {
  const online = opts.mode === "ONLINE";
  const issues: DraftIssue[] = [];
  const push = (field: DraftIssueField, level: DraftIssue["level"], message: string) =>
    issues.push({ field, level, message });

  const titleLen = draft.title.trim().length;
  if (titleLen < DRAFT_LIMITS.titleMin) push("title", "block", "标题至少 4 个字");
  if (titleLen > DRAFT_LIMITS.titleMax) push("title", "block", "标题最多 60 个字");

  const descLen = draft.description.trim().length;
  if (descLen < DRAFT_LIMITS.descriptionMin) push("description", "block", "实验说明至少 10 个字");

  const location = draft.location.trim();
  if (location.length < 2) {
    push("location", "block", "地点还没填，请写到具体楼栋和房间");
  } else if (isPlaceholderLocation(location)) {
    push("location", "block", "地点还是占位词，发布前要换成真实房间");
  }

  if (draft.type === ExperimentType.GROUP) {
    if (!draft.groupSize || draft.groupSize < DRAFT_LIMITS.groupMin) {
      push("groupSize", "block", "团体实验人数至少 2 人");
    }
  }

  if (draft.durationMin < DRAFT_LIMITS.durationMin || draft.durationMin > DRAFT_LIMITS.durationMax) {
    push("durationMin", "block", "时长要在 5–480 分钟之间");
  }

  if (draft.rewardYuan < DRAFT_LIMITS.rewardMin || draft.rewardYuan > DRAFT_LIMITS.rewardMax) {
    push("rewardYuan", "block", "报酬要在 1–9999 元之间");
  }

  if (draft.minCreditScore < 0 || draft.minCreditScore > 100) {
    push("minCreditScore", "block", "信誉门槛要在 0–100 之间");
  }

  if (draft.requirements.length > DRAFT_LIMITS.requirementsMax) {
    push("requirements", "warn", "参加要求偏长，建议压到 300 字以内");
  }

  if (!online && draft.slots.length === 0) {
    push("slots", "block", "还没有时段，至少加一个");
  }

  const now = opts.now?.getTime() ?? Date.now();
  const sorted = [...draft.slots].sort(
    (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
  );
  const past = sorted.filter((s) => new Date(s.startAt).getTime() <= now).length;
  // 上界只能跟「还没开始」的时段比：已经开始的发布时会被丢弃，
  // 拿它当最早时段会误报「截止时间必须早于最早时段」，把用户锁死
  const firstUpcoming = sorted.find((s) => new Date(s.startAt).getTime() > now) ?? null;

  // 截止时间三条判定与 assertExperimentDraft 同序同文案：它是最后一道闸
  const deadline = opts.signupDeadline ? new Date(opts.signupDeadline) : null;
  if (deadline) {
    if (Number.isNaN(deadline.getTime())) {
      push("signupDeadline", "block", "报名截止时间格式不正确");
    } else if (deadline.getTime() <= now) {
      push("signupDeadline", "block", "报名截止时间必须晚于现在");
    } else if (!online && firstUpcoming && deadline.getTime() >= new Date(firstUpcoming.startAt).getTime()) {
      push("signupDeadline", "block", "报名截止时间必须早于最早时段的开始时间");
    }
  }

  if (!online) {
    for (let i = 1; i < sorted.length; i += 1) {
      const start = new Date(sorted[i].startAt).getTime();
      if (start < new Date(sorted[i - 1].endAt).getTime()) {
        push("slots", "block", "有两个时段重叠了，发布会被拒绝");
      }
    }
    if (sorted.length > 0 && past === sorted.length) {
      push("slots", "block", "所有时段都已经开始了，回上一步重新排");
    } else if (past > 0) {
      push("slots", "warn", `有 ${past} 个时段已经开始，发布时会被忽略`);
    }
  }

  return issues;
}

export function hasBlockingDraftIssues(issues: DraftIssue[]): boolean {
  return issues.some((i) => i.level === "block");
}

/* ---------------- 规则版草稿（无模型时的降级） ---------------- */

const WEEKDAY_CHARS: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  日: 7,
  天: 7,
};

function parseDurationMin(text: string): number | null {
  const min = /(\d+(?:\.\d+)?)\s*(?:分钟|min\b|mins\b)/i.exec(text);
  if (min) return Math.round(Number(min[1]));
  const hour = /(\d+(?:\.\d+)?)\s*(?:小时|钟头|h\b)/i.exec(text);
  if (hour) return Math.round(Number(hour[1]) * 60);
  return null;
}

function parseRewardYuan(text: string): number | null {
  const named = /(?:报酬|奖励|酬劳|被试费|补贴|费用)[^\d]{0,8}(\d{1,4})\s*(?:元|块)?/.exec(text);
  if (named) return Number(named[1]);
  const plain = /(\d{1,4})\s*(?:元|块)/.exec(text);
  if (plain) return Number(plain[1]);
  return null;
}

function parseWeekdays(text: string): number[] {
  const found = new Set<number>();
  for (const m of text.matchAll(/周([一二三四五六日天])/g)) {
    const day = WEEKDAY_CHARS[m[1]];
    if (day) found.add(day);
  }
  if (/工作日|周一到周五|周一至周五/.test(text)) [1, 2, 3, 4, 5].forEach((d) => found.add(d));
  if (/周末/.test(text)) [6, 7].forEach((d) => found.add(d));
  if (/每天|天天|每日/.test(text)) [1, 2, 3, 4, 5, 6, 7].forEach((d) => found.add(d));
  return [...found].sort((a, b) => a - b);
}

function parseWindow(text: string): { startTime: string; endTime: string } {
  const colon = /(\d{1,2}):(\d{2})\s*[-–—~到至]\s*(\d{1,2}):(\d{2})/.exec(text);
  if (colon) {
    const pad = (n: string) => n.padStart(2, "0");
    return { startTime: `${pad(colon[1])}:${colon[2]}`, endTime: `${pad(colon[3])}:${colon[4]}` };
  }
  const dots = /(\d{1,2})\s*点\s*[-–—~到至]\s*(\d{1,2})\s*点/.exec(text);
  if (dots) {
    return {
      startTime: `${String(Number(dots[1])).padStart(2, "0")}:00`,
      endTime: `${String(Number(dots[2])).padStart(2, "0")}:00`,
    };
  }
  if (/上午|早上|清晨/.test(text)) return { startTime: "09:00", endTime: "12:00" };
  if (/中午/.test(text)) return { startTime: "11:00", endTime: "14:00" };
  if (/傍晚/.test(text)) return { startTime: "16:00", endTime: "19:00" };
  if (/晚上|晚间|夜里/.test(text)) return { startTime: "18:00", endTime: "21:00" };
  return { startTime: "14:00", endTime: "17:00" };
}

/** 去掉「我想做一个……」这类开头，剩下的才像标题 */
function stripLeadVerbs(text: string): string {
  return text
    .replace(/^\s*(你好[，,]?)?\s*(我们想|我想|我要|帮我|请帮我|打算|准备|需要|想)\s*/u, "")
    .replace(/^\s*(做|发|发布|搞|弄|设计|开展|组织)\s*(一个|一项|个|项)?\s*/u, "")
    .trim();
}

function guessTitle(brief: string): string {
  const stripped = stripLeadVerbs(brief);
  const firstClause = stripped.split(/[，。；！？\n]/)[0]?.trim() ?? "";
  const named = /^(.{2,22}?)(实验|研究|任务|调查|问卷|测试|范式)/.exec(firstClause);
  const title = named ? `${named[1]}${named[2]}` : firstClause;
  if (title.length < DRAFT_LIMITS.titleMin) return "招募被试的实验";
  return title.slice(0, DRAFT_LIMITS.titleMax);
}

export type ComposeDraftResult = {
  draft: ExperimentDraft;
  issues: DraftIssue[];
  /** 规则版写死了哪些假设，交给页面提示用户核对 */
  assumptions: string[];
};

/**
 * 无模型时的降级路径：按中文里的数字与时间词拼一份完整草稿。
 *
 * 它写得不如模型自然，但**字段是全的**，主试改几个词就能发 ——
 * 这比给一个「AI 暂时不可用」的空表单有用得多。
 */
export function composeDraftFromBrief(brief: string, opts: NormalizeOptions): ComposeDraftResult {
  const text = brief.trim();
  const durationMin = parseDurationMin(text) ?? 30;
  const rewardYuan = parseRewardYuan(text) ?? 30;
  const isGroup = /团体|小组|组内|群体|多人/.test(text);
  const sizeMatch = /(\d+)\s*人\s*(?:一组|每场|一起|同时|一组同时)/.exec(text);
  const groupSize = isGroup ? Math.max(2, Math.min(30, Number(sizeMatch?.[1] ?? 3))) : null;

  const title = guessTitle(text);
  const topic = title.replace(/(实验|研究|任务|调查|问卷|测试|范式)$/u, "") || "这项研究";
  const weekdays = parseWeekdays(text);
  const window = parseWindow(text);
  const anchor: SlotPlan["anchor"] = /下周/.test(text) ? "NEXT_WEEK" : "TOMORROW";
  const weeks = /连续\s*[两二三四]\s*周/.test(text) ? 2 : anchor === "NEXT_WEEK" ? 1 : 2;

  const plan: SlotPlan = {
    weekdays: weekdays.length > 0 ? weekdays : [1, 3, 5],
    startTime: window.startTime,
    endTime: window.endTime,
    weeks,
    anchor,
  };

  const description = [
    `围绕「${topic}」，我们想邀请你到实验室完成一次约 ${durationMin} 分钟的任务。`,
    "",
    "你要做的事：按指导语完成电脑上的任务，全程有主试在场，不需要提前准备。",
    "",
    `时间与报酬：单次约 ${durationMin} 分钟，报酬 ${rewardYuan} 元，实验结束后当场结算。`,
    "",
    "补充说明：实验数据仅用于本研究，报告中不会出现能识别你身份的信息；你可以随时退出。",
  ].join("\n");

  const raw = {
    title,
    description,
    location: PLACEHOLDER_LOCATION,
    durationMin,
    rewardYuan,
    type: isGroup ? ExperimentType.GROUP : ExperimentType.INDIVIDUAL,
    groupSize,
    requirements: "",
    minCreditScore: 0,
    needsVerification: true,
    slotPlan: plan,
  };

  const normalized = normalizeExperimentDraft(raw, opts);
  const assumptions = [
    `时长按 ${durationMin} 分钟、报酬按 ${rewardYuan} 元填写，和你说的不一致就直接改。`,
    "地点先留成「待补充」——具体房间号不能替你编，发布前必须填。",
    "说明里的数据用途按常见写法生成，请按你的伦理审批核对。",
  ];

  return {
    draft: normalized.draft,
    issues: normalized.issues,
    assumptions,
  };
}
