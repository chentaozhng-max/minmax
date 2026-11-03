import { describe, expect, it } from "vitest";
import { assertBookable, SLOT_FULL_MESSAGE, type BookableInput } from "@/domain/booking-rules";
import { AppointmentStatus, ExperimentStatus } from "@/domain/constants";
import type { AppointmentWithSlot, SlotRecord } from "@/domain/ports/repositories";

/**
 * 报名规则纯函数测试 —— 零数据库、零 IO。
 *
 * 这些用例在 Phase 4 之前是「必须起一个真数据库才能验」的东西。
 * 拆出纯函数后，整组用例 5 毫秒跑完。
 */

const NOW = new Date("2026-11-05T00:00:00Z");

const experiment = (over = {}) => ({
  id: "exp_1",
  title: "情绪诱发实验",
  researcherId: "res_1",
  status: ExperimentStatus.PUBLISHED,
  signupDeadline: new Date("2026-11-09T00:00:00Z"),
  minCreditScore: 60,
  needsVerification: false,
  ...over,
});

const slot = (over = {}): SlotRecord => ({
  id: "slot_1",
  experimentId: "exp_1",
  startAt: new Date("2026-11-10T10:00:00Z"),
  endAt: new Date("2026-11-10T11:00:00Z"),
  capacity: 3,
  bookedCount: 0,
  experiment: experiment(),
  ...over,
});

const subject = (over = {}) => ({
  id: "sub_1",
  bannedUntil: null as Date | null,
  creditScore: 80,
  studentVerified: true,
  ...over,
});

const conflict = (title = "决策实验"): AppointmentWithSlot => ({
  id: "appt_x",
  experimentId: "exp_2",
  slotId: "slot_x",
  subjectId: "sub_1",
  status: AppointmentStatus.CONFIRMED,
  createdAt: NOW,
  slot: { id: "slot_x", startAt: new Date("2026-11-10T10:30:00Z"), endAt: new Date("2026-11-10T11:30:00Z"), experiment: { title } },
});

const existingWith = (status: AppointmentStatus) => ({
  id: "appt_1",
  experimentId: "exp_1",
  slotId: "slot_1",
  subjectId: "sub_1",
  status,
  createdAt: NOW,
});

const base = (over: Partial<BookableInput> = {}): BookableInput => ({
  experiment: experiment(),
  slot: slot(),
  subject: subject(),
  conflicts: [],
  existing: null,
  now: NOW,
  ...over,
});

describe("assertBookable — 正常通过", () => {
  it("一切都合规 → 返回 null", () => {
    expect(assertBookable(base())).toBeNull();
  });
});

describe("assertBookable — 实验状态", () => {
  it("实验是草稿 → 400", () => {
    const r = assertBookable(base({ experiment: experiment({ status: ExperimentStatus.DRAFT }) }));
    expect(r).toEqual({ status: 400, message: "该实验当前不接受报名" });
  });

  it("实验已关闭 → 400", () => {
    expect(assertBookable(base({ experiment: experiment({ status: ExperimentStatus.CLOSED }) }))?.status).toBe(400);
  });

  it("报名已截止（截止时间 == now）→ 400", () => {
    const r = assertBookable(base({ experiment: experiment({ signupDeadline: NOW }) }));
    expect(r).toEqual({ status: 400, message: "报名已截止" });
  });
});

describe("assertBookable — 时段", () => {
  it("时段已开始（startAt == now）→ 400", () => {
    const r = assertBookable(base({ slot: slot({ startAt: NOW }) }));
    expect(r).toEqual({ status: 400, message: "该时段已开始，无法预约" });
  });

  it("时段在过去 → 400", () => {
    const past = new Date("2026-11-01T00:00:00Z");
    expect(assertBookable(base({ slot: slot({ startAt: past, endAt: new Date("2026-11-01T01:00:00Z") }) }))?.status).toBe(400);
  });
});

describe("assertBookable — 身份", () => {
  it("主试报名自己的实验 → 400", () => {
    const r = assertBookable(base({ subject: subject({ id: "res_1" }) }));
    expect(r).toEqual({ status: 400, message: "不能报名自己发布的实验" });
  });
});

describe("assertBookable — 被试资格（复用 checkEligibility）", () => {
  it("封禁中 → 403 且提示剩余天数", () => {
    const bannedUntil = new Date("2026-11-08T00:00:00Z"); // 距 NOW 3 天
    const r = assertBookable(base({ subject: subject({ bannedUntil }) }));
    expect(r?.status).toBe(403);
    expect(r?.message).toContain("3 天后解除");
  });

  it("信誉分不足 → 403 且同时报出所需与现有分数", () => {
    const r = assertBookable(base({ subject: subject({ creditScore: 55 }) }));
    expect(r?.status).toBe(403);
    expect(r?.message).toContain("需 60");
    expect(r?.message).toContain("你 55");
  });

  it("需要学生认证但未认证 → 403", () => {
    const r = assertBookable(
      base({ experiment: experiment({ needsVerification: true }), subject: subject({ studentVerified: false }) }),
    );
    expect(r).toEqual({ status: 403, message: "需完成学生认证" });
  });

  it("需要认证且已认证 → 通过", () => {
    const r = assertBookable(
      base({ experiment: experiment({ needsVerification: true }), subject: subject({ studentVerified: true }) }),
    );
    expect(r).toBeNull();
  });
});

describe("assertBookable — 时间冲突", () => {
  it("有冲突 → 409 且报出冲突的实验名", () => {
    const r = assertBookable(base({ conflicts: [conflict("决策实验")] }));
    expect(r?.status).toBe(409);
    expect(r?.message).toBe("该时间段与你已预约的「决策实验」冲突");
  });

  it("多个冲突 → 只报第一个", () => {
    const r = assertBookable(base({ conflicts: [conflict("A实验"), conflict("B实验")] }));
    expect(r?.message).toContain("A实验");
    expect(r?.message).not.toContain("B实验");
  });
});

describe("assertBookable — 重复预约与复活", () => {
  it("已有待确认预约 → 409", () => {
    const r = assertBookable(base({ existing: existingWith(AppointmentStatus.PENDING_SUBJECT_CONFIRM) }));
    expect(r).toEqual({ status: 409, message: "你已经预约了这个时段" });
  });

  it("已有主试已确认预约 → 409", () => {
    expect(assertBookable(base({ existing: existingWith(AppointmentStatus.CONFIRMED) }))?.status).toBe(409);
  });

  it("旧记录是被试取消 → 允许复活，不报重复", () => {
    expect(assertBookable(base({ existing: existingWith(AppointmentStatus.CANCELLED_BY_SUBJECT) }))).toBeNull();
  });

  it("旧记录是未到场 → 允许复活", () => {
    expect(assertBookable(base({ existing: existingWith(AppointmentStatus.NO_SHOW) }))).toBeNull();
  });
});

describe("判定顺序（先全局后个体）", () => {
  it("实验已截止 + 用户被封禁 → 报「报名已截止」而不是封禁", () => {
    const r = assertBookable(
      base({
        experiment: experiment({ signupDeadline: NOW }),
        subject: subject({ bannedUntil: new Date("2026-11-30T00:00:00Z") }),
      }),
    );
    expect(r?.message).toBe("报名已截止");
  });

  it("用户被封禁 + 有冲突 → 报封禁（403）而不是冲突（409）", () => {
    const r = assertBookable(
      base({ subject: subject({ bannedUntil: new Date("2026-11-30T00:00:00Z") }), conflicts: [conflict()] }),
    );
    expect(r?.status).toBe(403);
  });

  it("时段已开始 + 有冲突 → 报时段已开始", () => {
    const r = assertBookable(base({ slot: slot({ startAt: NOW }), conflicts: [conflict()] }));
    expect(r?.message).toBe("该时段已开始，无法预约");
  });
});

describe("SLOT_FULL_MESSAGE", () => {
  it("是唯一的文案来源", () => {
    expect(SLOT_FULL_MESSAGE).toBe("这个时段刚刚被约满了，换一个吧");
  });
});
