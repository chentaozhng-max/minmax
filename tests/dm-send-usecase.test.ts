import { describe, expect, it } from "vitest";
import { sendDirectMessage } from "@/server/dm";
import { makeDirectMessageRepository } from "@/adapters/db/prisma/direct-message-repo";
import { makeFakeDb, rawThreadFull, rawMessage } from "./_fake-messaging-db";

/**
 * 私信用例层测试（发消息侧）。
 *
 * 校验顺序有讲究：先校验内容（400）、再查线程（404/403）——
 * 这条顺序变了，错误码就变了，前端提示也跟着变。
 */

function repoOf(overrides: Record<string, any>) {
  const { db, log } = makeFakeDb(overrides);
  return { repo: makeDirectMessageRepository(db), log };
}

/** 发一条消息的常见前置：线程存在 + 我发的那条被建出来 */
const sent = () =>
  repoOf({ threadFull: rawThreadFull, createdMessage: { ...rawMessage, senderId: "s_1" } });

describe("sendDirectMessage — 内容校验", () => {
  it("空白内容 → 400", async () => {
    const { repo } = repoOf({});
    await expect(
      sendDirectMessage({ userId: "s_1", threadId: "t_1", content: "   " }, repo),
    ).rejects.toThrow("消息不能为空");
  });

  it("超 500 字 → 400", async () => {
    const { repo } = repoOf({});
    await expect(
      sendDirectMessage({ userId: "s_1", threadId: "t_1", content: "字".repeat(501) }, repo),
    ).rejects.toThrow("消息太长了");
  });

  it("正好 500 字 → 放行（边界不能差一）", async () => {
    const { repo } = sent();
    await expect(
      sendDirectMessage({ userId: "s_1", threadId: "t_1", content: "字".repeat(500) }, repo),
    ).resolves.toBeTruthy();
  });

  it("⚠️ trim 之后才算长度：501 个空格夹字，含空白字符不影响判定", async () => {
    const { repo } = repoOf({});
    await expect(
      sendDirectMessage({ userId: "s_1", threadId: "t_1", content: `  ${"字".repeat(501)}  ` }, repo),
    ).rejects.toThrow("消息太长了");
  });

  it("内容两端空白被 trim 后再存", async () => {
    const { repo, log } = sent();
    await sendDirectMessage({ userId: "s_1", threadId: "t_1", content: "  你好  " }, repo);

    const create = log.find((l) => l.op === "directMessage.create")!;
    expect(create.args.data.content).toBe("你好");
  });

  it("⚠️ 内容非法时不去查线程（校验在前，省一次查询）", async () => {
    const { repo, log } = repoOf({});
    await expect(
      sendDirectMessage({ userId: "s_1", threadId: "t_1", content: "" }, repo),
    ).rejects.toThrow();
    expect(log).toHaveLength(0);
  });
});

describe("sendDirectMessage — 归属校验", () => {
  it("会话不存在 → 404", async () => {
    const { repo } = repoOf({ threadFull: null });
    await expect(
      sendDirectMessage({ userId: "s_1", threadId: "nope", content: "hi" }, repo),
    ).rejects.toThrow("会话不存在");
  });

  it("不是我 → 403（和取会话同一套判定）", async () => {
    const { repo } = repoOf({ threadFull: rawThreadFull });
    await expect(
      sendDirectMessage({ userId: "outsider", threadId: "t_1", content: "hi" }, repo),
    ).rejects.toThrow("没有权限");
  });

  it("⚠️ 校验失败时不写库", async () => {
    const { repo, log } = repoOf({ threadFull: rawThreadFull });
    await expect(
      sendDirectMessage({ userId: "outsider", threadId: "t_1", content: "hi" }, repo),
    ).rejects.toThrow();
    expect(log.some((l) => l.op === "directMessage.create")).toBe(false);
  });
});

describe("sendDirectMessage — 成功路径", () => {
  it("返回 id + ISO 时间", async () => {
    const { repo } = sent();
    const out = await sendDirectMessage({ userId: "s_1", threadId: "t_1", content: "好的" }, repo);
    expect(out.id).toBe("m_1");
    expect(out.createdAt).toBe("2026-10-02T00:00:00.000Z");
  });

  it("senderId 取当前用户，不信任入参里的其他身份", async () => {
    const { repo, log } = sent();
    await sendDirectMessage({ userId: "s_1", threadId: "t_1", content: "好的" }, repo);
    const create = log.find((l) => l.op === "directMessage.create")!;
    expect(create.args.data.senderId).toBe("s_1");
  });

  it("主试也能发（同一套逻辑，不按角色分支）", async () => {
    const { repo } = repoOf({
      threadFull: rawThreadFull,
      createdMessage: { ...rawMessage, senderId: "r_1" },
    });
    await expect(
      sendDirectMessage({ userId: "r_1", threadId: "t_1", content: "明天见" }, repo),
    ).resolves.toBeTruthy();
  });
});
