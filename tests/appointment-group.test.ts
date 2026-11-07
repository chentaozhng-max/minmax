import { describe, expect, it } from "vitest";
import { appointmentGroupOf } from "@/server/experiments";

/**
 * 「我的预约」的分组规则。
 *
 * 修过两个真实问题，都用用例钉住：
 *   1. 签到之后还挂在「待签到」里，角标一直是 1，用户以为漏签了一个
 *   2. 明天才开始的实验也显示「待签到」—— 那组永远是满的，反而看不出今天该去哪个
 */

const START = new Date("2026-11-07T14:00:00+08:00");
const END = new Date("2026-11-07T14:45:00+08:00");
const slot = { startAt: START, endAt: END };

/** 相对开始时间的偏移（分钟） */
const at = (minutes: number) => new Date(START.getTime() + minutes * 60_000);

describe("appointmentGroupOf — 签到窗口", () => {
  it("开始前 31 分钟还没开，留在「已确认」", () => {
    expect(appointmentGroupOf("CONFIRMED", slot, at(-31))).toBe("confirmed");
  });

  it("开始前 30 分钟整就开了", () => {
    expect(appointmentGroupOf("CONFIRMED", slot, at(-30))).toBe("checkin");
  });

  it("开始前 10 分钟在窗口内", () => {
    expect(appointmentGroupOf("CONFIRMED", slot, at(-10))).toBe("checkin");
  });

  it("刚开始那一刻能签", () => {
    expect(appointmentGroupOf("CONFIRMED", slot, at(0))).toBe("checkin");
  });

  it("时段结束那一刻还能签（边界含）", () => {
    expect(appointmentGroupOf("CONFIRMED", slot, at(45))).toBe("checkin");
  });

  it("时段结束后就不在「待签到」里了", () => {
    expect(appointmentGroupOf("CONFIRMED", slot, at(46))).toBe("confirmed");
  });

  it("明天才开始的实验不该出现在「待签到」", () => {
    const tomorrow = { startAt: new Date("2026-11-08T14:00:00+08:00"), endAt: new Date("2026-11-08T14:45:00+08:00") };
    expect(appointmentGroupOf("CONFIRMED", tomorrow, at(0))).toBe("confirmed");
  });

  it("拿不到时段时保守放在「已确认」，不要瞎猜成能签", () => {
    expect(appointmentGroupOf("CONFIRMED", null, at(0))).toBe("confirmed");
  });
});

describe("appointmentGroupOf — 状态归类", () => {
  it("⚠️ 已签到的进「已确认」，不能留在「待签到」", () => {
    // 留在 checkin 的话，签完了角标还是 1，用户会以为自己漏签了
    expect(appointmentGroupOf("CHECKED_IN", slot, at(0))).toBe("confirmed");
  });

  it("已签到但时段已经过了，也还是「已确认」（等主试确认）", () => {
    expect(appointmentGroupOf("CHECKED_IN", slot, at(120))).toBe("confirmed");
  });

  it("待被试确认 / 待主试确认都在「待确认」", () => {
    expect(appointmentGroupOf("PENDING_SUBJECT_CONFIRM", slot, at(-120))).toBe("pending");
    expect(appointmentGroupOf("AWAITING_RESEARCHER", slot, at(-120))).toBe("pending");
  });

  it("完成和未到都归「已完成」", () => {
    expect(appointmentGroupOf("COMPLETED", slot, at(200))).toBe("done");
    expect(appointmentGroupOf("NO_SHOW", slot, at(200))).toBe("done");
  });

  it("取消 / 释放归「已取消」", () => {
    expect(appointmentGroupOf("CANCELLED_BY_SUBJECT", slot, at(-120))).toBe("cancelled");
    expect(appointmentGroupOf("CANCELLED_BY_RESEARCHER", slot, at(-120))).toBe("cancelled");
  });
});
