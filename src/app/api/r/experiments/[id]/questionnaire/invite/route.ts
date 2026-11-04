import { ok, handle } from "@/lib/http";
import { requireRole } from "@/lib/auth";
import { inviteQualifiedSchema } from "@/domain/schemas";
import { inviteByThreshold, loadOwnedExperiment } from "@/server/questionnaire-service";

type Ctx = { params: Promise<{ id: string }> };

/**
 * 按分数线给达标者发邀请。
 *
 * 只有主试点「发送」才会到这里 —— 模型可以建议分数线，但不能自己发消息。
 */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const user = await requireRole("RESEARCHER");
  const { id } = await ctx.params;
  const experiment = await loadOwnedExperiment(id, user.id);
  const body = inviteQualifiedSchema.parse(await req.json());

  const result = await inviteByThreshold({
    experimentId: id,
    researcherId: user.id,
    title: experiment.title,
    passScore: body.passScore,
    message: body.message ?? null,
  });

  return ok(result, `已通知 ${result.sent} 人`);
});
