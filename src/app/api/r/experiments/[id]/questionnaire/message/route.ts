import { z } from "zod";
import { ok, handle, ApiError } from "@/lib/http";
import { requireRole } from "@/lib/auth";
import { loadOwnedExperiment, subjectHasResponse } from "@/server/questionnaire-service";
import { openThread } from "@/server/dm";

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  subjectId: z.string().min(1),
});

/**
 * 主试就答卷联系某个被试：建（或复用）私信线程，返回 threadId 供前端跳转。
 *
 * 两道闸：
 *   1. 实验必须是自己名下的（`loadOwnedExperiment`）
 *   2. 这个人必须在这门实验交过答卷 —— 否则拿到一个 userId 就能骚扰平台上任何人
 *
 * 只建线程不发内容：主试进对话页自己写，能看到之前的往来。
 */
export const POST = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const researcher = await requireRole("RESEARCHER");
  await loadOwnedExperiment(id, researcher.id);

  const body = bodySchema.parse(await req.json());
  if (!(await subjectHasResponse(id, body.subjectId))) {
    throw new ApiError(403, "这个人没有参加过你的这门实验");
  }

  const thread = await openThread({
    subjectId: body.subjectId,
    researcherId: researcher.id,
    experimentId: id,
  });

  return ok(thread, "已打开会话");
});
