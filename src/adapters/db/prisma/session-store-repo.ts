/**
 * Prisma 实现：SessionStore（门厅会话）。
 *
 * ## 只认 id，不认主人
 *
 * 归属校验在应用层（见 `domain/ports/session-store.ts` 的说明）。本文件里
 * `findOwned` 之所以要 `subjectId` 参数，是因为把它放进 `where` 里由数据库
 * 一次性判掉 —— 比「取回来再比对」少一次漏判的机会，且不多花一次查询。
 *
 * ## 时间字段是唯一的真相
 *
 * `endedAt === null` 活会话、`sealedAt !== null` 软结束。没有 status 枚举，
 * 所以这里没有状态机要维护，也没有「枚举值加了忘了加分支」的隐患。
 */
import {
  parseSessionMessages,
  stringifySessionMessages,
  type SessionMessage,
} from "@/domain/session-messages";
import type {
  AssistantSessionRecord,
  SessionEndReason,
  SessionStore,
} from "@/domain/ports/session-store";

/** 落到库里的原始行（字段可能因老数据缺失，全部按可选读） */
type RawThread = {
  id: string;
  subjectId: string;
  messages?: string | null;
  summary?: string | null;
  messageCount?: number | null;
  outcome?: string | null;
  outcomeRef?: string | null;
  endedAt?: Date | null;
  sealedAt?: Date | null;
  lastActiveAt?: Date | null;
  createdAt?: Date | null;
};

export type SessionStoreClientLike = {
  assistantThread: {
    create(args: unknown): Promise<unknown>;
    findFirst(args: unknown): Promise<unknown>;
    findUnique(args: unknown): Promise<unknown>;
    update(args: unknown): Promise<unknown>;
    updateMany(args: unknown): Promise<unknown>;
  };
};

const END_REASONS: SessionEndReason[] = [
  "USER_DONE",
  "IDLE",
  "BLOCKED",
  "NO_RESULT",
  "MAX_TURNS",
  "SUPERSEDED",
  "MANUAL",
];

/** 库里的字符串 → 联合类型。不认识的一律当 null，别让脏数据穿透到业务层 */
function parseOutcome(raw: string | null | undefined): SessionEndReason | null {
  if (!raw) return null;
  return (END_REASONS as string[]).includes(raw) ? (raw as SessionEndReason) : null;
}

function toRecord(raw: RawThread): AssistantSessionRecord {
  const messages: SessionMessage[] = parseSessionMessages(raw.messages ?? "[]");
  return {
    id: raw.id,
    subjectId: raw.subjectId,
    messages,
    summary: raw.summary ?? null,
    // 老数据没有这一列时为 0，但它的 messages 是真实的 —— 用长度兜底，
    // 让「历史有多长」在老会话上也有个差不多的答案。
    messageCount: raw.messageCount ?? messages.length,
    outcome: parseOutcome(raw.outcome),
    outcomeRef: raw.outcomeRef ?? null,
    endedAt: raw.endedAt ?? null,
    sealedAt: raw.sealedAt ?? null,
    createdAt: raw.createdAt ?? new Date(0),
    lastActiveAt: raw.lastActiveAt ?? raw.createdAt ?? new Date(0),
  };
}

export function makeSessionStore(db: SessionStoreClientLike, now: () => Date = () => new Date()): SessionStore {
  const stamp = () => now();

  async function updateOne(id: string, data: Record<string, unknown>): Promise<AssistantSessionRecord> {
    const raw = (await db.assistantThread.update({ where: { id }, data })) as RawThread;
    return toRecord(raw);
  }

  return {
    async create(subjectId) {
      const t = stamp();
      const raw = (await db.assistantThread.create({
        data: { subjectId, messages: "[]", lastActiveAt: t },
      })) as RawThread;
      return toRecord(raw);
    },

    async findOwned(id, subjectId) {
      // subjectId 进 where：不存在与不属于都得到 null，调用方无从区分
      const raw = (await db.assistantThread.findFirst({
        where: { id, subjectId },
      })) as RawThread | null;
      return raw ? toRecord(raw) : null;
    },

    async findActiveBySubject(subjectId, idleCutoff) {
      const raw = (await db.assistantThread.findFirst({
        where: { subjectId, endedAt: null, lastActiveAt: { gte: idleCutoff } },
        orderBy: { lastActiveAt: "desc" },
      })) as RawThread | null;
      return raw ? toRecord(raw) : null;
    },

    async save(id, input) {
      const data: Record<string, unknown> = {
        messages: stringifySessionMessages(input.messages),
        summary: input.summary,
        lastActiveAt: stamp(),
      };
      // 只有调用方明确给了才动 messageCount：压缩后 messages 变短，
      // 拿它的长度当历史长度会把审计信息越写越小。
      if (input.messageCount !== undefined) data.messageCount = input.messageCount;
      return updateOne(id, data);
    },

    async finalize(id, outcome, outcomeRef) {
      return updateOne(id, {
        endedAt: stamp(),
        outcome,
        outcomeRef: outcomeRef ?? null,
        lastActiveAt: stamp(),
      });
    },

    async seal(id) {
      return updateOne(id, { sealedAt: stamp(), lastActiveAt: stamp() });
    },

    async resume(id) {
      return updateOne(id, { sealedAt: null, lastActiveAt: stamp() });
    },

    async closeIdleBefore(cutoff) {
      const t = stamp();
      const res = (await db.assistantThread.updateMany({
        where: { endedAt: null, lastActiveAt: { lt: cutoff } },
        data: { endedAt: t, outcome: "IDLE" },
      })) as { count?: number };
      return res?.count ?? 0;
    },
  };
}
