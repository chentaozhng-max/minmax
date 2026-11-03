import { ok, handle } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { makeDefaultNotificationRepository } from "@/adapters/db/prisma/notification-repo";

/** 全部标记已读。返回受影响条数，前端据此刷新红点。 */
export const POST = handle(async () => {
  const user = await requireUser();
  const repo = makeDefaultNotificationRepository();
  const count = await repo.markAllRead(user.id, new Date());
  return ok({ count });
});
