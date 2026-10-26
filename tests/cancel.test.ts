import { describe, expect, it } from "vitest";
import { shouldPenalizeResearcherCancel } from "@/lib/credit";

const NOW = new Date("2026-10-27T04:00:00.000Z");
const HOUR = 3600 * 1000;

describe("主试取消实验的 24 小时线（逐条判断）", () => {
  it("距时段开始 25 小时 → 不扣分", () => {
    expect(shouldPenalizeResearcherCancel(new Date(NOW.getTime() + 25 * HOUR), NOW)).toBe(false);
  });

  it("距时段开始正好 24 小时 → 不扣分（≥24h）", () => {
    expect(shouldPenalizeResearcherCancel(new Date(NOW.getTime() + 24 * HOUR), NOW)).toBe(false);
  });

  it("距时段开始 23.9 小时 → 记一次主试未到场", () => {
    expect(shouldPenalizeResearcherCancel(new Date(NOW.getTime() + 23.9 * HOUR), NOW)).toBe(true);
  });

  it("距时段开始 2 小时 → 记一次主试未到场", () => {
    expect(shouldPenalizeResearcherCancel(new Date(NOW.getTime() + 2 * HOUR), NOW)).toBe(true);
  });

  it("时段已经开始（负数小时）→ 仍然记一次", () => {
    expect(shouldPenalizeResearcherCancel(new Date(NOW.getTime() - 3 * HOUR), NOW)).toBe(true);
  });

  it("同一场实验里早晚两档分别判断，结果不同", () => {
    const early = new Date(NOW.getTime() + 48 * HOUR);
    const late = new Date(NOW.getTime() + 6 * HOUR);
    expect(shouldPenalizeResearcherCancel(early, NOW)).toBe(false);
    expect(shouldPenalizeResearcherCancel(late, NOW)).toBe(true);
  });
});
