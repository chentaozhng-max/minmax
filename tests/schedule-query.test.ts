import { describe, expect, it } from "vitest";
import { makeScheduleQuery } from "@/adapters/db/prisma/schedule-query";

const SLOT_START = new Date("2026-11-04T06:00:00.000Z"); // 上海 14:00
const SLOT_END = new Date("2026-11-04T06:30:00.000Z");

/** 假 Prisma：只实现 slot.findMany，记录 args 以便断言查询形状 */
function makeFakeSlotDb(slots: unknown[]) {
  const calls: unknown[] = [];
  return {
    db: {
      slot: {
        findMany: async (args: unknown) => {
          calls.push(args);
          return slots;
        },
      },
    },
    calls,
  };
}

function slot(overrides: Record<string, unknown> = {}) {
  return {
    id: "s1",
    experimentId: "e1",
    startAt: SLOT_START,
    endAt: SLOT_END,
    capacity: 3,
    bookedCount: 0,
    experiment: { title: "面孔识别实验", groupSize: 3, researcherId: "r1" },
    appointments: [],
    ...overrides,
  };
}

function appointment(id: string, name: string) {
  return {
    id,
    status: "CONFIRMED",
    checkedInAt: null,
    appealStatus: null,
    subject: {
      id: `u-${id}`,
      name,
      phone: "13800000000",
      school: "示范大学",
      studentId: "2023001",
      creditScore: 98,
      studentVerified: true,
    },
  };
}

describe("makeScheduleQuery", () => {
  it("不传实验 id → 不 where（总表）", async () => {
    const { db, calls } = makeFakeSlotDb([]);
    await makeScheduleQuery(db as never).listSchedule();
    expect((calls[0] as { where?: unknown }).where).toBeUndefined();
  });

  it("传实验 id → where 收窄（分表）", async () => {
    const { db, calls } = makeFakeSlotDb([]);
    await makeScheduleQuery(db as never).listSchedule({ experimentId: "e1" });
    expect((calls[0] as { where?: unknown }).where).toEqual({ experimentId: "e1" });
  });

  it("★ 传 researcherId → 只查自己的实验（导出路由的安全边界）", async () => {
    const { db, calls } = makeFakeSlotDb([]);
    await makeScheduleQuery(db as never).listSchedule({ researcherId: "r1" });
    expect((calls[0] as { where?: unknown }).where).toEqual({
      experiment: { researcherId: "r1" },
    });
  });

  it("两个条件同时给 → 同时收窄", async () => {
    const { db, calls } = makeFakeSlotDb([]);
    await makeScheduleQuery(db as never).listSchedule({ experimentId: "e1", researcherId: "r1" });
    expect((calls[0] as { where?: unknown }).where).toEqual({
      experimentId: "e1",
      experiment: { researcherId: "r1" },
    });
  });

  it("★ 没人报名的时段也出一行（以 Slot 为基表，不是以 Appointment 起）", async () => {
    const { db } = makeFakeSlotDb([slot()]);
    const rows = await makeScheduleQuery(db as never).listSchedule({ experimentId: "e1" });

    expect(rows).toHaveLength(1);
    expect(rows[0].appointmentId).toBeNull();
    expect(rows[0].subject).toBeNull();
    expect(rows[0].capacity).toBe(3);
    expect(rows[0].slotId).toBe("s1");
  });

  it("一个时段 3 个人 → 展开成 3 行，共享同一套时段字段", async () => {
    const { db } = makeFakeSlotDb([
      slot({
        bookedCount: 3,
        appointments: [
          appointment("a1", "张三"),
          appointment("a2", "李四"),
          appointment("a3", "王五"),
        ],
      }),
    ]);
    const rows = await makeScheduleQuery(db as never).listSchedule({ experimentId: "e1" });

    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.subject?.name)).toEqual(["张三", "李四", "王五"]);
    expect(new Set(rows.map((r) => r.slotId))).toEqual(new Set(["s1"]));
    expect(rows.every((r) => r.bookedCount === 3)).toBe(true);
  });

  it("混合：一格空、一格 2 人 → 3 行，且空的那行在前", async () => {
    const { db } = makeFakeSlotDb([
      slot({ id: "s1", appointments: [] }),
      slot({
        id: "s2",
        startAt: new Date("2026-11-04T08:00:00.000Z"),
        bookedCount: 2,
        appointments: [appointment("a1", "张三"), appointment("a2", "李四")],
      }),
    ]);
    const rows = await makeScheduleQuery(db as never).listSchedule({ experimentId: "e1" });

    expect(rows).toHaveLength(3);
    expect(rows[0].slotId).toBe("s1");
    expect(rows[0].subject).toBeNull();
    expect(rows[2].subject?.name).toBe("李四");
  });

  it("把 groupSize 透出来（团体实验主试要看到每组几个人）", async () => {
    const { db } = makeFakeSlotDb([slot()]);
    const rows = await makeScheduleQuery(db as never).listSchedule({ experimentId: "e1" });
    expect(rows[0].groupSize).toBe(3);
  });

  it("按开始时间与 id 排序（同一时刻多个时段时顺序稳定）", async () => {
    const { db, calls } = makeFakeSlotDb([]);
    await makeScheduleQuery(db as never).listSchedule({ experimentId: "e1" });
    expect((calls[0] as { orderBy?: unknown }).orderBy).toEqual([
      { startAt: "asc" },
      { id: "asc" },
    ]);
  });
});
