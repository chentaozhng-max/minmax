import { ok, handle } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { assistantChatMessageSchema } from "@/lib/domain";
import { getAssistantChatView, sendAssistantTurn } from "@/server/assistant-agent";

/**
 * 门厅对话接口。
 *
 * GET  取当前对话（含开场白）。可带 `?sessionId=` 指定要读哪条会话。
 * POST 发一句话，返回整份对话 + 这一轮的 sessionId。
 *
 * 为什么前端要拿 sessionId：会话不再是「一人一条」，服务端无法从 subjectId
 * 推出「你想接着哪条」。靠 30 分钟时间窗猜只是兜底，一旦用户在两个窗口
 * 或两次访问之间切换，猜错就会把他的对话接到别人那条上（自己的另一条）。
 *
 * 每次返回**整份** messages 而不是增量：前端 setQueryData 直接替换，
 * 不用维护「乐观追加 + 回滚」那套，出错时界面也不会停在半截。
 */
export const GET = handle(async (req: Request) => {
  const user = await requireUser();
  const sessionId = new URL(req.url).searchParams.get("sessionId") ?? undefined;
  return ok(await getAssistantChatView(user.id, sessionId));
});

export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  const body = await req.json();
  const { content, sessionId, newSession } = assistantChatMessageSchema.parse(body);
  return ok(
    await sendAssistantTurn({ subjectId: user.id, text: content, sessionId, newSession }),
  );
});
