import { ok, handle } from "@/lib/http";
import { requireRole } from "@/lib/auth";
import { saveQuestionnaireSchema } from "@/domain/schemas";
import { normalizeQuestionnaireDraft } from "@/domain/questionnaire";
import {
  getQuestionnaire,
  loadOwnedExperiment,
  saveQuestionnaire,
} from "@/server/questionnaire-service";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (_req: Request, ctx: Ctx) => {
  const user = await requireRole("RESEARCHER");
  const { id } = await ctx.params;
  await loadOwnedExperiment(id, user.id);
  return ok(await getQuestionnaire(id));
});

export const POST = handle(async (req: Request, ctx: Ctx) => {
  const user = await requireRole("RESEARCHER");
  const { id } = await ctx.params;
  const experiment = await loadOwnedExperiment(id, user.id);
  const body = saveQuestionnaireSchema.parse(await req.json());

  const normalized = normalizeQuestionnaireDraft(body, body.title);
  const questionnaire = await saveQuestionnaire(id, experiment.title, {
    title: normalized.title,
    intro: normalized.intro,
    questions: normalized.questions,
    scoringRule: body.scoringRule ?? null,
    passScore: body.passScore ?? null,
    sourceText: body.sourceText ?? null,
    publish: body.publish,
  });

  return ok(questionnaire);
});
