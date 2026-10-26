import { prisma } from "@/lib/prisma";
import { ok, handle, ApiError } from "@/lib/http";

type Params = { params: Promise<{ id: string }> };

/** 主试主页：实验室信息 + 信誉分 + 已发布实验 */
export const GET = handle(async (_req: Request, { params }: Params) => {
  const { id } = await params;
  const researcher = await prisma.user.findUnique({
    where: { id },
    include: {
      experiments: {
        where: { status: "PUBLISHED" },
        include: { slots: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!researcher || researcher.role !== "RESEARCHER") throw new ApiError(404, "主试不存在");
  const now = new Date();

  return ok({
    id: researcher.id,
    name: researcher.name,
    school: researcher.school,
    department: researcher.department,
    creditScore: researcher.creditScore,
    noShowCount: researcher.noShowCount,
    studentVerified: researcher.studentVerified,
    createdAt: researcher.createdAt.toISOString(),
    experiments: researcher.experiments
      .map((e) => ({
        id: e.id,
        title: e.title,
        rewardText: e.rewardText,
        durationMin: e.durationMin,
        location: e.location,
        remainingSeats: e.slots
          .filter((s) => s.startAt.getTime() > now.getTime())
          .reduce((sum, s) => sum + Math.max(0, s.capacity - s.bookedCount), 0),
      }))
      .filter((e) => e.remainingSeats > 0),
  });
});
