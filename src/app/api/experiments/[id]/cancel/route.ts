import { ok, handle } from "@/lib/http";
import { requireRole } from "@/lib/auth";
import { cancelExperimentByResearcher } from "@/server/appointments";

type Params = { params: Promise<{ id: string }> };

/** 主试取消整场实验：逐条按 Slot.startAt 判断是否 < 24h */
export const POST = handle(async (_req: Request, { params }: Params) => {
  const { id } = await params;
  const user = await requireRole("RESEARCHER");
  const result = await cancelExperimentByResearcher(id, user.id);
  // penalized 是"扣了几次"（一次动作只扣一次），不是"几条预约"；条数看 lateCount。
  const lateCount = result.total - result.waived;
  const summary =
    result.penalized > 0
      ? `已取消，${result.total} 条预约中 ${lateCount} 条距开始不足 24 小时，按规则记一次主试未到场（不按条数累计）`
      : `已取消，${result.total} 条预约距开始均超过 24 小时，不扣信誉分`;
  return ok(result, summary);
});
