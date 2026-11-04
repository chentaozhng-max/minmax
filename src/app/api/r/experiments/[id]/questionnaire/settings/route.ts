import { ok, handle } from "@/lib/http";
import { requireRole } from "@/lib/auth";
import { z } from "zod";
import { loadOwnedExperiment } from "@/server/questionnaire-service";
import { makeDefaultQuestionnaireRepository } from "@/adapters/db/prisma/questionnaire-repo";

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({
  passScore: z.number().int().min(0).max(100).nullable(),
  scoringRule: z.string().max(2000).nullable().optional(),
});

/** 只改分数线 / 评分要求，不动题目 —— 后台调阈值时用 */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const user = await requireRole("RESEARCHER");
  const { id } = await ctx.params;
  await loadOwnedExperiment(id, user.id);

  const body = schema.parse(await req.json());
  const repo = makeDefaultQuestionnaireRepository();
  const questionnaire = await repo.findByExperiment(id);
  if (!questionnaire) return ok(null, "还没有问卷");

  await repo.updateSettings(questionnaire.id, {
    passScore: body.passScore,
    scoringRule: body.scoringRule ?? questionnaire.scoringRule,
  });

  return ok({ passScore: body.passScore }, "分数线已更新");
});
