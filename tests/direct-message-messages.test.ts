import { describe, expect, it } from "vitest";
import { makeMessageMethods } from "@/adapters/db/prisma/direct-message-messages";
import { makeFakeDb, rawMessage } from "./_fake-messaging-db";

/**
 * 消息部分适配器测试。
 *
 * 重点：
 * 1. appendMessage 必须「建消息 + 推 lastMessageAt」在同一事务里
 *    —— 分开做会让列表页排序错位或显示旧内容。
 * 2. 已读标记只能碰「别人发的 + 还没读过」的，不能顺手把我自己发的标已读。
 * 3. countUnreadMessages 空线程时直接 0，不发 count 查询。
 */

describe("markPeerMessagesRead", () => {
  it("where 三条件：本线程 + 不是我发的 + 未读", async () => {
    const { db, log } = makeFakeDb({ updatedCount: 2 });
    const at = new Date("2026-10-03T00:00:00Z");
    const n = await makeMessageMethods(db).markPeerMessagesRead("t_1", "s_1", at);

    expect(log[0].op).toBe("directMessage.updateMany");
    expect(log[0].args.where).toEqual({
      threadId: "t_1",
      senderId: { not: "s_1" },
      readAt: null,
    });
    expect(log[0].args.data).toEqual({ readAt: at });
    expect(n).toBe(2);
  });
});

describe("listMessages", () => {
  it("按 createdAt 升序 + take 上限", async () => {
    const { db, log } = makeFakeDb({ messages: [rawMessage] });
    const out = await makeMessageMethods(db).listMessages("t_1", 200);

    expect(log[0].args.where).toEqual({ threadId: "t_1" });
    expect(log[0].args.orderBy).toEqual({ createdAt: "asc" });
    expect(log[0].args.take).toBe(200);
    expect(out[0].content).toBe("周五下午方便吗？");
  });

  it("返回领域记录（Date 不转字符串，转换留给用例层）", async () => {
    const { db } = makeFakeDb({ messages: [rawMessage] });
    const [m] = await makeMessageMethods(db).listMessages("t_1", 200);
    expect(m.createdAt).toBeInstanceOf(Date);
  });
});

describe("appendMessage", () => {
  it("⚠️ 建消息与推 lastMessageAt 在同一个事务里", async () => {
    const { db, log } = makeFakeDb({ createdMessage: rawMessage });
    await makeMessageMethods(db).appendMessage({
      threadId: "t_1",
      senderId: "r_1",
      content: "周五下午方便吗？",
      at: new Date("2026-10-02T00:00:00Z"),
    });

    const ops = log.map((l) => l.op);
    expect(ops).toContain("$transaction");
    expect(ops).toContain("directMessage.create");
    expect(ops).toContain("directThread.update");

    // 事务必须在两个写操作之前开启
    expect(ops.indexOf("$transaction")).toBeLessThan(ops.indexOf("directMessage.create"));
  });

  it("消息内容与推送时间都正确写入", async () => {
    const { db, log } = makeFakeDb({ createdMessage: rawMessage });
    const at = new Date("2026-10-02T00:00:00Z");
    await makeMessageMethods(db).appendMessage({
      threadId: "t_1",
      senderId: "r_1",
      content: "周五下午方便吗？",
      at,
    });

    const create = log.find((l) => l.op === "directMessage.create")!;
    expect(create.args.data).toEqual({
      threadId: "t_1",
      senderId: "r_1",
      content: "周五下午方便吗？",
    });
    const update = log.find((l) => l.op === "directThread.update")!;
    expect(update.args.data).toEqual({ lastMessageAt: at });
  });
});

describe("countUnreadMessages", () => {
  it("先取线程 id 再 count，where 只算别人发的未读", async () => {
    const { db, log } = makeFakeDb({
      threadIds: [{ id: "t_1" }, { id: "t_2" }],
      unreadCount: 5,
    });
    const n = await makeMessageMethods(db).countUnreadMessages("s_1", "SUBJECT");

    expect(log[0].args.where).toEqual({ subjectId: "s_1" });
    expect(log[0].args.select).toEqual({ id: true });
    const countCall = log.find((l) => l.op === "directMessage.count")!;
    expect(countCall.args.where.threadId).toEqual({ in: ["t_1", "t_2"] });
    expect(countCall.args.where.senderId).toEqual({ not: "s_1" });
    expect(n).toBe(5);
  });

  it("RESEARCHER 按 researcherId 取线程", async () => {
    const { db, log } = makeFakeDb({ threadIds: [{ id: "t_1" }] });
    await makeMessageMethods(db).countUnreadMessages("r_1", "RESEARCHER");
    expect(log[0].args.where).toEqual({ researcherId: "r_1" });
  });

  it("⚠️ 一条线程都没有时直接返回 0，不发 count 查询", async () => {
    const { db, log } = makeFakeDb({ threadIds: [] });
    const n = await makeMessageMethods(db).countUnreadMessages("s_1", "SUBJECT");

    expect(n).toBe(0);
    expect(log.map((l) => l.op)).toEqual(["directThread.findMany"]);
  });
});
