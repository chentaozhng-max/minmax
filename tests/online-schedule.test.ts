import { describe, expect, it } from "vitest";
import {
  MAX_REPEAT_DAYS,
  canSubmitRound,
  clampRepeatDays,
  currentRound,
  roundClosesAt,
  shanghaiDayIndex,
  shanghaiMidnight,
  windowClosesAt,
} from "@/domain/online-schedule";

/** 上海时间 2026-11-08 00:00 */
const day1 = new Date("2026-11-08T00:00:00+08:00");

describe("currentRound", () => {
  it("第 1 天任意时刻都是第 1 轮", () => {
    expect(currentRound(day1, 7, new Date("2026-11-08T00:00:01+08:00"))).toBe(1);
    expect(currentRound(day1, 7, new Date("2026-11-08T23:59:59+08:00"))).toBe(1);
  });

  it("第 3 天是第 3 轮", () => {
    expect(currentRound(day1, 7, new Date("2026-11-10T14:00:00+08:00"))).toBe(3);
  });

  it("窗口开始之前返回 null", () => {
    expect(currentRound(day1, 7, new Date("2026-11-07T23:59:00+08:00"))).toBeNull();
  });

  it("最后一天之后返回 null", () => {
    expect(currentRound(day1, 7, new Date("2026-11-14T23:59:59+08:00"))).toBe(7);
    expect(currentRound(day1, 7, new Date("2026-11-15T00:00:01+08:00"))).toBeNull();
  });

  it("按自然日切，不是 24 小时滚动 —— 23:50 填完，00:10 就该能填下一次", () => {
    const late = new Date("2026-11-08T23:50:00+08:00");
    const early = new Date("2026-11-09T00:10:00+08:00");
    expect(currentRound(day1, 7, late)).toBe(1);
    expect(currentRound(day1, 7, early)).toBe(2);
  });

  it("跨时区边界：UTC 15:59 还是上海当天，UTC 16:00 就是次日", () => {
    expect(currentRound(day1, 7, new Date("2026-11-08T15:59:00Z"))).toBe(1);
    expect(currentRound(day1, 7, new Date("2026-11-08T16:00:00Z"))).toBe(2);
  });

  it("跨月也能算", () => {
    const start = new Date("2026-11-28T00:00:00+08:00");
    expect(currentRound(start, 7, new Date("2026-12-01T10:00:00+08:00"))).toBe(4);
  });

  it("repeatCount = 1 时只有当天有效", () => {
    expect(currentRound(day1, 1, new Date("2026-11-08T12:00:00+08:00"))).toBe(1);
    expect(currentRound(day1, 1, new Date("2026-11-09T12:00:00+08:00"))).toBeNull();
  });

  it("没有 windowStart 时返回 null（ANYTIME 不走这条路）", () => {
    expect(currentRound(null, 7, day1)).toBeNull();
    expect(currentRound(undefined, 7, day1)).toBeNull();
  });
});

describe("clampRepeatDays", () => {
  it("夹在 1–60 之间并取整", () => {
    expect(clampRepeatDays(0)).toBe(1);
    expect(clampRepeatDays(-3)).toBe(1);
    expect(clampRepeatDays(7.6)).toBe(8);
    expect(clampRepeatDays(999)).toBe(MAX_REPEAT_DAYS);
    expect(clampRepeatDays(Number.NaN)).toBe(1);
  });
});

describe("日期边界", () => {
  it("第 k 轮截止 = 起始日 + k 天的 00:00", () => {
    expect(roundClosesAt(day1, 1).toISOString()).toBe("2026-11-08T16:00:00.000Z");
    expect(roundClosesAt(day1, 3).toISOString()).toBe("2026-11-10T16:00:00.000Z");
  });

  it("窗口结束 = 第 N 轮截止", () => {
    expect(windowClosesAt(day1, 7).toISOString()).toBe(roundClosesAt(day1, 7).toISOString());
  });

  it("shanghaiMidnight 落回当天 00:00", () => {
    expect(shanghaiMidnight(new Date("2026-11-08T15:30:00+08:00")).toISOString()).toBe(
      "2026-11-07T16:00:00.000Z",
    );
  });

  it("同一自然日的不同时刻日序号相同", () => {
    expect(shanghaiDayIndex(new Date("2026-11-08T00:01:00+08:00"))).toBe(
      shanghaiDayIndex(new Date("2026-11-08T23:59:00+08:00")),
    );
  });
});

describe("canSubmitRound", () => {
  const base = { windowStart: day1, repeatCount: 7, now: new Date("2026-11-10T14:00:00+08:00") };

  it("没填过就允许，并给出本轮序号", () => {
    expect(canSubmitRound({ ...base, submittedRounds: [] })).toEqual({ allowed: true, round: 3 });
  });

  it("今天填过了就不允许，理由里说明天再来", () => {
    const result = canSubmitRound({ ...base, submittedRounds: [1, 2, 3] });
    expect(result.allowed).toBe(false);
    expect(result.round).toBe(3);
    expect(result.reason).toContain("明天");
  });

  it("昨天填过不影响今天", () => {
    expect(canSubmitRound({ ...base, submittedRounds: [1, 2] }).allowed).toBe(true);
  });

  it("窗口外不允许，理由说明不在时间内", () => {
    const result = canSubmitRound({ ...base, now: new Date("2026-11-20T10:00:00+08:00"), submittedRounds: [] });
    expect(result.allowed).toBe(false);
    expect(result.round).toBeNull();
    expect(result.reason).toContain("时间");
  });
});
