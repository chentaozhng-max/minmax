import { ok, handle } from "@/lib/http";
import { requireRole } from "@/lib/auth";
import { suggestThresholdSchema } from "@/domain/schemas";
import { loadOwnedExperiment, suggestThreshold } from "@/server/questionnaire-service";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** 主试用一句话描述筛选要求，模型给一个分数线建议（不落库，由前端确认后保存） */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const user = await requireRole("RESEARCHER");
  const { id } = await ctx.params;
  await loadOwnedExperiment(id, user.id);
  const body = suggestThresholdSchema.parse(await req.json());
  return ok(await suggestThreshold({ experimentId: id, goal: body.goal }));
});
