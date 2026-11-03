import { ok, handle } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { makeDefaultNotificationRepository } from "@/adapters/db/prisma/notification-repo";

/**
 * 站内通知列表。
 *
 * 路由只做三件事：鉴权 → 调仓储 → 投影成前端形状。
 * 没有任何业务判断 —— 该不该发提醒是应用层的事，这里只负责「读出来给他看」。
 */
export const GET = handle(async () => {
  const user = await requireUser();
  const repo = makeDefaultNotificationRepository();

  const [items, unread] = await Promise.all([
    repo.listForUser(user.id, 50),
    repo.countUnread(user.id),
  ]);

  return ok({
    unread,
    items: items.map((n) => ({
      id: n.id,
      kind: n.kind,
      level: n.level,
      content: n.content,
      experimentId: n.experimentId,
      appointmentId: n.appointmentId,
      read: n.readAt !== null,
      createdAt: n.createdAt.toISOString(),
    })),
  });
});
