/**
 * 私信用例层。
 *
 * Phase 4 3A：这里原有的 16 处 `prisma.xxx` 直连全部改走 `DirectMessageRepository`。
 * 本文件现在只做三件事：参数校验、归属判定、把领域记录翻译成 API 形状。
 *
 * 依赖方向：server/ → domain/ports/messaging ← adapters/db/prisma/direct-message-repo
 */
import { ApiError } from "@/lib/http";
import type { Role } from "@/lib/domain";
import type { DirectMessageRepository, DirectPeer, DirectThreadRecord } from "@/domain/ports/messaging";
import { makeDirectMessageRepository } from "@/adapters/db/prisma/direct-message-repo";

export type ThreadPeer = DirectPeer;

export type ThreadItem = {
  id: string;
  peer: ThreadPeer;
  experimentTitle: string | null;
  lastMessage: { content: string; createdAt: string; mine: boolean } | null;
  unread: number;
  updatedAt: string;
};

export type ThreadMessage = {
  id: string;
  content: string;
  createdAt: string;
  mine: boolean;
};

/** 端口只认这两个角色 —— ADMIN 走被试分支即可（它不可能有线程） */
const asMessagingRole = (role: Role): "SUBJECT" | "RESEARCHER" =>
  role === "RESEARCHER" ? "RESEARCHER" : "SUBJECT";

/** 当前用户在会话里的身份；「我是当事人」这件事只在 adapter 判一次 */
const sideOf = (thread: DirectThreadRecord, userId: string): "SUBJECT" | "RESEARCHER" =>
  thread.subjectId === userId ? "SUBJECT" : "RESEARCHER";

/** 被试点主试头像 → 建（或复用）一条线程。同一个人跟同一个主试只有一条。 */
export async function openThread(
  input: {
    subjectId: string;
    researcherId: string;
    experimentId?: string | null;
  },
  repo: DirectMessageRepository = makeDirectMessageRepository(),
) {
  if (input.subjectId === input.researcherId) throw new ApiError(400, "不能给自己发消息");

  const researcher = await repo.findResearcherForThread(input.researcherId);
  if (!researcher || researcher.role !== "RESEARCHER") throw new ApiError(404, "主试不存在");

  const existing = await repo.findThreadBetween(input.subjectId, input.researcherId);
  if (existing) {
    if (input.experimentId && existing.experimentId !== input.experimentId) {
      await repo.moveThreadToExperiment(existing.id, input.experimentId);
    }
    return { id: existing.id };
  }

  return repo.createThread({
    subjectId: input.subjectId,
    researcherId: input.researcherId,
    experimentId: input.experimentId ?? null,
  });
}

export async function listThreads(
  userId: string,
  role: Role,
  repo: DirectMessageRepository = makeDirectMessageRepository(),
): Promise<ThreadItem[]> {
  const rows = await repo.listThreadSummaries(userId, asMessagingRole(role));

  return rows.map((t) => ({
    id: t.id,
    peer: t.peer,
    experimentTitle: t.experimentTitle,
    lastMessage: t.lastMessage
      ? {
          content: t.lastMessage.content,
          createdAt: t.lastMessage.createdAt.toISOString(),
          mine: t.lastMessage.senderId === userId,
        }
      : null,
    unread: t.unread,
    updatedAt: t.updatedAt.toISOString(),
  }));
}

/** 取线程并校验当前用户是当事人之一，同时把对方发来的消息标记为已读 */
export async function loadThread(
  userId: string,
  threadId: string,
  repo: DirectMessageRepository = makeDirectMessageRepository(),
) {
  const access = await repo.findThreadForParticipant(threadId, userId);
  if (access.kind === "not-found") throw new ApiError(404, "会话不存在");
  if (access.kind === "forbidden") throw new ApiError(403, "没有权限");

  const thread = access.thread;
  await repo.markPeerMessagesRead(thread.id, userId, new Date());

  const messages = await repo.listMessages(thread.id, 200);
  const mySide = sideOf(thread, userId);

  return {
    thread: {
      id: thread.id,
      myRole: mySide,
      // 对方 = 我不是的那一侧
      peer: mySide === "SUBJECT" ? thread.researcher : thread.subject,
    },
    messages: messages.map((m): ThreadMessage => ({
      id: m.id,
      content: m.content,
      createdAt: m.createdAt.toISOString(),
      mine: m.senderId === userId,
    })),
  };
}

export async function sendDirectMessage(
  input: { userId: string; threadId: string; content: string },
  repo: DirectMessageRepository = makeDirectMessageRepository(),
) {
  const content = input.content.trim();
  if (!content) throw new ApiError(400, "消息不能为空");
  if (content.length > 500) throw new ApiError(400, "消息太长了（最多 500 字）");

  const access = await repo.findThreadForParticipant(input.threadId, input.userId);
  if (access.kind === "not-found") throw new ApiError(404, "会话不存在");
  if (access.kind === "forbidden") throw new ApiError(403, "没有权限");

  const message = await repo.appendMessage({
    threadId: access.thread.id,
    senderId: input.userId,
    content,
    at: new Date(),
  });

  return { id: message.id, createdAt: message.createdAt.toISOString() };
}

export async function countUnreadThreads(
  userId: string,
  role: Role,
  repo: DirectMessageRepository = makeDirectMessageRepository(),
) {
  return repo.countUnreadMessages(userId, asMessagingRole(role));
}
