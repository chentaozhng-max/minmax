/**
 * 跨实验搜索的条件模型与归一化。
 *
 * ## 为什么这一层必须存在
 *
 * 模型（LLM）负责把「周三下午、短一点、奖励高」翻译成**结构化但随口语化**的参数：
 *   { weekday: "周三", timeOfDay: "下午", maxDurationMin: 60, sortBy: "reward" }
 *
 * 但它**不能**算「周三是几号」——一是会算错（尤其"下周三"），二是今天算一次明天算一次
 * 结果还不一样，同一个对话重放得到不同列表。所以「语义词 → 具体时间窗」的换算
 * 全部收在这里，由确定性代码做，可单测、可复现。
 *
 * ## 与 domain/matching.ts 的关系
 *
 * matching 关心「**某个实验的**哪些时段更该推荐」（rankSlots）。
 * 这里关心「**哪些实验**符合我的条件」（跨实验）。前者以 Slot 为中心，后者以 Experiment 为中心，
 * 不是一个概念，所以不合并。
 *
 * 纯函数，无 IO，领域层可自由 import zod。
 */
import { z } from "zod";
import { rewardYuan } from "@/domain/reward";

/* ---------------- 输入：模型抽取出来的条件 ---------------- */

export const timeOfDayValues = ["上午", "下午", "晚上", "不限"] as const;
export type TimeOfDay = (typeof timeOfDayValues)[number];

export const sortByValues = ["reward", "time", "match"] as const;
export type SortBy = (typeof sortByValues)[number];

/**
 * 模型给的条件。字段全部可选 —— 用户可能只说「找实验」。
 *
 * 注意 `weekday` 故意收成 string 而不是枚举：用户会说「周三」「星期三」「下周三」，
 * 用枚举会逼模型自己猜。让模型原样吐出来，这里做归一。
 */
export const searchCriteriaSchema = z.object({
  keyword: z.string().optional().describe("实验标题/描述里的关键词，比如「记忆」「决策」"),
  weekday: z
    .string()
    .optional()
    .describe("周几，原样写中文，如「周三」「星期三」；说「下周」的用 nextWeek 表示"),
  nextWeek: z.boolean().optional().describe("用户说的是下周而不是本周"),
  timeOfDay: z
    .enum(timeOfDayValues)
    .optional()
    .describe("一天中的时段：上午(8-12) / 下午(13-18) / 晚上(18-22)；没说就传不限"),
  maxDurationMin: z.number().int().positive().optional().describe("实验时长上限（分钟）"),
  sortBy: z
    .enum(sortByValues)
    .optional()
    .describe("排序：reward=奖励高的在前；time=最近能约的在前；match=综合（默认）"),
  limit: z.number().int().positive().max(20).optional().describe("最多返回几个，默认 5"),
});

export type SearchCriteria = z.infer<typeof searchCriteriaSchema>;

/* ---------------- 归一化后的查询条件 ---------------- */

export type MatchWindow = { start: Date; end: Date };

export type NormalizedCriteria = {
  keyword: string | null;
  /** 命中的时间窗（已换算成本周/下周的具体日期）；空数组 = 不限时间 */
  windows: MatchWindow[];
  maxDurationMin: number | null;
  sortBy: SortBy;
  limit: number;
};

/* ---------------- 语义词 → 确定性数值 ---------------- */

/** weekday 中文字 → 0(周日)..6(周六) */
const WEEKDAY_INDEX: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  日: 0,
  天: 0,
};

/**
 * 从「周三」「星期三」「礼拜三」里取出 0..6。取不到返回 null。
 *
 * 刻意要求带前缀（周/星期/礼拜）而不是裸认一个字：
 * 「随便」「大概」这类词里也含「一/三」，裸匹配会把闲聊误当成条件。
 */
export function parseWeekday(text: string | undefined): number | null {
  if (!text) return null;
  const hit = text.match(/(?:周|星期|礼拜)([一二三四五六日天])/);
  if (!hit) return null;
  const idx = WEEKDAY_INDEX[hit[1]];
  return idx === undefined ? null : idx;
}

/** 时段名 → [起, 止) 小时。未识别按全天处理 */
export function timeOfDayRange(value: TimeOfDay | undefined): { from: number; to: number } {
  switch (value) {
    case "上午":
      return { from: 8, to: 12 };
    case "下午":
      return { from: 13, to: 18 };
    case "晚上":
      return { from: 18, to: 22 };
    default:
      return { from: 0, to: 24 };
  }
}

/** 上海时区的「今天是几号/周几」 */
function shanghaiParts(now: Date) {
  const shifted = new Date(now.getTime() + 8 * 3600 * 1000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    date: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
  };
}

/** 上海时区的「今天 + dayOffset 天」的 0 点，转成真实 Date */
function shanghaiDayStart(now: Date, dayOffset: number): Date {
  const p = shanghaiParts(now);
  return new Date(Date.UTC(p.year, p.month, p.date) - 8 * 3600 * 1000 + dayOffset * 86400 * 1000);
}

/**
 * 把条件归一成可查询的形状。
 *
 * 日期规则（本周 vs 下周）：
 *   - 没说 weekday        → 不限时间，windows 为空
 *   - 说「周三」且今天周二 → 明天（本周三）
 *   - 说「周三」且今天周四 → 下周三（**过去的不算，往后找**）
 *   - 说「下周三」        → 本周内的周三再 +7 天
 *
 * 这条「过去的不算」很关键：被试说"周三"是为了约未来的实验，
 * 若今天已是周四还返回昨天的周三，列表必然空，用户会以为没实验。
 */
export function normalizeCriteria(
  input: SearchCriteria,
  now: Date = new Date(),
): NormalizedCriteria {
  const p = shanghaiParts(now);
  const windows: MatchWindow[] = [];

  const weekday = parseWeekday(input.weekday);
  if (weekday !== null) {
    let diff = (weekday - p.weekday + 7) % 7;
    if (diff === 0) diff = 7; // 说「周三」而今天正是周三 → 指下周三（今天的时段基本已过）
    if (input.nextWeek) diff += 7;
    const dayStart = shanghaiDayStart(now, diff);
    const { from, to } = timeOfDayRange(input.timeOfDay);
    windows.push({
      start: new Date(dayStart.getTime() + from * 3600 * 1000),
      end: new Date(dayStart.getTime() + to * 3600 * 1000),
    });
  }

  return {
    keyword: input.keyword?.trim() || null,
    windows,
    maxDurationMin: input.maxDurationMin ?? null,
    sortBy: input.sortBy ?? "match",
    limit: input.limit ?? 5,
  };
}

/* ---------------- 排序 ---------------- */

/** 参与排序的最小形状 */
export type RankableExperiment = {
  id: string;
  rewardText: string;
  /** 最近一个还有空位的未来时段；没有则 null */
  nextSlotAt: Date | null;
  /** 命中的时段数（用户在意的时段还有多少可约） */
  matchedSlotCount: number;
};

/**
 * 按用户诉求排序。
 *
 * 三档的取舍：
 *   reward —— 明说「奖励高」就按金额降序；金额解析不出的（面议）排最后而不是当 0 参与比较
 *   time   —— 最近能约的在前；没有可约时段的排最后
 *   match  —— 综合：优先「用户在意的时段有余位」的，再按奖励、再按时间
 *
 * 与 rankSlots 同一条原则：**排序是确定性代码的事，不交给模型**。
 */
export function rankExperiments<T extends RankableExperiment>(
  items: T[],
  sortBy: SortBy,
): T[] {
  const rewardOf = (x: T) => rewardYuan(x.rewardText);
  const timeOf = (x: T) => x.nextSlotAt?.getTime() ?? Number.POSITIVE_INFINITY;

  const sorted = [...items];
  sorted.sort((a, b) => {
    if (sortBy === "reward") {
      const ra = rewardOf(a);
      const rb = rewardOf(b);
      if (ra === null && rb === null) return timeOf(a) - timeOf(b);
      if (ra === null) return 1;
      if (rb === null) return -1;
      if (rb !== ra) return rb - ra;
      return timeOf(a) - timeOf(b);
    }

    if (sortBy === "time") {
      const diff = timeOf(a) - timeOf(b);
      if (diff !== 0) return diff;
      return a.id.localeCompare(b.id);
    }

    // match
    const matchDiff = b.matchedSlotCount - a.matchedSlotCount;
    if (matchDiff !== 0) return matchDiff;
    const ra = rewardOf(a) ?? -1;
    const rb = rewardOf(b) ?? -1;
    if (rb !== ra) return rb - ra;
    return timeOf(a) - timeOf(b);
  });
  return sorted;
}
