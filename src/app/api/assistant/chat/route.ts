import { ok, handle } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { chatMessageSchema } from "@/lib/domain";
import { getAssistantChatView, sendAssistantTurn } from "@/server/assistant-agent";

/**
 * 门厅对话接口。
 *
 * GET  取当前对话（含开场白）
 * POST 发一句话，返回整份对话
 *
 * 每次返回**整份** messages 而不是增量：前端 setQueryData 直接替换，
 * 不用维护「乐观追加 + 回滚」那套，出错时界面也不会停在半截。
 */
export const GET = handle(async () => {
  const user = await requireUser();
  return ok(await getAssistantChatView(user.id));
});

export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  const body = await req.json();
  const { content } = chatMessageSchema.parse(body);
  return ok(await sendAssistantTurn({ subjectId: user.id, text: content }));
});
