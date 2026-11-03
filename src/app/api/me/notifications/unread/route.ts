import { ok, handle } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { makeDefaultNotificationRepository } from "@/adapters/db/prisma/notification-repo";

/**
 * 只回一个未读数。
 *
 * 前端每 30 秒轮询一次（见 components/notification-watch.tsx），
 * 所以这里**不能**复用列表接口 —— 那会把 50 条正文一起拉下来。
 * 一个 count 查询，返回一个数字。
 */
export const GET = handle(async () => {
  const user = await requireUser();
  const unread = await makeDefaultNotificationRepository().countUnread(user.id);
  return ok({ unread });
});
