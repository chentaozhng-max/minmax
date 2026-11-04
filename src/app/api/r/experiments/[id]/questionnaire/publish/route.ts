import { ok, handle } from "@/lib/http";
import { requireRole } from "@/lib/auth";
import { publishQuestionnaireSchema } from "@/domain/schemas";
import { loadOwnedExperiment, publishQuestionnaire } from "@/server/questionnaire-service";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handle(async (req: Request, ctx: Ctx) => {
  const user = await requireRole("RESEARCHER");
  const { id } = await ctx.params;
  await loadOwnedExperiment(id, user.id);
  const body = publishQuestionnaireSchema.parse(await req.json());
  await publishQuestionnaire(id, body.publish);
  return ok({ published: body.publish });
});
