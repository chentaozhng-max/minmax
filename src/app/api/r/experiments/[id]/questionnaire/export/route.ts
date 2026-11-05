import { NextResponse } from "next/server";
import { handle, ApiError } from "@/lib/http";
import { requireRole } from "@/lib/auth";
import { loadResponsesForExport } from "@/server/questionnaire-service";
import { buildResponseCsv, responseCsvFilename } from "@/application/export-questionnaire";

type Params = { params: Promise<{ id: string }> };

/**
 * 主试导出答卷（CSV）。
 *
 * 与日程表导出同一套约定：BOM、RFC 4180 转义、attachment 下载。
 * 归属检查在 `loadOwnedExperiment` 里，发生在读答卷之前 ——
 * 不能先查完再判断，那样别人的数据已经进内存了。
 */
export const GET = handle(async (_req: Request, { params }: Params) => {
  const { id } = await params;
  const researcher = await requireRole("RESEARCHER");

  const data = await loadResponsesForExport(id, researcher.id);
  if (!data) throw new ApiError(404, "这门实验还没有建问卷");

  const csv = buildResponseCsv({
    experimentTitle: data.experiment.title,
    passScore: data.questionnaire.passScore,
    questions: data.questionnaire.questions,
    responses: data.responses,
  });

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      // filename* 用 RFC 5987 编码中文名，filename 给老浏览器兜底
      "Content-Disposition": `attachment; filename="responses.csv"; filename*=UTF-8''${encodeURIComponent(
        responseCsvFilename(data.experiment.title),
      )}`,
      "Cache-Control": "no-store",
    },
  });
});
