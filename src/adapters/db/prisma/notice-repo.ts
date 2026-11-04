/**
 * Prisma 实现：NoticePort。
 *
 * 一次写入三样东西，放在同一个事务里：
 *   Notification  —— 首页红点 / 通知列表
 *   DirectThread  —— 没有线程就建一条（同一对师生只有一条）
 *   DirectMessage —— 主试发出的那条私信
 *
 * 少写任何一处都会出现「有红点但点进去没内容」或「有对话但首页不提醒」。
 */
import { prisma } from "@/lib/prisma";
import type { NoticeInput, NoticePort } from "@/domain/ports/notice";

type Client = {
  notification: { create(args: unknown): Promise<unknown> };
  directThread: {
    findUnique(args: unknown): Promise<{ id: string } | null>;
    create(args: unknown): Promise<{ id: string }>;
    update(args: unknown): Promise<unknown>;
  };
  directMessage: { create(args: unknown): Promise<unknown> };
  $transaction: (fn: (tx: Client) => Promise<unknown>) => Promise<unknown>;
};

export function makeNoticeRepository(db: Client): NoticePort {
  return {
    async send(input: NoticeInput) {
      try {
        await db.$transaction(async (tx) => {
          await tx.notification.create({
            data: {
              userId: input.userId,
              kind: input.kind,
              experimentId: input.experimentId,
              content: input.content,
              channel: "IN_APP",
              createdAt: input.at,
            },
          });

          const existing = await tx.directThread.findUnique({
            where: {
              subjectId_researcherId: {
                subjectId: input.userId,
                researcherId: input.senderId,
              },
            },
            select: { id: true },
          });

          const threadId =
            existing?.id ??
            (
              await tx.directThread.create({
                data: {
                  subjectId: input.userId,
                  researcherId: input.senderId,
                  experimentId: input.experimentId,
                  createdAt: input.at,
                },
                select: { id: true },
              })
            ).id;

          await tx.directMessage.create({
            data: {
              threadId,
              senderId: input.senderId,
              content: input.content,
              createdAt: input.at,
            },
          });

          await tx.directThread.update({
            where: { id: threadId },
            data: { lastMessageAt: input.at },
          });
        });
        return true;
      } catch (error) {
        console.error("[notice] send failed", error instanceof Error ? error.message : error);
        return false;
      }
    },
  };
}

export function makeDefaultNoticeRepository(): NoticePort {
  return makeNoticeRepository(prisma as unknown as Client);
}
