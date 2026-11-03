/**
 * Prisma 实现：DirectMessageRepository（线程部分）。
 *
 * 拆分原因：线程相关（找/建/改线程、列表页拼装）与消息相关（读写消息）
 * 各自都有相当体量，塞一个文件会超 200 行。见 direct-message-messages.ts。
 */
import type {
  DirectMessageRepository,
  DirectPeer,
  DirectThreadRecord,
  ThreadAccess,
  ThreadSummaryRecord,
} from "@/domain/ports/messaging";
import type { MessagingClientLike } from "./types";

type RawPeer = {
  id: string;
  name: string;
  school: string | null;
  department: string | null;
  studentVerified: boolean;
  creditScore: number;
};

type RawThreadWithPeers = {
  id: string;
  subjectId: string;
  researcherId: string;
  experimentId: string | null;
  subject: RawPeer;
  researcher: RawPeer;
};

/**
 * 只挑对外可见的六个字段。
 *
 * 以前是 `include: { subject: true, researcher: true }` —— 整行 User
 * （passwordHash / eduEmail / phone / refreshToken）一路传到前端。
 * 这里收窄后，多出来的字段根本没机会离开适配层。
 */
function toPeer(raw: RawPeer): DirectPeer {
  return {
    id: raw.id,
    name: raw.name,
    school: raw.school,
    department: raw.department,
    studentVerified: raw.studentVerified,
    creditScore: raw.creditScore,
  };
}

function toThread(raw: RawThreadWithPeers): DirectThreadRecord {
  return {
    id: raw.id,
    subjectId: raw.subjectId,
    researcherId: raw.researcherId,
    experimentId: raw.experimentId,
    subject: toPeer(raw.subject),
    researcher: toPeer(raw.researcher),
  };
}

/** 由 direct-message-repo.ts 组合进来；本文件只给线程那一半 */
export type ThreadMethods = Pick<
  DirectMessageRepository,
  | "findResearcherForThread"
  | "findThreadBetween"
  | "moveThreadToExperiment"
  | "createThread"
  | "listThreadSummaries"
  | "findThreadForParticipant"
>;

export function makeThreadMethods(db: MessagingClientLike): ThreadMethods {
  return {
    async findResearcherForThread(researcherId) {
      // select 而不是整行：建线程只需要「存在 + 是不是主试」
      const raw = (await db.user.findUnique({
        where: { id: researcherId },
        select: { id: true, role: true },
      })) as { id: string; role: string } | null;
      return raw;
    },

    async findThreadBetween(subjectId, researcherId) {
      const raw = (await db.directThread.findUnique({
        where: { subjectId_researcherId: { subjectId, researcherId } },
        select: { id: true, experimentId: true },
      })) as { id: string; experimentId: string | null } | null;
      return raw;
    },

    async moveThreadToExperiment(threadId, experimentId) {
      await db.directThread.update({ where: { id: threadId }, data: { experimentId } });
    },

    async createThread(input) {
      const raw = (await db.directThread.create({
        data: {
          subjectId: input.subjectId,
          researcherId: input.researcherId,
          experimentId: input.experimentId,
        },
        select: { id: true },
      })) as { id: string };
      return raw;
    },

    async listThreadSummaries(userId, role) {
      const where = role === "RESEARCHER" ? { researcherId: userId } : { subjectId: userId };

      const threads = (await db.directThread.findMany({
        where,
        include: {
          subject: true,
          researcher: true,
          messages: { orderBy: { createdAt: "desc" }, take: 1 },
        },
        orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }],
        take: 50,
      })) as (RawThreadWithPeers & {
        lastMessageAt: Date | null;
        createdAt: Date;
        messages: { content: string; createdAt: Date; senderId: string }[];
      })[];

      // 空线程列表时不要查实验表和 groupBy —— `in: []` 在 Prisma 里是「无条件」
      if (threads.length === 0) return [];
      const threadIds = threads.map((t) => t.id);
      const experimentIds = threads
        .map((t) => t.experimentId)
        .filter((v): v is string => Boolean(v));

      const experiments = experimentIds.length
        ? ((await db.experiment.findMany({
            where: { id: { in: experimentIds } },
            select: { id: true, title: true },
          })) as { id: string; title: string }[])
        : [];
      const titleOf = new Map(experiments.map((e) => [e.id, e.title]));

      const unreadRows = (await db.directMessage.groupBy({
        by: ["threadId"],
        where: { threadId: { in: threadIds }, senderId: { not: userId }, readAt: null },
        _count: { _all: true },
      })) as { threadId: string; _count: { _all: number } }[];
      const unreadOf = new Map(unreadRows.map((r) => [r.threadId, r._count._all]));

      return threads.map((t): ThreadSummaryRecord => {
        const peerUser = role === "RESEARCHER" ? t.subject : t.researcher;
        const last = t.messages[0];
        return {
          id: t.id,
          peer: toPeer(peerUser),
          experimentTitle: t.experimentId ? (titleOf.get(t.experimentId) ?? null) : null,
          lastMessage: last
            ? { content: last.content, createdAt: last.createdAt, senderId: last.senderId }
            : null,
          unread: unreadOf.get(t.id) ?? 0,
          updatedAt: t.lastMessageAt ?? t.createdAt,
        };
      });
    },

    async findThreadForParticipant(threadId, userId) {
      const raw = (await db.directThread.findUnique({
        where: { id: threadId },
        include: { subject: true, researcher: true },
      })) as RawThreadWithPeers | null;

      // 不存在与无权限分开返回：调用方分别回 404 / 403，不需要再查一次
      if (!raw) return { kind: "not-found" } satisfies ThreadAccess;
      if (raw.subjectId !== userId && raw.researcherId !== userId) {
        return { kind: "forbidden" } satisfies ThreadAccess;
      }
      return { kind: "ok", thread: toThread(raw) } satisfies ThreadAccess;
    },

  };
}
