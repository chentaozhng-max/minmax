import { ok, handle } from "@/lib/http";
import { requireRole } from "@/lib/auth";
import { submitQuestionnaireSchema } from "@/domain/schemas";
import { submitForSubject } from "@/server/questionnaire-service";

export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

/** 被试提交问卷。提交即触发一次模型计分，失败则留空等主试手动评分 */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const user = await requireRole("SUBJECT");
  const { id } = await ctx.params;
  const body = submitQuestionnaireSchema.parse(await req.json());

  const result = await submitForSubject({
    experimentId: id,
    subjectId: user.id,
    answers: body.answers,
  });

  // 分数不返回给被试：主试后台才看得到
  return ok({ submitted: true, scored: result.score !== null }, "问卷已提交");
});
