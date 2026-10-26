import { describe, expect, it } from "vitest";
import { parseVaguePreferred, rankSlots } from "@/lib/matching";

const NOW = new Date("2026-10-27T04:00:00.000Z"); // 上海时间 10-27 12:00，周二
const HOUR = 3600 * 1000;

function slot(id: string, hoursFromNow: number, remaining = 1, capacity = 1) {
  const startAt = new Date(NOW.getTime() + hoursFromNow * HOUR);
  return {
    id,
    startAt,
    endAt: new Date(startAt.getTime() + 40 * 60 * 1000),
    remaining,
    capacity,
  };
}

describe("撮合排序（§7.4）", () => {
  it("过滤满分时段", () => {
    const ranked = rankSlots([slot("full", 5, 0, 1), slot("open", 6, 1, 1)], { now: NOW });
    expect(ranked.map((s) => s.id)).toEqual(["open"]);
  });

  it("过滤已开始的时段", () => {
    const ranked = rankSlots([slot("past", -2), slot("future", 2)], { now: NOW });
    expect(ranked.map((s) => s.id)).toEqual(["future"]);
  });

  it("避开被试已有预约的时间冲突", () => {
    const busy = [
      { start: new Date(NOW.getTime() + 4 * HOUR), end: new Date(NOW.getTime() + 5 * HOUR) },
    ];
    const ranked = rankSlots([slot("conflict", 4), slot("free", 8)], { now: NOW, busy });
    expect(ranked.map((s) => s.id)).toEqual(["free"]);
  });

  it("被试明确提到的时段排在最前，即使它更晚", () => {
    const preferred = [
      { start: new Date(NOW.getTime() + 30 * HOUR), end: new Date(NOW.getTime() + 34 * HOUR) },
    ];
    const ranked = rankSlots([slot("soon", 3), slot("preferred", 31)], { now: NOW, preferred });
    expect(ranked[0].id).toBe("preferred");
    expect(ranked[0].tier).toBe(0);
  });

  it("同样命中偏好时，剩余容量多的优先（均衡负载）", () => {
    const ranked = rankSlots([slot("one", 5, 1, 1), slot("three", 6, 3, 3)], { now: NOW });
    expect(ranked[0].id).toBe("three");
  });

  it("容量相同时，更近的时段优先", () => {
    const ranked = rankSlots([slot("later", 50), slot("near", 5)], { now: NOW });
    expect(ranked.map((s) => s.id)).toEqual(["near", "later"]);
  });

  it("limit 只取前 N 个（propose_slots 最多 3 个）", () => {
    const ranked = rankSlots([slot("a", 3), slot("b", 4), slot("c", 5), slot("d", 6)], {
      now: NOW,
      limit: 3,
    });
    expect(ranked).toHaveLength(3);
    expect(ranked.map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  it("三个被试拿到的第一个推荐不会撞车时，说明容量被正确消耗", () => {
    // 容量 1 的时段被占用后 remaining 变 0，应从推荐里消失
    const before = rankSlots([slot("s1", 3, 1, 1), slot("s2", 4, 1, 1)], { now: NOW });
    expect(before[0].id).toBe("s1");
    const after = rankSlots([slot("s1", 3, 0, 1), slot("s2", 4, 1, 1)], { now: NOW });
    expect(after[0].id).toBe("s2");
  });
});

describe("模糊时间解析（无 LLM 兜底）", () => {
  it("「周三下午」解析成明天 13:00–18:00（上海时区）", () => {
    const windows = parseVaguePreferred("我周三下午有空", NOW);
    expect(windows).toHaveLength(1);
    const start = windows[0].start;
    // 上海时间 10-28 13:00 = UTC 10-28 05:00
    expect(start.toISOString()).toBe("2026-10-28T05:00:00.000Z");
    expect(windows[0].end.toISOString()).toBe("2026-10-28T10:00:00.000Z");
  });

  it("「明天上午」解析成次日 08:00–12:00", () => {
    const windows = parseVaguePreferred("明天上午可以", NOW);
    expect(windows[0].start.toISOString()).toBe("2026-10-28T00:00:00.000Z");
  });

  it("没提时间就返回空数组，不瞎猜", () => {
    expect(parseVaguePreferred("都行", NOW)).toHaveLength(0);
  });

  it("同时提到两个说法会给出两个窗口", () => {
    const windows = parseVaguePreferred("今天下午或者周三上午", NOW);
    expect(windows.length).toBeGreaterThanOrEqual(2);
  });
});
