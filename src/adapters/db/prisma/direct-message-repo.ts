/**
 * Prisma 实现：DirectMessageRepository 组合入口。
 *
 * 线程部分 → direct-message-threads.ts
 * 消息部分 → direct-message-messages.ts
 * 合成在一个端口里，是因为二者共用同一个 `threadId` 归属判定语义，
 * 但拆文件是为了不撞 200 行上限。
 */
import { prisma } from "@/lib/prisma";
import type { DirectMessageRepository } from "@/domain/ports/messaging";
import type { MessagingClientLike } from "./types";
import { makeThreadMethods } from "./direct-message-threads";
import { makeMessageMethods } from "./direct-message-messages";

export function makeDirectMessageRepository(
  db: MessagingClientLike = prisma as unknown as MessagingClientLike,
): DirectMessageRepository {
  return {
    ...makeThreadMethods(db),
    ...makeMessageMethods(db),
  };
}
