import { ok, handle } from "@/lib/http";
import { requireRole } from "@/lib/auth";
import { loadOwnedExperiment, rescoreAll } from "@/server/questionnaire-service";

export const runtime = "nodejs";
/** 逐份调用模型，给足时间 */
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

export const POST = handle(async (_req: Request, ctx: Ctx) => {
  const user = await requireRole("RESEARCHER");
  const { id } = await ctx.params;
  await loadOwnedExperiment(id, user.id);
  return ok(await rescoreAll(id));
});
