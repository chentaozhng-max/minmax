import { describe, expect, it } from "vitest";
import { makeNoticeRepository } from "@/adapters/db/prisma/notice-repo";

type Call = { where?: unknown; data?: Record<string, unknown> };

type Db = {
  notification: { create: (args: unknown) => Promise<unknown> };
  directThread: {
    findUnique: () => Promise<{ id: string } | null>;
    create: (args: Call) => Promise<{ id: string }>;
    update: (args: Call) => Promise<Call>;
  };
  directMessage: { create: (args: unknown) => Promise<unknown> };
  $transaction: (fn: (tx: Db) => Promise<unknown>) => Promise<unknown>;
};

function makeDb(existingThreadId: string | null) {
  const updates: Call[] = [];
  const created: Call[] = [];

  const db: Db = {
    notification: { create: async (args: unknown) => args },
    directThread: {
      findUnique: async () => (existingThreadId ? { id: existingThreadId } : null),
      create: async (args: Call) => {
        created.push(args);
        return { id: "thread_new" };
      },
      update: async (args: Call) => {
        updates.push(args);
        return args;
      },
    },
    directMessage: { create: async (args: unknown) => args },
    $transaction: async (fn: (tx: typeof db) => Promise<unknown>) => fn(db),
  };

  return { db, updates, created };
}

const base = {
  userId: "subject_1",
  senderId: "researcher_1",
  experimentId: "exp_new",
  content: "你已通过筛选",
  at: new Date("2026-11-06T00:00:00.000Z"),
};

describe("makeNoticeRepository.send", () => {
  it("已有线程时，把实验标注更新成本次的实验", async () => {
    const { db, updates } = makeDb("thread_1");
    const repo = makeNoticeRepository(db as never);

    expect(await repo.send({ ...base, kind: "INVITE" })).toBe(true);

    expect(updates).toHaveLength(1);
    expect(updates[0].where).toEqual({ id: "thread_1" });
    expect(updates[0].data?.experimentId).toBe("exp_new");
    expect(updates[0].data?.lastMessageAt).toEqual(base.at);
  });

  it("新建线程时把实验写进去", async () => {
    const { db, created } = makeDb(null);
    const repo = makeNoticeRepository(db as never);

    await repo.send({ ...base, kind: "REJECT" });

    expect(created).toHaveLength(1);
    expect((created[0].data as Record<string, unknown>).experimentId).toBe("exp_new");
  });

  it("写失败返回 false 而不是抛异常 —— 单条发送失败不该拖垮整个操作", async () => {
    const db: Db = {
      notification: {
        create: async () => {
          throw new Error("db down");
        },
      },
      directThread: { findUnique: async () => null, create: async () => ({ id: "x" }), update: async (a) => a },
      directMessage: { create: async () => ({}) },
      $transaction: async (fn) => fn(db),
    };
    const repo = makeNoticeRepository(db as never);

    expect(await repo.send({ ...base, kind: "INVITE" })).toBe(false);
  });
});
