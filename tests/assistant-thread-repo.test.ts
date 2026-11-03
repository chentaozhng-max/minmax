import { describe, expect, it } from "vitest";
import { makeAssistantThreadRepository } from "@/adapters/db/prisma/assistant-thread-repo";

/**
 * 门厅会话仓储测试。
 *
 * 重点在两件事：
 *   1. 脏数据不能整份炸掉（一条坏消息只丢那一条）
 *   2. 首次写入用 upsert（否则「第一次进来」和「第二次进来」要写两套分支）
 */

function makeFake() {
  const calls: any[] = [];
  let stored: any = null;
  const db = {
    assistantThread: {
      findUnique: async (args: any) => {
        calls.push({ op: "findUnique", args });
        return stored;
      },
      upsert: async (args: any) => {
        calls.push({ op: "upsert", args });
        stored = { id: "th_1", subjectId: args.where.subjectId, messages: args.create.messages };
        return stored;
      },
    },
  };
  return { db, calls };
}

const msg = (content: string, role: "user" | "assistant" = "user") => ({
  role,
  content,
  createdAt: "2026-11-04T08:00:00.000Z",
});

describe("makeAssistantThreadRepository", () => {
  it("没有会话时返回 null", async () => {
    const { db } = makeFake();
    expect(await makeAssistantThreadRepository(db).findBySubject("sub_1")).toBeNull();
  });

  it("按 subjectId 查（一个被试一个门厅）", async () => {
    const { db, calls } = makeFake();
    await makeAssistantThreadRepository(db).findBySubject("sub_1");

    expect(calls[0].args).toEqual({ where: { subjectId: "sub_1" } });
  });

  it("首次保存走 upsert，create 里带 subjectId", async () => {
    const { db, calls } = makeFake();
    await makeAssistantThreadRepository(db).saveMessages("sub_1", [msg("你好")]);

    expect(calls[0].op).toBe("upsert");
    expect(calls[0].args.create.subjectId).toBe("sub_1");
    expect(JSON.parse(calls[0].args.create.messages)).toHaveLength(1);
  });

  it("读回来是解析好的数组，不是 JSON 字符串", async () => {
    const { db } = makeFake();
    const repo = makeAssistantThreadRepository(db);
    await repo.saveMessages("sub_1", [msg("你好"), msg("在的", "assistant")]);
    const got = await repo.findBySubject("sub_1");

    expect(got?.messages).toEqual([msg("你好"), msg("在的", "assistant")]);
  });

  it("⚠️ 坏了一条只丢那一条，不整份重置", async () => {
    const broken = JSON.stringify([
      { role: "user", content: "正常的", createdAt: "2026-11-04T08:00:00.000Z" },
      { role: "system", content: "角色不认识" },
      { role: "user", content: 123 },
      null,
      { role: "assistant", content: "也正常", createdAt: "2026-11-04T08:01:00.000Z" },
    ]);
    const db = {
      assistantThread: {
        findUnique: async () => ({ id: "th_1", subjectId: "sub_1", messages: broken }),
        upsert: async () => ({}),
      },
    };
    const got = await makeAssistantThreadRepository(db).findBySubject("sub_1");

    expect(got?.messages.map((m) => m.content)).toEqual(["正常的", "也正常"]);
  });

  it("整个 JSON 坏了 → 空数组，不抛异常", async () => {
    const db = {
      assistantThread: {
        findUnique: async () => ({ id: "th_1", subjectId: "sub_1", messages: "{不是 JSON" }),
        upsert: async () => ({}),
      },
    };
    const got = await makeAssistantThreadRepository(db).findBySubject("sub_1");

    expect(got?.messages).toEqual([]);
  });

  it("缺 createdAt 时补一个占位，不丢这条消息", async () => {
    const db = {
      assistantThread: {
        findUnique: async () => ({
          id: "th_1",
          subjectId: "sub_1",
          messages: JSON.stringify([{ role: "user", content: "没有时间" }]),
        }),
        upsert: async () => ({}),
      },
    };
    const got = await makeAssistantThreadRepository(db).findBySubject("sub_1");

    expect(got?.messages).toHaveLength(1);
    expect(typeof got?.messages[0].createdAt).toBe("string");
  });
});
