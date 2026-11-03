import { describe, expect, it } from "vitest";
import { scheduleWindow, type ScheduleSlot } from "@/components/slot-schedule";

/** 2026-11-04 是周三，作为固定的一天来构造时段 */
const at = (day: string, time: string) =>
  new Date(`2026-11-${day}T${time}:00+08:00`).toISOString();

function slot(startDay: string, start: string, endDay: string, end: string): ScheduleSlot {
  return {
    id: `${startDay}-${start}`,
    startAt: at(startDay, start),
    endAt: at(endDay, end),
    capacity: 1,
    bookedCount: 0,
    names: [],
  };
}

describe("scheduleWindow —— 时间轴自动适配", () => {
  it("没有时段时给一个上午的固定范围，不是零高度", () => {
    expect(scheduleWindow([])).toEqual({ from: 8 * 60, to: 12 * 60 });
  });

  it("只有一个 45 分钟的时段也要铺满 3 小时，并完整包住它", () => {
    const { from, to } = scheduleWindow([slot("04", "11:00", "04", "11:45")]);
    expect(to - from).toBeGreaterThanOrEqual(180);
    expect(from).toBeLessThanOrEqual(11 * 60);
    expect(to).toBeGreaterThanOrEqual(11 * 60 + 45);
  });

  it("跨一整天的多个时段：前后各留半小时", () => {
    const { from, to } = scheduleWindow([
      slot("04", "09:00", "04", "09:45"),
      slot("05", "21:00", "05", "21:45"),
    ]);
    expect(from).toBe(8 * 60 + 30);
    expect(to).toBe(22 * 60 + 30);
  });

  it("跨日时段不越过 24:00，多出来的那截交给格子内部裁", () => {
    const { to } = scheduleWindow([slot("04", "23:30", "05", "00:15")]);
    expect(to).toBe(24 * 60);
  });

  it("凌晨的时段也不会有负的起点", () => {
    const { from, to } = scheduleWindow([slot("04", "01:00", "04", "01:45")]);
    expect(from).toBeGreaterThanOrEqual(0);
    expect(to).toBeLessThanOrEqual(24 * 60);
    expect(to - from).toBeGreaterThanOrEqual(180);
  });
});
