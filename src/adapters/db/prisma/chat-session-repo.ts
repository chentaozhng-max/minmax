/**
 * Prisma 实现：ChatSessionRepository。
 *
 * 这个仓储存在的直接原因：src/server/agent.ts 里有 7 处
 * 一模一样的 `prisma.chatSession.update({ data: { messages, state } })`。
 * 同一个概念写 7 遍，改一次要改 7 个地方 —— 这才是真问题，不是"分层漂亮"。
 */
import type { ChatSessionRepository, ChatSessionRecord } from "@/domain/ports/repositories";
import type { PrismaClientLike } from "./types";

type RawChatSession = {
  id: string;
  experimentId: string;
  subjectId: string;
  state: string;
  messages: string;
  createdAt: Date;
  updatedAt: Date;
};

function toRecord(raw: RawChatSession): ChatSessionRecord {
  return {
    id: raw.id,
    experimentId: raw.experimentId,
    subjectId: raw.subjectId,
    state: raw.state,
    messages: raw.messages,
  };
}

export function makeChatSessionRepository(db: PrismaClientLike): ChatSessionRepository {
  return {
    async findByExperimentAndSubject(experimentId, subjectId) {
      const raw = (await db.chatSession.findUnique({
        where: { experimentId_subjectId: { experimentId, subjectId } },
      })) as RawChatSession | null;
      return raw ? toRecord(raw) : null;
    },

    async create(input) {
      const raw = (await db.chatSession.create({
        data: {
          experimentId: input.experimentId,
          subjectId: input.subjectId,
          state: input.state,
          messages: input.messages,
        },
      })) as RawChatSession;
      return toRecord(raw);
    },

    async save(id, state, messages) {
      const raw = (await db.chatSession.update({
        where: { id },
        data: { messages, state },
      })) as RawChatSession;
      return toRecord(raw);
    },
  };
}
