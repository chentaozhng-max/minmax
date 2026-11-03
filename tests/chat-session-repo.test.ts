import { describe, expect, it } from "vitest";
import { makeChatSessionRepository } from "@/adapters/db/prisma/chat-session-repo";
import type { PrismaClientLike } from "@/adapters/db/prisma/types";

/**
 * ChatSessionRepository 实现测试。
 *
 * 这组用例存在的直接原因：重构前 agent.ts 里有 7 处一模一样的
 * `prisma.chatSession.update({ data: { messages, state } })`。
 * 现在它们合成一个 `save()`，测试要保证合并后语义没变。
 */

function makeFakeDb() {
  const log: { op: string; args: any }[] = [];
  const store: Record<string, any> = {};

  const db = {
    $executeRaw: async () => 0,
    slot: { findUnique: async () => null },
    appointment: { findUnique: async () => null, findMany: async () => [], create: async () => ({}), update: async () => ({}) },
    chatSession: {
      findUnique: async (args: any) => {
        log.push({ op: "findUnique", args });
        const key = `${args.where.experimentId_subjectId.experimentId}:${args.where.experimentId_subjectId.subjectId}`;
        return store[key] ?? null;
      },
      create: async (args: any) => {
        log.push({ op: "create", args });
        const row = { id: "cs_1", ...args.data };
        store[`${row.experimentId}:${row.subjectId}`] = row;
        return row;
      },
      update: async (args: any) => {
        log.push({ op: "update", args });
        return { id: args.where.id, experimentId: "e", subjectId: "s", ...args.data };
      },
    },
  } as unknown as PrismaClientLike;

  return { db, log };
}

describe("findByExperimentAndSubject", () => {
  it("用复合唯一键 experimentId_subjectId 查询", async () => {
    const { db, log } = makeFakeDb();
    await makeChatSessionRepository(db).findByExperimentAndSubject("exp_1", "sub_1");

    expect(log[0].args.where).toEqual({
      experimentId_subjectId: { experimentId: "exp_1", subjectId: "sub_1" },
    });
  });

  it("不存在 → null", async () => {
    const { db } = makeFakeDb();
    expect(await makeChatSessionRepository(db).findByExperimentAndSubject("x", "y")).toBeNull();
  });

  it("不把 createdAt / updatedAt 漏进领域记录", async () => {
    const { db } = makeFakeDb();
    const repo = makeChatSessionRepository(db);
    await repo.create({ experimentId: "e", subjectId: "s", state: "COLLECTING_AVAILABILITY", messages: "[]" });

    const rec = await repo.findByExperimentAndSubject("e", "s");
    expect(Object.keys(rec!).sort()).toEqual(["experimentId", "id", "messages", "state", "subjectId"]);
  });
});

describe("save —— 7 处重复 update 的合并点", () => {
  it("一次 update 同时写 messages 和 state（两步不能拆开）", async () => {
    const { db, log } = makeFakeDb();
    await makeChatSessionRepository(db).save("cs_1", "PROPOSED", '[{"role":"user"}]');

    expect(log).toHaveLength(1);
    expect(log[0].op).toBe("update");
    expect(log[0].args.data).toEqual({ messages: '[{"role":"user"}]', state: "PROPOSED" });
  });

  it("messages 是整份覆盖写（不是追加）", async () => {
    const { db, log } = makeFakeDb();
    await makeChatSessionRepository(db).save("cs_1", "CLOSED", "[]");

    // 只传 messages，没有 push/append 之类的增量字段
    expect(log[0].args.data.messages).toBe("[]");
  });

  it("按 id 更新（where 用主键，不是复合键）", async () => {
    const { db, log } = makeFakeDb();
    await makeChatSessionRepository(db).save("cs_42", "CLOSED", "[]");
    expect(log[0].args.where).toEqual({ id: "cs_42" });
  });
});

describe("ChatSessionRepository 接口", () => {
  it("假实现能满足接口（端口没绑死 Prisma 类型）", async () => {
    const repo: import("@/domain/ports/repositories").ChatSessionRepository = {
      async findByExperimentAndSubject() {
        return null;
      },
      async create(input) {
        return { id: "x", ...input };
      },
      async save(id, state, messages) {
        return { id, experimentId: "e", subjectId: "s", state, messages };
      },
    };
    expect((await repo.save("a", "b", "c")).state).toBe("b");
  });
});
