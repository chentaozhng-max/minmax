/**
 * Prisma 实现：AssistantThreadRepository。
 *
 * 消息存 JSON 字符串（与 ChatSession 一致），本文件负责序列化/反序列化，
 * 上层拿到的是解析好的数组。解析失败的条目**逐条丢弃**而不是整份重置：
 * 一条脏数据不该让人丢掉整段对话。
 */
import type {
  AssistantThreadMessage,
  AssistantThreadRecord,
  AssistantThreadRepository,
} from "@/domain/ports/assistant-thread";

type RawThread = {
  id: string;
  subjectId: string;
  messages: string;
};

export type AssistantThreadClientLike = {
  assistantThread: {
    findUnique(args: unknown): Promise<unknown>;
    upsert(args: unknown): Promise<unknown>;
  };
};

function parseMessages(raw: string): AssistantThreadMessage[] {
  let list: unknown;
  try {
    list = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];

  const out: AssistantThreadMessage[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    if (rec.role !== "user" && rec.role !== "assistant") continue;
    if (typeof rec.content !== "string") continue;
    out.push({
      role: rec.role,
      content: rec.content,
      createdAt: typeof rec.createdAt === "string" ? rec.createdAt : new Date(0).toISOString(),
      ...(Array.isArray(rec.toolCalls) ? { toolCalls: rec.toolCalls as AssistantThreadMessage["toolCalls"] } : {}),
    });
  }
  return out;
}

function toRecord(raw: RawThread): AssistantThreadRecord {
  return {
    id: raw.id,
    subjectId: raw.subjectId,
    messages: parseMessages(raw.messages),
  };
}

export function makeAssistantThreadRepository(
  db: AssistantThreadClientLike,
): AssistantThreadRepository {
  return {
    async findBySubject(subjectId) {
      const raw = (await db.assistantThread.findUnique({
        where: { subjectId },
      })) as RawThread | null;
      return raw ? toRecord(raw) : null;
    },

    async saveMessages(subjectId, messages) {
      const raw = (await db.assistantThread.upsert({
        where: { subjectId },
        create: { subjectId, messages: JSON.stringify(messages) },
        update: { messages: JSON.stringify(messages) },
      })) as RawThread;
      return toRecord(raw);
    },
  };
}
