import { NextResponse } from "next/server";
import { handle, ApiError } from "@/lib/http";
import { requireRole } from "@/lib/auth";
import { makeDefaultScheduleQuery } from "@/adapters/db/prisma/schedule-query";
import { buildScheduleCsv, scheduleCsvFilename } from "@/application/export-schedule";

type Params = { params: Promise<{ id: string }> };

/**
 * 主试导出日程表（CSV）。
 *
 * 两处安全约束：
 *   1. 必须是 RESEARCHER 角色
 *   2. 只能导出自己名下的实验 —— 归属检查在查数据之前，
 *      而不是查完再判断（后者会把别人的行读进内存）
 *
 * 不走 `ok()` 包装：导出件是文件，不是 JSON 信封。
 * 用 `Content-Disposition: attachment` 让浏览器直接下载而不是打开成文本。
 */
export const GET = handle(async (_req: Request, { params }: Params) => {
  const { id } = await params;
  const researcher = await requireRole("RESEARCHER");

  const rows = await makeDefaultScheduleQuery().listSchedule({
    experimentId: id,
    researcherId: researcher.id,
  });

  // 查不到行有两种可能：实验不存在，或者不是他的。
  // 两种都回 404 —— 不要用 403 告诉对方「这个实验存在但不属于你」。
  if (rows.length === 0) throw new ApiError(404, "实验不存在或没有权限");

  const title = rows[0].experimentTitle;
  const csv = buildScheduleCsv(rows);
  const filename = scheduleCsvFilename(title);

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      // filename* 用 RFC 5987 编码中文名，filename 给老浏览器兜底
      "Content-Disposition": `attachment; filename="schedule.csv"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
    },
  });
});
