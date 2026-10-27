import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/http";
import type { Role } from "@/lib/domain";

export type ThreadPeer = {
  id: string;
  name: string;
  school: string | null;
  department: string | null;
  studentVerified: boolean;
  creditScore: number;
};

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

/** 被试点主试头像 → 建（或复用）一条线程。同一个人跟同一个主试只有一条。 */
export async function openThread(input: {
  subjectId: string;
  researcherId: string;
  experimentId?: string | null;
}) {
  if (input.subjectId === input.researcherId) throw new ApiError(400, "不能给自己发消息");

  const researcher = await prisma.user.findUnique({ where: { id: input.researcherId } });
  if (!researcher || researcher.role !== "RESEARCHER") throw new ApiError(404, "主试不存在");

  const existing = await prisma.directThread.findUnique({
    where: {
      subjectId_researcherId: {
        subjectId: input.subjectId,
        researcherId: input.researcherId,
      },
    },
  });

  if (existing) {
    if (input.experimentId && existing.experimentId !== input.experimentId) {
      return prisma.directThread.update({
        where: { id: existing.id },
        data: { experimentId: input.experimentId },
      });
    }
    return existing;
  }

  return prisma.directThread.create({
    data: {
      subjectId: input.subjectId,
      researcherId: input.researcherId,
      experimentId: input.experimentId ?? null,
    },
  });
}

export async function listThreads(userId: string, role: Role): Promise<ThreadItem[]> {
  const where = role === "RESEARCHER" ? { researcherId: userId } : { subjectId: userId };

  const threads = await prisma.directThread.findMany({
    where,
    include: {
      subject: true,
      researcher: true,
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
    },
    orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }],
    take: 50,
  });

  const experimentIds = threads.map((t) => t.experimentId).filter((v): v is string => Boolean(v));
  const experiments = experimentIds.length
    ? await prisma.experiment.findMany({
        where: { id: { in: experimentIds } },
        select: { id: true, title: true },
      })
    : [];
  const titleOf = new Map(experiments.map((e) => [e.id, e.title]));

  const unreadRows = await prisma.directMessage.groupBy({
    by: ["threadId"],
    where: {
      threadId: { in: threads.map((t) => t.id) },
      senderId: { not: userId },
      readAt: null,
    },
    _count: { _all: true },
  });
  const unreadOf = new Map(unreadRows.map((r) => [r.threadId, r._count._all]));

  return threads.map((t) => {
    const peerUser = role === "RESEARCHER" ? t.subject : t.researcher;
    const last = t.messages[0];
    return {
      id: t.id,
      peer: {
        id: peerUser.id,
        name: peerUser.name,
        school: peerUser.school,
        department: peerUser.department,
        studentVerified: peerUser.studentVerified,
        creditScore: peerUser.creditScore,
      },
      experimentTitle: t.experimentId ? (titleOf.get(t.experimentId) ?? null) : null,
      lastMessage: last
        ? {
            content: last.content,
            createdAt: last.createdAt.toISOString(),
            mine: last.senderId === userId,
          }
        : null,
      unread: unreadOf.get(t.id) ?? 0,
      updatedAt: (t.lastMessageAt ?? t.createdAt).toISOString(),
    };
  });
}

/** 取线程并校验当前用户是当事人之一，同时把对方发来的消息标记为已读 */
export async function loadThread(userId: string, threadId: string) {
  const thread = await prisma.directThread.findUnique({
    where: { id: threadId },
    include: { subject: true, researcher: true },
  });
  if (!thread) throw new ApiError(404, "会话不存在");
  if (thread.subjectId !== userId && thread.researcherId !== userId) {
    throw new ApiError(403, "没有权限");
  }

  await prisma.directMessage.updateMany({
    where: { threadId, senderId: { not: userId }, readAt: null },
    data: { readAt: new Date() },
  });

  const messages = await prisma.directMessage.findMany({
    where: { threadId },
    orderBy: { createdAt: "asc" },
    take: 200,
  });

  const peer = thread.subjectId === userId ? thread.researcher : thread.subject;

  return {
    thread: {
      id: thread.id,
      myRole: (thread.subjectId === userId ? "SUBJECT" : "RESEARCHER") as "SUBJECT" | "RESEARCHER",
      peer: {
        id: peer.id,
        name: peer.name,
        school: peer.school,
        department: peer.department,
        studentVerified: peer.studentVerified,
        creditScore: peer.creditScore,
      } satisfies ThreadPeer,
    },
    messages: messages.map((m) => ({
      id: m.id,
      content: m.content,
      createdAt: m.createdAt.toISOString(),
      mine: m.senderId === userId,
    })) satisfies ThreadMessage[],
  };
}

export async function sendDirectMessage(input: {
  userId: string;
  threadId: string;
  content: string;
}) {
  const content = input.content.trim();
  if (!content) throw new ApiError(400, "消息不能为空");
  if (content.length > 500) throw new ApiError(400, "消息太长了（最多 500 字）");

  const thread = await prisma.directThread.findUnique({ where: { id: input.threadId } });
  if (!thread) throw new ApiError(404, "会话不存在");
  if (thread.subjectId !== input.userId && thread.researcherId !== input.userId) {
    throw new ApiError(403, "没有权限");
  }

  const now = new Date();
  const [message] = await prisma.$transaction([
    prisma.directMessage.create({
      data: { threadId: thread.id, senderId: input.userId, content },
    }),
    prisma.directThread.update({
      where: { id: thread.id },
      data: { lastMessageAt: now },
    }),
  ]);

  return { id: message.id, createdAt: message.createdAt.toISOString() };
}

export async function countUnreadThreads(userId: string, role: Role) {
  const where = role === "RESEARCHER" ? { researcherId: userId } : { subjectId: userId };
  const threads = await prisma.directThread.findMany({ where, select: { id: true } });
  if (threads.length === 0) return 0;
  return prisma.directMessage.count({
    where: {
      threadId: { in: threads.map((t) => t.id) },
      senderId: { not: userId },
      readAt: null,
    },
  });
}
