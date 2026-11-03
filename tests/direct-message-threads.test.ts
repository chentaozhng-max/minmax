import { describe, expect, it } from "vitest";
import { makeThreadMethods } from "@/adapters/db/prisma/direct-message-threads";
import { makeFakeDb, rawThreadFull, rawThreadRow } from "./_fake-messaging-db";

/**
 * 线程部分适配器测试。
 *
 * 重点：
 * 1. 对方 User 必须收窄到 6 个字段 —— 原来 `include: { subject: true }`
 *    把整行 User（passwordHash / eduEmail / phone）交给前端。
 * 2. 空线程列表不能去查实验表和 groupBy（`in: []` 是「无条件」不是「无条件匹配」）。
 * 3. 404 与 403 分开返回，调用方不用再查一次。
 */

describe("findResearcherForThread", () => {
  it("只 select id + role，不取整行", async () => {
    const { db, log } = makeFakeDb({ researcher: { id: "r_1", role: "RESEARCHER", passwordHash: "leak" } });
    const r = await makeThreadMethods(db).findResearcherForThread("r_1");

    expect(log[0].args.select).toEqual({ id: true, role: true });
    expect(r).toEqual({ id: "r_1", role: "RESEARCHER" });
    expect(JSON.stringify(r)).not.toContain("leak");
  });

  it("查不到返回 null", async () => {
    const { db } = makeFakeDb({ researcher: null });
    expect(await makeThreadMethods(db).findResearcherForThread("nope")).toBeNull();
  });
});

describe("findThreadBetween / createThread", () => {
  it("按 subjectId+researcherId 联合键查，只 select 两个字段", async () => {
    const { db, log } = makeFakeDb({ threadFull: { id: "t_1", experimentId: "e_1" } });
    await makeThreadMethods(db).findThreadBetween("s_1", "r_1");

    expect(log[0].args.where).toEqual({
      subjectId_researcherId: { subjectId: "s_1", researcherId: "r_1" },
    });
    expect(log[0].args.select).toEqual({ id: true, experimentId: true });
  });

  it("建线程只 select id（调用方只用得到 id）", async () => {
    const { db, log } = makeFakeDb();
    const t = await makeThreadMethods(db).createThread({
      subjectId: "s_1",
      researcherId: "r_1",
      experimentId: null,
    });

    expect(log[0].op).toBe("directThread.create");
    expect(log[0].args.data).toEqual({
      subjectId: "s_1",
      researcherId: "r_1",
      experimentId: null,
    });
    expect(t.id).toBe("t_new");
  });
});

describe("listThreadSummaries", () => {
  it("取数形状：include 最后一条消息 + 按 lastMessageAt 倒序 + take 50", async () => {
    const { db, log } = makeFakeDb({ threads: [rawThreadRow], experiments: [{ id: "e_1", title: "面孔识别实验" }] });
    await makeThreadMethods(db).listThreadSummaries("s_1", "SUBJECT");

    const q = log[0].args;
    expect(q.where).toEqual({ subjectId: "s_1" });
    expect(q.take).toBe(50);
    expect(q.orderBy).toEqual([{ lastMessageAt: "desc" }, { createdAt: "desc" }]);
    expect(q.include.messages).toEqual({ orderBy: { createdAt: "desc" }, take: 1 });
  });

  it("RESEARCHER 视角按 researcherId 过滤", async () => {
    const { db, log } = makeFakeDb({ threads: [] });
    await makeThreadMethods(db).listThreadSummaries("r_1", "RESEARCHER");
    expect(log[0].args.where).toEqual({ researcherId: "r_1" });
  });

  it("⚠️ 对方只留 6 个字段，passwordHash / eduEmail 不外泄", async () => {
    const { db } = makeFakeDb({ threads: [rawThreadRow], experiments: [{ id: "e_1", title: "面孔识别实验" }] });
    const [item] = await makeThreadMethods(db).listThreadSummaries("s_1", "SUBJECT");

    expect(Object.keys(item.peer).sort()).toEqual([
      "creditScore", "department", "id", "name", "school", "studentVerified",
    ]);
    const json = JSON.stringify(item);
    expect(json).not.toContain("passwordHash");
    expect(json).not.toContain("eduEmail");
    expect(json).not.toContain("13900000002");
  });

  it("拼装：实验标题、最后一条消息、未读数、updatedAt 都落到一行里", async () => {
    const { db } = makeFakeDb({
      threads: [rawThreadRow],
      experiments: [{ id: "e_1", title: "面孔识别实验" }],
      unreadRows: [{ threadId: "t_1", _count: { _all: 3 } }],
    });
    const [item] = await makeThreadMethods(db).listThreadSummaries("s_1", "SUBJECT");

    expect(item.id).toBe("t_1");
    expect(item.peer.name).toBe("陈砚");
    expect(item.experimentTitle).toBe("面孔识别实验");
    expect(item.unread).toBe(3);
    expect(item.lastMessage).toEqual({
      content: "周五下午方便吗？",
      createdAt: new Date("2026-10-02T00:00:00Z"),
      senderId: "r_1",
    });
    expect(item.updatedAt).toEqual(new Date("2026-10-02T00:00:00Z"));
  });

  it("没有关联实验时 experimentTitle 为 null", async () => {
    const { db } = makeFakeDb({ threads: [{ ...rawThreadRow, experimentId: null }] });
    const [item] = await makeThreadMethods(db).listThreadSummaries("s_1", "SUBJECT");
    expect(item.experimentTitle).toBeNull();
  });

  it("没有消息时 lastMessage 为 null，updatedAt 退回 createdAt", async () => {
    const { db } = makeFakeDb({ threads: [{ ...rawThreadRow, messages: [], lastMessageAt: null }] });
    const [item] = await makeThreadMethods(db).listThreadSummaries("s_1", "SUBJECT");
    expect(item.lastMessage).toBeNull();
    expect(item.updatedAt).toEqual(new Date("2026-10-01T00:00:00Z"));
  });

  it("⚠️ 空线程列表直接返回 []，不查实验表也不 groupBy", async () => {
    const { db, log } = makeFakeDb({ threads: [] });
    const out = await makeThreadMethods(db).listThreadSummaries("s_1", "SUBJECT");

    expect(out).toEqual([]);
    expect(log.map((l) => l.op)).toEqual(["directThread.findMany"]);
  });
});

describe("findThreadForParticipant", () => {
  it("存在且我是被试 → kind=ok", async () => {
    const { db } = makeFakeDb({ threadFull: rawThreadFull });
    const acc = await makeThreadMethods(db).findThreadForParticipant("t_1", "s_1");
    expect(acc.kind).toBe("ok");
  });

  it("主试视角也 ok，且 peer 两侧都收窄过", async () => {
    const { db } = makeFakeDb({ threadFull: rawThreadFull });
    const acc = await makeThreadMethods(db).findThreadForParticipant("t_1", "r_1");
    if (acc.kind !== "ok") throw new Error("expected ok");
    expect(acc.thread.subject.name).toBe("林小满");
    expect(acc.thread.researcher.name).toBe("陈砚");
    expect(JSON.stringify(acc.thread)).not.toContain("leak");
  });

  it("线程不存在 → kind=not-found", async () => {
    const { db } = makeFakeDb({ threadFull: null });
    expect((await makeThreadMethods(db).findThreadForParticipant("nope", "s_1")).kind).toBe("not-found");
  });

  it("⚠️ 存在但不是我 → kind=forbidden（不是 not-found，调用方不用再查）", async () => {
    const { db, log } = makeFakeDb({ threadFull: rawThreadFull });
    const acc = await makeThreadMethods(db).findThreadForParticipant("t_1", "outsider");

    expect(acc.kind).toBe("forbidden");
    expect(log).toHaveLength(1); // 只查了一次
  });

  it("判完 404/403 后不再重复查数据库", async () => {
    const { db, log } = makeFakeDb({ threadFull: rawThreadFull });
    await makeThreadMethods(db).findThreadForParticipant("t_1", "s_1");
    expect(log).toHaveLength(1);
  });
});
