import { ok, handle } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { loadThread } from "@/server/dm";

/** 取会话 + 消息，顺便把对方发来的消息标为已读 */
export const GET = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await params;
  const data = await loadThread(user.id, id);
  return ok(data);
});
