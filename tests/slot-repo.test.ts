import { describe, expect, it } from "vitest";
import { makeSlotRepository } from "@/adapters/db/prisma/slot-repo";
import type { PrismaClientLike } from "@/adapters/db/prisma/types";

/**
 * SlotRepository 的 Prisma 实现测试。
 *
 * 用假的 prisma 客户端（不用真数据库），焦点是**语义契约**：
 *
 *   1. tryOccupy 必须发一条带 `WHERE bookedCount < capacity` 的条件 UPDATE
 *      —— 这是防超卖的唯一实现点，被改写成「先查再改」就是回归
 *   2. release 必须用 MAX(...,0) 兜底，不允许减成负数
 *   3. findById 要把 Prisma 的嵌套形状摊平成领域记录的纯数据形状
 */

/** 记录发出过的 SQL，用来断言「条件 UPDATE 真的还在」 */
function makeFakeDb(opts: { affected?: number } = {}) {
  const calls: string[] = [];
  const db = {
    $executeRaw: async (strings: TemplateStringsArray) => {
      calls.push(strings.join("?")); // 把模板拼起来，值位置用 ? 代替
      return opts.affected ?? 1;
    },
    slot: {
      findUnique: async () => null,
    },
    appointment: {
      findUnique: async () => null,
      findMany: async () => [],
      create: async () => ({}),
      update: async () => ({}),
    },
  } as unknown as PrismaClientLike;
  return { db, calls };
}

describe("tryOccupy —— 防超卖的核心", () => {
  it("发出的 SQL 含条件 bookedCount < capacity", async () => {
    const { db, calls } = makeFakeDb({ affected: 1 });
    const repo = makeSlotRepository(db);

    await repo.tryOccupy("slot_1");

    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('UPDATE "Slot"');
    expect(calls[0]).toContain('"bookedCount" = "bookedCount" + 1');
    expect(calls[0]).toContain('"bookedCount" < "capacity"'); // ← 这一条是防超卖的命门
  });

  it("SQL 里没有「先查后改」的痕迹（不该出现 SELECT）", async () => {
    const { db, calls } = makeFakeDb();
    await makeSlotRepository(db).tryOccupy("slot_1");
    expect(calls[0].toUpperCase()).not.toContain("SELECT");
  });

  it("影响行数 > 0 → 返回 true", async () => {
    const { db } = makeFakeDb({ affected: 1 });
    expect(await makeSlotRepository(db).tryOccupy("slot_1")).toBe(true);
  });

  it("影响行数 == 0（满了）→ 返回 false", async () => {
    const { db } = makeFakeDb({ affected: 0 });
    expect(await makeSlotRepository(db).tryOccupy("slot_1")).toBe(false);
  });
});

describe("release", () => {
  it("用 MAX(...,0) 兜底，不会减成负数", async () => {
    const { db, calls } = makeFakeDb();
    await makeSlotRepository(db).release("slot_1");

    expect(calls[0]).toContain('"bookedCount" = MAX("bookedCount" - 1, 0)');
  });
});

describe("findById", () => {
  it("不存在 → null", async () => {
    const { db } = makeFakeDb();
    expect(await makeSlotRepository(db).findById("nope")).toBeNull();
  });

  it("把 Prisma 的嵌套形状摊平成纯数据记录", async () => {
    const db = {
      $executeRaw: async () => 0,
      slot: {
        findUnique: async () => ({
          id: "slot_1",
          experimentId: "exp_1",
          startAt: new Date("2026-11-10T10:00:00Z"),
          endAt: new Date("2026-11-10T11:00:00Z"),
          capacity: 3,
          bookedCount: 1,
          experiment: {
            id: "exp_1",
            title: "情绪诱发实验",
            researcherId: "res_1",
            status: "PUBLISHED",
            signupDeadline: new Date("2026-11-09T00:00:00Z"),
            minCreditScore: 60,
            needsVerification: false,
            // Prisma 可能带回来的额外字段，不该漏进领域记录
            createdAt: new Date(),
          },
        }),
      },
      appointment: { findUnique: async () => null, findMany: async () => [], create: async () => ({}), update: async () => ({}) },
    } as unknown as PrismaClientLike;

    const rec = await makeSlotRepository(db).findById("slot_1");

    expect(rec?.bookedCount).toBe(1);
    expect(rec?.experiment.title).toBe("情绪诱发实验");
    expect(Object.keys(rec!)).not.toContain("createdAt"); // 白名单式映射，脏字段不外泄
  });
});
