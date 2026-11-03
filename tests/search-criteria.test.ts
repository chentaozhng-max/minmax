import { describe, expect, it } from "vitest";
import {
  normalizeCriteria,
  parseWeekday,
  rankExperiments,
  timeOfDayRange,
  type RankableExperiment,
} from "@/domain/search-criteria";

/**
 * 领域层纯函数测试：条件归一 + 排序。
 *
 * 这里的每一条都对应一个「模型会做错、所以必须由代码做」的点：
 *   - 「周三」是哪一天（模型算日期会错，且不可复现）
 *   - 今天就是周三时该指哪一周
 *   - 「奖励高」的比较口径（面议不该当 0）
 */

/** 2026-11-03 是周二（上海时间 10:20） */
const TUESDAY = new Date("2026-11-03T02:20:00.000Z");

/** 上海时间的本地小时 */
function shanghaiHour(d: Date) {
  return new Date(d.getTime() + 8 * 3600 * 1000).getUTCHours();
}

/** 上海时间的 YYYY-MM-DD */
function shanghaiDate(d: Date) {
  return new Date(d.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

describe("parseWeekday", () => {
  it("认「周三」「星期三」，也认「礼拜三」", () => {
    expect(parseWeekday("周三")).toBe(3);
    expect(parseWeekday("星期三")).toBe(3);
    expect(parseWeekday("礼拜三")).toBe(3);
  });

  it("周日 / 周天都是 0", () => {
    expect(parseWeekday("周日")).toBe(0);
    expect(parseWeekday("周天")).toBe(0);
  });

  it("⚠️ 裸字不认：不把闲聊里的「一/三」当成条件", () => {
    expect(parseWeekday("随便")).toBeNull();
    expect(parseWeekday("大概")).toBeNull();
    expect(parseWeekday("不一定")).toBeNull();
  });

  it("认不出就返回 null，不瞎猜", () => {
    expect(parseWeekday(undefined)).toBeNull();
    expect(parseWeekday("")).toBeNull();
  });
});

describe("timeOfDayRange", () => {
  it("上午 8-12 / 下午 13-18 / 晚上 18-22", () => {
    expect(timeOfDayRange("上午")).toEqual({ from: 8, to: 12 });
    expect(timeOfDayRange("下午")).toEqual({ from: 13, to: 18 });
    expect(timeOfDayRange("晚上")).toEqual({ from: 18, to: 22 });
  });

  it("不限 / 没说 → 全天", () => {
    expect(timeOfDayRange("不限")).toEqual({ from: 0, to: 24 });
    expect(timeOfDayRange(undefined)).toEqual({ from: 0, to: 24 });
  });
});

describe("normalizeCriteria —— 日期换算", () => {
  it("今天是周二，说「周三下午」→ 明天（本周三）13:00-18:00", () => {
    const out = normalizeCriteria({ weekday: "周三", timeOfDay: "下午" }, TUESDAY);
    expect(out.windows).toHaveLength(1);
    expect(shanghaiDate(out.windows[0].start)).toBe("2026-11-04");
    expect(shanghaiHour(out.windows[0].start)).toBe(13);
    expect(shanghaiHour(out.windows[0].end)).toBe(18);
  });

  it("今天是周二，说「周五」→ 3 天后，不是 4 天前", () => {
    const out = normalizeCriteria({ weekday: "周五" }, TUESDAY);
    expect(shanghaiDate(out.windows[0].start)).toBe("2026-11-06");
  });

  it("⚠️ 今天是周二，说「周一」→ 下周周一（往后找，不给过去的）", () => {
    const out = normalizeCriteria({ weekday: "周一" }, TUESDAY);
    expect(shanghaiDate(out.windows[0].start)).toBe("2026-11-09");
  });

  it("⚠️ 今天正是周二，说「周二」→ 下周二（今天的时段基本已过）", () => {
    const out = normalizeCriteria({ weekday: "周二" }, TUESDAY);
    expect(shanghaiDate(out.windows[0].start)).toBe("2026-11-10");
  });

  it("说「下周三」→ 在本周三的基础上 +7 天", () => {
    const out = normalizeCriteria({ weekday: "周三", nextWeek: true }, TUESDAY);
    expect(shanghaiDate(out.windows[0].start)).toBe("2026-11-11");
  });

  it("没说周几 → 不限时间，windows 为空（不是全时段）", () => {
    const out = normalizeCriteria({ keyword: "记忆" }, TUESDAY);
    expect(out.windows).toEqual([]);
    expect(out.keyword).toBe("记忆");
  });

  it("关键词空白字符串归一成 null", () => {
    expect(normalizeCriteria({ keyword: "   " }, TUESDAY).keyword).toBeNull();
  });
});

describe("normalizeCriteria —— 默认值", () => {
  it("sortBy 默认 match、limit 默认 5", () => {
    const out = normalizeCriteria({}, TUESDAY);
    expect(out.sortBy).toBe("match");
    expect(out.limit).toBe(5);
    expect(out.maxDurationMin).toBeNull();
  });

  it("传了就照传", () => {
    const out = normalizeCriteria({ sortBy: "reward", limit: 3, maxDurationMin: 60 }, TUESDAY);
    expect(out).toMatchObject({ sortBy: "reward", limit: 3, maxDurationMin: 60 });
  });
});

describe("rankExperiments", () => {
  const make = (
    id: string,
    rewardText: string,
    nextSlotAt: string | null,
    matchedSlotCount = 1,
  ): RankableExperiment => ({
    id,
    rewardText,
    nextSlotAt: nextSlotAt ? new Date(nextSlotAt) : null,
    matchedSlotCount,
  });

  const cheap = make("cheap", "¥30", "2026-11-04T06:00:00.000Z");
  const mid = make("mid", "¥60", "2026-11-06T06:00:00.000Z");
  const rich = make("rich", "¥120", "2026-11-08T06:00:00.000Z");
  const unknown = make("unknown", "面议", "2026-11-05T06:00:00.000Z");

  it("sortBy=reward：金额降序，面议排最后（不当 0）", () => {
    const out = rankExperiments([cheap, unknown, rich, mid], "reward");
    expect(out.map((x) => x.id)).toEqual(["rich", "mid", "cheap", "unknown"]);
  });

  it("面议和面议之间按时间排，不互相颠倒", () => {
    const a = make("a", "面议", "2026-11-09T06:00:00.000Z");
    const b = make("b", "面议", "2026-11-05T06:00:00.000Z");
    const out = rankExperiments([a, b], "reward");
    expect(out.map((x) => x.id)).toEqual(["b", "a"]);
  });

  it("sortBy=time：最近能约的在前，没有可约时段的垫底", () => {
    const noSlot = make("noSlot", "¥999", null);
    const out = rankExperiments([rich, noSlot, cheap, mid], "time");
    expect(out.map((x) => x.id)).toEqual(["cheap", "mid", "rich", "noSlot"]);
  });

  it("sortBy=match：命中时段多的优先，其次奖励、其次时间", () => {
    const hit2 = make("hit2", "¥10", "2026-11-09T06:00:00.000Z", 2);
    const hit1rich = make("hit1rich", "¥200", "2026-11-09T06:00:00.000Z", 1);
    const out = rankExperiments([hit1rich, hit2], "match");
    expect(out.map((x) => x.id)).toEqual(["hit2", "hit1rich"]);
  });

  it("不改原数组", () => {
    const input = [cheap, rich];
    const snapshot = input.map((x) => x.id);
    rankExperiments(input, "reward");
    expect(input.map((x) => x.id)).toEqual(snapshot);
  });
});
