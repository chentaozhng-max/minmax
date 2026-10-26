import { prisma } from "@/lib/prisma";
import { ok, handle, ApiError } from "@/lib/http";
import { requireRole } from "@/lib/auth";
import { CREDIT } from "@/lib/credit";

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

  const now = new Date();

  return ok({
    id: experiment.id,
    title: experiment.title,
    description: experiment.description,
    location: experiment.location,
    durationMin: experiment.durationMin,
    rewardText: experiment.rewardText,
    type: experiment.type,
    groupSize: experiment.groupSize,
    requirements: experiment.requirements,
    minCreditScore: experiment.minCreditScore,
    needsVerification: experiment.needsVerification,
    signupDeadline: experiment.signupDeadline.toISOString(),
    status: experiment.status,
    slots: experiment.slots.map((s) => ({
      id: s.id,
      startAt: s.startAt.toISOString(),
      endAt: s.endAt.toISOString(),
      capacity: s.capacity,
      bookedCount: s.bookedCount,
      remaining: Math.max(0, s.capacity - s.bookedCount),
    })),
    applicants: experiment.appointments.map((a) => ({
      id: a.id,
      status: a.status,
      appealStatus: a.appealStatus,
      createdAt: a.createdAt.toISOString(),
      canConfirm: a.status === "AWAITING_RESEARCHER",
      canVerify: a.status === "CHECKED_IN",
      canMarkNoShow: a.status === "CONFIRMED" || a.status === "AWAITING_RESEARCHER",
      canAppealResolve: a.appealStatus === "PENDING",
      subject: {
        id: a.subject.id,
        name: a.subject.name,
        school: a.subject.school,
        studentId: a.subject.studentId,
        creditScore: a.subject.creditScore,
        studentVerified: a.subject.studentVerified,
        noShowCount: a.subject.noShowCount,
        lowCredit: a.subject.creditScore < CREDIT.LOW_CREDIT_THRESHOLD,
      },
      slot: {
        startAt: a.slot.startAt.toISOString(),
        endAt: a.slot.endAt.toISOString(),
        started: a.slot.startAt.getTime() <= now.getTime(),
      },
    })),
  });
});
