import { ok, handle } from "@/lib/http";
import { requireRole } from "@/lib/auth";
import { cancelExperimentByResearcher } from "@/server/appointments";

type Params = { params: Promise<{ id: string }> };

/** 主试取消整场实验：逐条按 Slot.startAt 判断是否 < 24h */
export const POST = handle(async (_req: Request, { params }: Params) => {
  const { id } = await params;
  const user = await requireRole("RESEARCHER");
  const result = await cancelExperimentByResearcher(id, user.id);
  const summary =
    result.penalized > 0
      ? `已取消，${result.total} 条预约中 ${result.penalized} 条距开始不足 24 小时，已记一次主试未到场`
      : `已取消，${result.total} 条预约距开始均超过 24 小时，不扣信誉分`;
  return ok(result, summary);
});
