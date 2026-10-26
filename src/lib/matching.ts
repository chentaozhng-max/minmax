/**
 * 撮合排序。LLM 只负责理解"周三下午"这类模糊表达，
 * 「哪些时段更该被推荐」这件事由这里的确定性规则保证，不交给模型自由发挥。
 */

export type MatchCandidate = {
  id: string;
  startAt: Date;
  endAt: Date;
  remaining: number;
  capacity: number;
};

export type TimeWindow = { start: Date; end: Date };

function overlaps(a: TimeWindow, b: TimeWindow) {
  return a.start.getTime() < b.end.getTime() && a.end.getTime() > b.start.getTime();
}

export type RankOptions = {
  now: Date;
  /** 被试明确提到的时间段，命中者优先 */
  preferred?: TimeWindow[];
  /** 被试已有的预约，直接排除 */
  busy?: TimeWindow[];
  /** 只保留这个时刻之后的时段 */
  horizonDays?: number;
  limit?: number;
};

export type RankedSlot = MatchCandidate & {
  /** 0 = 被试提到的；1 = 普通 */
  tier: number;
  score: number;
};

/**
 * 排序优先级（§7.4）：
 *   a. 被试明确提到的时间段
 *   b. 剩余容量多的时段（均衡负载）
 *   c. 距现在更近的时段
 */
export function rankSlots<T extends MatchCandidate>(
  candidates: T[],
  options: RankOptions,
): (T & RankedSlot)[] {
  const { now, preferred = [], busy = [], horizonDays, limit } = options;
  const horizonEnd = horizonDays
    ? new Date(now.getTime() + horizonDays * 24 * 60 * 60 * 1000)
    : null;

  const filtered = candidates.filter((slot) => {
    if (slot.remaining <= 0) return false;
    if (slot.startAt.getTime() <= now.getTime()) return false;
    if (horizonEnd && slot.startAt.getTime() > horizonEnd.getTime()) return false;
    const window = { start: slot.startAt, end: slot.endAt };
    if (busy.some((b) => overlaps(window, b))) return false;
    return true;
  });

  const ranked = filtered.map((slot) => {
    const window = { start: slot.startAt, end: slot.endAt };
    const hit = preferred.some((p) => overlaps(window, p));
    return {
      ...slot,
      tier: hit ? 0 : 1,
      score: (hit ? 1000 : 0) + slot.remaining * 100 - (slot.startAt.getTime() - now.getTime()) / 3.6e6,
    };
  });

  ranked.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    if (b.remaining !== a.remaining) return b.remaining - a.remaining;
    return a.startAt.getTime() - b.startAt.getTime();
  });

  return limit ? ranked.slice(0, limit) : ranked;
}

/**
 * 把中文的"今天/明天/周三/下午"这类模糊说法粗解析成时间窗。
 * 只在 LLM 不可用时作为兜底；有 LLM 时由模型自己理解。
 */
export function parseVaguePreferred(text: string, now: Date): TimeWindow[] {
  const windows: TimeWindow[] = [];
  const dayOffsets: number[] = [];

  if (/今天|today/i.test(text)) dayOffsets.push(0);
  if (/明天|tomorrow/i.test(text)) dayOffsets.push(1);
  if (/后天/.test(text)) dayOffsets.push(2);

  const weekdayMap: Record<string, number> = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    日: 0,
    天: 0,
  };
  const weekdayMatch = text.match(/周([一二三四五六日天])/g);
  if (weekdayMatch) {
    const shanghai = new Date(now.getTime() + 8 * 3600 * 1000);
    const currentWeekday = shanghai.getUTCDay();
    for (const token of weekdayMatch) {
      const target = weekdayMap[token.slice(1)];
      if (target === undefined) continue;
      let diff = (target - currentWeekday + 7) % 7;
      if (diff === 0) diff = 7;
      dayOffsets.push(diff);
    }
  }

  const hourRange = (() => {
    if (/上午|早上|morning/.test(text)) return { from: 8, to: 12 };
    if (/中午/.test(text)) return { from: 11, to: 14 };
    if (/下午|afternoon/.test(text)) return { from: 13, to: 18 };
    if (/晚上|傍晚/.test(text)) return { from: 18, to: 22 };
    return { from: 8, to: 22 };
  })();

  for (const offset of dayOffsets) {
    const dayStart = new Date(
      Date.UTC(
        new Date(now.getTime() + 8 * 3600 * 1000).getUTCFullYear(),
        new Date(now.getTime() + 8 * 3600 * 1000).getUTCMonth(),
        new Date(now.getTime() + 8 * 3600 * 1000).getUTCDate(),
      ) -
        8 * 3600 * 1000 +
        offset * 24 * 3600 * 1000,
    );
    windows.push({
      start: new Date(dayStart.getTime() + hourRange.from * 3600 * 1000),
      end: new Date(dayStart.getTime() + hourRange.to * 3600 * 1000),
    });
  }

  return windows;
}
