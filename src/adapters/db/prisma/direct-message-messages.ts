/**
 * Prisma 实现：DirectMessageRepository（消息部分）。
 *
 * 与 direct-message-threads.ts 成对，由 direct-message-repo.ts 拼成一个完整端口。
 */
import type { DirectMessageRecord, DirectMessageRepository } from "@/domain/ports/messaging";
import type { MessagingClientLike } from "./types";

type RawMessage = {
  id: string;
  threadId: string;
  senderId: string;
  content: string;
  createdAt: Date;
};

function toRecord(raw: RawMessage): DirectMessageRecord {
  return {
    id: raw.id,
    threadId: raw.threadId,
    senderId: raw.senderId,
    content: raw.content,
    createdAt: raw.createdAt,
  };
}

export type MessageMethods = Pick<
  DirectMessageRepository,
  "markPeerMessagesRead" | "listMessages" | "appendMessage" | "countUnreadMessages"
>;

export function makeMessageMethods(db: MessagingClientLike): MessageMethods {
  return {
    async markPeerMessagesRead(threadId, userId, at) {
      return (await db.directMessage.updateMany({
        where: { threadId, senderId: { not: userId }, readAt: null },
        data: { readAt: at },
      })) as number;
    },

    async listMessages(threadId, limit) {
      const raws = (await db.directMessage.findMany({
        where: { threadId },
        orderBy: { createdAt: "asc" },
        take: limit,
      })) as RawMessage[];
      return raws.map(toRecord);
    },

    async appendMessage(input) {
      const created = (await db.$transaction(async (tx) => {
        const txDb = tx as MessagingClientLike;
        const message = (await txDb.directMessage.create({
          data: {
            threadId: input.threadId,
            senderId: input.senderId,
            content: input.content,
          },
        })) as RawMessage;
        await txDb.directThread.update({
          where: { id: input.threadId },
          data: { lastMessageAt: input.at },
        });
        return message;
      })) as RawMessage;
      return toRecord(created);
    },

    async countUnreadMessages(userId, role) {
      const where = role === "RESEARCHER" ? { researcherId: userId } : { subjectId: userId };
      const threads = (await db.directThread.findMany({
        where,
        select: { id: true },
      })) as { id: string }[];
      if (threads.length === 0) return 0;
      return (await db.directMessage.count({
        where: {
          threadId: { in: threads.map((t) => t.id) },
          senderId: { not: userId },
          readAt: null,
        },
      })) as number;
    },
  };
}
