import { prisma } from "@/lib/prisma";
import { ok, handle, ApiError } from "@/lib/http";
import { requireRole } from "@/lib/auth";
import { formatResearcherDetail } from "@/server/experiments";
import { countQuestionnaireResponses } from "@/adapters/db/prisma/experiment-brief-repo";

type Params = { params: Promise<{ id: string }> };

/** 主试视角：实验详情 + 报名者列表 */
export const GET = handle(async (_req: Request, { params }: Params) => {
  const { id } = await params;
  const researcher = await requireRole("RESEARCHER");

  const experiment = await prisma.experiment.findUnique({
    where: { id },
    include: {
      slots: { orderBy: { startAt: "asc" } },
      appointments: {
        include: { subject: true, slot: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!experiment) throw new ApiError(404, "实验不存在");
  if (experiment.researcherId !== researcher.id) throw new ApiError(403, "没有权限");

  // 详情页要显示「收了多少份答卷」。这个查询很轻，直接串在后面，不值得和上面抢
  const detail = formatResearcherDetail(experiment);
  const responseStats = await countQuestionnaireResponses(id);
  return ok({ ...detail, ...responseStats });
});
