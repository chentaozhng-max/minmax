import { describe, expect, it } from "vitest";
import {
  addDaysToDateStr,
  formatDayKey,
  formatHM,
  formatShortDayCN,
  toShanghaiIso,
  todayInShanghai,
} from "@/lib/time";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

describe("日期字符串递增（按上海日历日）", () => {
  it("加 0 天不变", () => {
    expect(addDaysToDateStr("2026-10-27", 0)).toBe("2026-10-27");
  });

  it("加 1 天真的前进一天", () => {
    // 曾经的 bug：对 +08:00 的零点加一天后取 toISOString 的 UTC 日期，结果原地不动
    expect(addDaysToDateStr("2026-10-27", 1)).toBe("2026-10-28");
  });

  it("连续递增不会卡住", () => {
    let cursor = "2026-10-27";
    const seen = [cursor];
    for (let i = 0; i < 5; i += 1) {
      cursor = addDaysToDateStr(cursor, 1);
      seen.push(cursor);
    }
    expect(new Set(seen).size).toBe(6);
    expect(seen[5]).toBe("2026-11-01");
  });

  it("跨月正确", () => {
    expect(addDaysToDateStr("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDaysToDateStr("2026-11-01", -1)).toBe("2026-10-31");
  });

  it("跨年正确", () => {
    expect(addDaysToDateStr("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("加出来的日期对应正确的星期", () => {
    // 2026-10-27 是周二，+1 应该是周三
    expect(new Date(`${addDaysToDateStr("2026-10-27", 1)}T12:00:00+08:00`).getDay()).toBe(3);
  });
});

describe("上海时区格式化", () => {
  it("todayInShanghai 是 YYYY-MM-DD", () => {
    expect(todayInShanghai()).toMatch(DATE_RE);
  });

  it("格式化用上海时间而不是 UTC", () => {
    // UTC 10-26 16:30 = 上海 10-27 00:30
    const date = new Date("2026-10-26T16:30:00.000Z");
    expect(formatDayKey(date)).toBe("10-27");
    expect(formatHM(date)).toBe("00:30");
    expect(formatShortDayCN(date)).toBe("10-27 周二");
  });

  it("toShanghaiIso 与 ISO 往返一致", () => {
    expect(toShanghaiIso("2026-10-28", "14:00")).toBe("2026-10-28T06:00:00.000Z");
  });
});
