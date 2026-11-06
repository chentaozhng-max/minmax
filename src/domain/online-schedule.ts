/**
 * 线上实验的时间形态 —— 纯函数，不碰 IO。
 *
 * 「线上」不等于「没有时间」。这里区分三种：
 *   1. ANYTIME  一次性问卷，随时可填（v1.4 之前的唯一形态）
 *   2. WINDOW   长程重复测量：连续 N 天，每天一次
 *   3. SCHEDULED 线上固定场次：有具体时间点，像线下一样报名（但不限名额）
 *
 * 轮次按**上海时区的自然日**算，不是 24 小时滚动窗口：
 * 被试晚上 23:50 填完，第二天 00:10 就该能填下一次，
 * 而不是被「距上次不满 24 小时」挡住。
 */

export const OnlineScheduleMode = {
  ANYTIME: "ANYTIME",
  WINDOW: "WINDOW",
  SCHEDULED: "SCHEDULED",
} as const;
export type OnlineScheduleMode = (typeof OnlineScheduleMode)[keyof typeof OnlineScheduleMode];

/** 连续天数上限。再多主试自己也管不过来，而且题目会膨胀成几千行 */
export const MAX_REPEAT_DAYS = 60;

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 上海时区的年月日。
 *
 * **不 import `@/lib/time`** —— 那是基础设施层，领域层依赖它会形成倒置
 * （分层护栏 L1 红线的原意）。上海固定 UTC+8 且无夏令时，平移后取 UTC 字段就够。
 */
function shanghaiYmd(date: Date): { year: number; month: number; day: number } {
  const shifted = new Date(date.getTime() + SHANGHAI_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/** 上海时区的自然日序号：同一自然日的任何时刻得到同一个数 */
export function shanghaiDayIndex(date: Date): number {
  const p = shanghaiYmd(date);
  return Math.floor(Date.UTC(p.year, p.month - 1, p.day) / DAY_MS);
}

/** 上海时区某天的 00:00 对应的真实时刻 */
export function shanghaiMidnight(date: Date): Date {
  const p = shanghaiYmd(date);
  return new Date(Date.UTC(p.year, p.month - 1, p.day) - SHANGHAI_OFFSET_MS);
}

export function clampRepeatDays(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(MAX_REPEAT_DAYS, Math.round(value)));
}

/**
 * 今天是第几轮（1 起）。不在窗口内返回 null。
 *
 * `windowStart` 只取它落在哪一天，具体几点不看 —— 主试选的是日期，不是时刻。
 */
export function currentRound(
  windowStart: Date | null | undefined,
  repeatCount: number,
  now: Date,
): number | null {
  if (!windowStart) return null;
  const days = clampRepeatDays(repeatCount);
  const diff = shanghaiDayIndex(now) - shanghaiDayIndex(windowStart);
  if (diff < 0 || diff >= days) return null;
  return diff + 1;
}

/** 第 k 轮的截止时刻（该自然日结束）。用来显示「今天 23:59 前」 */
export function roundClosesAt(windowStart: Date, round: number): Date {
  const p = shanghaiYmd(windowStart);
  return new Date(Date.UTC(p.year, p.month - 1, p.day + round) - SHANGHAI_OFFSET_MS);
}

/** 窗口最后一天结束的时刻 */
export function windowClosesAt(windowStart: Date, repeatCount: number): Date {
  return roundClosesAt(windowStart, clampRepeatDays(repeatCount));
}

/**
 * 这一轮还能不能填。
 *
 * 只在客户端做判断是不够的 —— 提交接口也要用同一个函数挡，
 * 不然被试改系统时间或直接调接口就能提前交。
 */
export function canSubmitRound(input: {
  windowStart: Date | null | undefined;
  repeatCount: number;
  now: Date;
  /** 已经填过的轮次 */
  submittedRounds: number[];
}): { allowed: boolean; round: number | null; reason?: string } {
  const round = currentRound(input.windowStart, input.repeatCount, input.now);
  if (round === null) {
    return {
      allowed: false,
      round: null,
      reason: input.windowStart ? "还没到填写时间，或者这轮已经结束了" : "这个实验没有设置填写窗口",
    };
  }
  if (input.submittedRounds.includes(round)) {
    return { allowed: false, round, reason: `第 ${round} 天已经填过了，明天再来` };
  }
  return { allowed: true, round };
}
