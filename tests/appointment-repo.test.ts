import { describe, expect, it } from "vitest";
import { makeAppointmentRepository } from "@/adapters/db/prisma/appointment-repo";
import { makeBundle, makeUnitOfWork } from "@/adapters/db/prisma/unit-of-work";
import { AppointmentStatus } from "@/domain/constants";
import type { PrismaClientLike } from "@/adapters/db/prisma/types";

/**
 * AppointmentRepository + UnitOfWork 的实现测试。
 *
 * 焦点同样是**语义契约**，不是 Prisma 本身：
 *   1. findConflicts 的时间重叠条件是 `startAt < slot.endAt AND endAt > slot.startAt`
 *      —— 写反一个符号就会漏掉冲突或误报冲突
 *   2. findBySlotAndSubject 用的是复合唯一键 slotId_subjectId
 *   3. runInTransaction 里的仓储必须绑 tx（而不是绑外层 client）
 */

function makeFakeDb() {
  const log: { op: string; args: unknown }[] = [];

  const db = {
    $executeRaw: async () => 1,
    $transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(db),
    slot: { findUnique: async () => null },
    appointment: {
      findUnique: async (args: unknown) => {
        log.push({ op: "findUnique", args });
        return null;
      },
      findMany: async (args: unknown) => {
        log.push({ op: "findMany", args });
        return [];
      },
      create: async (args: unknown) => {
        log.push({ op: "create", args });
        const data = (args as { data: Record<string, unknown> }).data;
        return { id: "appt_1", ...data };
      },
      update: async (args: unknown) => {
        log.push({ op: "update", args });
        const a = args as { where: { id: string }; data: Record<string, unknown> };
        return { id: a.where.id, experimentId: "exp_1", slotId: "slot_1", subjectId: "sub_1", status: a.data.status, createdAt: a.data.createdAt };
      },
    },
  } as unknown as PrismaClientLike;

  return { db, log };
}

describe("findBySlotAndSubject", () => {
  it("用复合唯一键 slotId_subjectId 查询", async () => {
    const { db, log } = makeFakeDb();
    await makeAppointmentRepository(db).findBySlotAndSubject("slot_1", "sub_1");

    const where = (log[0].args as { where: unknown }).where;
    expect(where).toEqual({ slotId_subjectId: { slotId: "slot_1", subjectId: "sub_1" } });
  });

  it("查不到 → null", async () => {
    const { db } = makeFakeDb();
    expect(await makeAppointmentRepository(db).findBySlotAndSubject("s", "u")).toBeNull();
  });
});

describe("findConflicts —— 时间重叠判定", () => {
  const slot = {
    id: "slot_1",
    experimentId: "exp_1",
    startAt: new Date("2026-11-10T10:00:00Z"),
    endAt: new Date("2026-11-10T11:00:00Z"),
    capacity: 3,
    bookedCount: 0,
    experiment: {
      id: "exp_1",
      title: "T",
      researcherId: "r",
      status: "PUBLISHED" as const,
      signupDeadline: new Date(),
      minCreditScore: 0,
      needsVerification: false,
    },
  };

  it("时间重叠条件是 startAt < slot.endAt AND endAt > slot.startAt（符号不能反）", async () => {
    const { db, log } = makeFakeDb();
    await makeAppointmentRepository(db).findConflicts("sub_1", slot);

    const where = (log[0].args as { where: Record<string, any> }).where;
    expect(where.slot).toEqual({
      startAt: { lt: slot.endAt },
      endAt: { gt: slot.startAt },
    });
  });

  it("排除自己这一个时段（slotId not）", async () => {
    const { db, log } = makeFakeDb();
    await makeAppointmentRepository(db).findConflicts("sub_1", slot);

    const where = (log[0].args as { where: Record<string, any> }).where;
    expect(where.slotId).toEqual({ not: "slot_1" });
  });

  it("只查进行中的预约（已取消的不算冲突）", async () => {
    const { db, log } = makeFakeDb();
    await makeAppointmentRepository(db).findConflicts("sub_1", slot);

    const where = (log[0].args as { where: Record<string, any> }).where;
    expect(where.status.in).toContain(AppointmentStatus.PENDING_SUBJECT_CONFIRM);
    expect(where.status.in).not.toContain(AppointmentStatus.CANCELLED_BY_SUBJECT);
  });

  it("空结果 → 空数组", async () => {
    const { db } = makeFakeDb();
    expect(await makeAppointmentRepository(db).findConflicts("sub_1", slot)).toEqual([]);
  });
});

describe("reactivate —— 复活时必须清空全部旧痕迹", () => {
  it("清空 8 个可能残留的字段", async () => {
    const { db, log } = makeFakeDb();
    await makeAppointmentRepository(db).reactivate("appt_1", AppointmentStatus.PENDING_SUBJECT_CONFIRM, new Date());

    const data = (log[0].args as { data: Record<string, unknown> }).data;
    // 少清一个就会让用户带着上次的签到/失约记录复活
    for (const field of ["confirmedAt", "checkedInAt", "noShowAt", "appealStatus", "appealAt", "appealResolvedAt", "remindedAt"]) {
      expect(data[field], `${field} 必须清空`).toBeNull();
    }
  });
});

describe("UnitOfWork", () => {
  it("事务内的仓储绑到 tx（tx 发的 SQL 由 tx 记录）", async () => {
    const txCalls: string[] = [];
    const outerCalls: string[] = [];

    const tx = {
      $executeRaw: async (s: TemplateStringsArray) => {
        txCalls.push(s.join("?"));
        return 1;
      },
      slot: { findUnique: async () => null },
      appointment: { findUnique: async () => null, findMany: async () => [], create: async () => ({}), update: async () => ({}) },
    };

    const client = {
      $executeRaw: async (s: TemplateStringsArray) => {
        outerCalls.push(s.join("?"));
        return 1;
      },
      $transaction: async (cb: (t: unknown) => Promise<unknown>) => cb(tx),
      slot: { findUnique: async () => null },
      appointment: { findUnique: async () => null, findMany: async () => [], create: async () => ({}), update: async () => ({}) },
    } as unknown as PrismaClientLike;

    const uow = makeUnitOfWork(client);
    await uow.runInTransaction(async (t) => {
      await t.slots.tryOccupy("slot_1");
    });

    expect(txCalls).toHaveLength(1);
    expect(outerCalls).toHaveLength(0); // 关键：没有绕过事务直接用外层 client
  });

  it("事务外直接调用 slots 走外层 client", async () => {
    const outerCalls: string[] = [];
    const client = {
      $executeRaw: async (s: TemplateStringsArray) => {
        outerCalls.push(s.join("?"));
        return 1;
      },
      $transaction: async (cb: (t: unknown) => Promise<unknown>) => cb(client),
      slot: { findUnique: async () => null },
      appointment: { findUnique: async () => null, findMany: async () => [], create: async () => ({}), update: async () => ({}) },
    } as unknown as PrismaClientLike;

    await makeUnitOfWork(client).slots.tryOccupy("slot_1");
    expect(outerCalls).toHaveLength(1);
  });

  it("makeBundle 同时给出两个仓储", () => {
    const { db } = makeFakeDb();
    const bundle = makeBundle(db);
    expect(typeof bundle.slots.tryOccupy).toBe("function");
    expect(typeof bundle.appointments.create).toBe("function");
  });
});
