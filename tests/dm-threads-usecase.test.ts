import { describe, expect, it } from "vitest";
import { countUnreadThreads, listThreads, loadThread, openThread } from "@/server/dm";
import { makeDirectMessageRepository } from "@/adapters/db/prisma/direct-message-repo";
import { makeFakeDb, rawThreadFull, rawThreadRow, rawMessage } from "./_fake-messaging-db";
import type { DirectMessageRepository } from "@/domain/ports/messaging";

/**
 * 私信用例层测试（线程侧）。
 *
 * 这批重构的核心承诺是「行为零变化」，所以这里重点测**用例层自己的职责**：
 * 参数校验、404/403 映射、日期转字符串、mine 判定。
 * 查询形状归适配器测试管，不在这里重复。
 */

function repoOf(overrides: Record<string, any>) {
  const { db, log } = makeFakeDb(overrides);
  return { repo: makeDirectMessageRepository(db), log };
}

describe("openThread", () => {
  it("给自己发消息 → 400", async () => {
    const { repo } = repoOf({});
    await expect(openThread({ subjectId: "u1", researcherId: "u1" }, repo)).rejects.toThrow(
      "不能给自己发消息",
    );
  });

  it("对方不存在 → 404", async () => {
    const { repo } = repoOf({ researcher: null });
    await expect(openThread({ subjectId: "s_1", researcherId: "nope" }, repo)).rejects.toThrow(
      "主试不存在",
    );
  });

  it("对方是被试不是主试 → 404（同一错误信息，不泄露存在性）", async () => {
    const { repo } = repoOf({ researcher: { id: "s_2", role: "SUBJECT" } });
    await expect(openThread({ subjectId: "s_1", researcherId: "s_2" }, repo)).rejects.toThrow(
      "主试不存在",
    );
  });

  it("已有线程、实验相同 → 直接复用，不改库", async () => {
    const { repo, log } = repoOf({
      researcher: { id: "r_1", role: "RESEARCHER" },
      threadFull: { id: "t_1", experimentId: "e_1" },
    });
    const out = await openThread({ subjectId: "s_1", researcherId: "r_1", experimentId: "e_1" }, repo);

    expect(out.id).toBe("t_1");
    expect(log.some((l) => l.op === "directThread.update")).toBe(false);
  });

  it("已有线程、换了实验 → 更新关联实验后复用同一线程", async () => {
    const { repo, log } = repoOf({
      researcher: { id: "r_1", role: "RESEARCHER" },
      threadFull: { id: "t_1", experimentId: "e_1" },
    });
    const out = await openThread({ subjectId: "s_1", researcherId: "r_1", experimentId: "e_9" }, repo);

    expect(out.id).toBe("t_1");
    const upd = log.find((l) => l.op === "directThread.update")!;
    expect(upd.args.data).toEqual({ experimentId: "e_9" });
  });

  it("没有线程 → 新建，experimentId 缺省为 null", async () => {
    const { repo, log } = repoOf({
      researcher: { id: "r_1", role: "RESEARCHER" },
      threadFull: null,
    });
    const out = await openThread({ subjectId: "s_1", researcherId: "r_1" }, repo);

    expect(out.id).toBe("t_new");
    const create = log.find((l) => l.op === "directThread.create")!;
    expect(create.args.data.experimentId).toBeNull();
  });
});

describe("listThreads", () => {
  it("mine 按 senderId 判定，日期转成 ISO 字符串", async () => {
    const { repo } = repoOf({
      threads: [rawThreadRow],
      experiments: [{ id: "e_1", title: "面孔识别实验" }],
    });
    const [item] = await listThreads("s_1", "SUBJECT", repo);

    expect(item.lastMessage).toEqual({
      content: "周五下午方便吗？",
      createdAt: "2026-10-02T00:00:00.000Z",
      mine: false, // 主试发的
    });
    expect(item.updatedAt).toBe("2026-10-02T00:00:00.000Z");
    expect(item.peer.name).toBe("陈砚");
  });

  it("主试视角 mine 反转", async () => {
    const { repo } = repoOf({
      threads: [
        { ...rawThreadRow, messages: [{ content: "好的", createdAt: new Date(), senderId: "r_1" }] },
      ],
      experiments: [],
    });
    const [item] = await listThreads("r_1", "RESEARCHER", repo);
    expect(item.lastMessage?.mine).toBe(true);
  });

  it("ADMIN 走被试分支（不抛错）", async () => {
    const { repo } = repoOf({ threads: [] });
    await expect(listThreads("a_1", "ADMIN" as never, repo)).resolves.toEqual([]);
  });
});

describe("loadThread", () => {
  it("不存在 → 404", async () => {
    const { repo } = repoOf({ threadFull: null });
    await expect(loadThread("s_1", "nope", repo)).rejects.toThrow("会话不存在");
  });

  it("不是我 → 403", async () => {
    const { repo } = repoOf({ threadFull: rawThreadFull });
    await expect(loadThread("outsider", "t_1", repo)).rejects.toThrow("没有权限");
  });

  it("被试视角 peer 是主试，myRole=SUBJECT", async () => {
    const { repo } = repoOf({ threadFull: rawThreadFull, messages: [rawMessage] });
    const out = await loadThread("s_1", "t_1", repo);

    expect(out.thread.myRole).toBe("SUBJECT");
    expect(out.thread.peer.name).toBe("陈砚");
    expect(out.messages[0].mine).toBe(false); // 主试发的
  });

  it("主试视角 peer 是被试，myRole=RESEARCHER", async () => {
    const { repo } = repoOf({ threadFull: rawThreadFull, messages: [rawMessage] });
    const out = await loadThread("r_1", "t_1", repo);

    expect(out.thread.myRole).toBe("RESEARCHER");
    expect(out.thread.peer.name).toBe("林小满");
    expect(out.messages[0].mine).toBe(true);
  });

  it("⚠️ 打开会话时把对方消息标为已读（就一次，只碰未读的）", async () => {
    const { repo, log } = repoOf({ threadFull: rawThreadFull, messages: [] });
    await loadThread("s_1", "t_1", repo);

    const marks = log.filter((l) => l.op === "directMessage.updateMany");
    expect(marks).toHaveLength(1);
    expect(marks[0].args.where.senderId).toEqual({ not: "s_1" });
  });

  it("⚠️ 404/403 时不写已读（不该在无权限的会话上留下写操作）", async () => {
    const { repo, log } = repoOf({ threadFull: rawThreadFull });
    await expect(loadThread("outsider", "t_1", repo)).rejects.toThrow();
    expect(log.some((l) => l.op === "directMessage.updateMany")).toBe(false);
  });
});

describe("countUnreadThreads", () => {
  it("透传给端口", async () => {
    const { repo } = repoOf({ threadIds: [{ id: "t_1" }], unreadCount: 4 });
    expect(await countUnreadThreads("s_1", "SUBJECT", repo)).toBe(4);
  });

  it("端口返回 0 时是 0 不是 undefined", async () => {
    const stub = { countUnreadMessages: async () => 0 } as unknown as DirectMessageRepository;
    expect(await countUnreadThreads("s_1", "SUBJECT", stub)).toBe(0);
  });
});
