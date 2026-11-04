import { ok, handle } from "@/lib/http";
import { requireRole } from "@/lib/auth";
import { importQuestionnaireDocument } from "@/server/questionnaire-service";

/** pdfjs / mammoth 都依赖 Node API，不能跑在 Edge 运行时 */
export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

/**
 * 上传文件 → 解析成文本 → 让模型出题。
 *
 * 这个接口**不落库**：返回的是一份草稿，主试在编辑器里改完再保存。
 * 这样解析错、题目跑偏都不会污染已有问卷。
 */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const user = await requireRole("RESEARCHER");
  const { id } = await ctx.params;

  const result = await importQuestionnaireDocument({
    experimentId: id,
    researcherId: user.id,
    form: await req.formData(),
  });

  return ok(result);
});
