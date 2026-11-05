import { ok, handle } from "@/lib/http";
import { requireRole } from "@/lib/auth";
import { inviteQualifiedSchema } from "@/domain/schemas";
import { loadOwnedExperiment, notifyDeclinedByThreshold } from "@/server/questionnaire-service";

type Ctx = { params: Promise<{ id: string }> };

/**
 * 告知未通过筛选的人。
 *
 * 只发给「已判定为未通过、且还没告知过」的人；未算分的不发（还没判定）。
 * 和邀请一样，只有主试点「发送」才会到这里 —— 模型可以建议，不能自己发消息。
 */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const user = await requireRole("RESEARCHER");
  const { id } = await ctx.params;
  const experiment = await loadOwnedExperiment(id, user.id);
  const body = inviteQualifiedSchema.parse(await req.json());

  const result = await notifyDeclinedByThreshold({
    experimentId: id,
    researcherId: user.id,
    title: experiment.title,
    passScore: body.passScore,
    message: body.message ?? null,
  });

  return ok(result, result.sent > 0 ? `已告知 ${result.sent} 人` : "没有新的需要告知的人");
});
