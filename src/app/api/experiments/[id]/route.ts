import { prisma } from "@/lib/prisma";
import { ok, handle, ApiError } from "@/lib/http";
import { currentUser } from "@/lib/auth";
import { getExperimentDetail, remainingOf } from "@/server/experiments";
import { checkEligibility } from "@/lib/credit";

type Params = { params: Promise<{ id: string }> };

export const GET = handle(async (_req: Request, { params }: Params) => {
  const { id } = await params;
  const now = new Date();
  const experiment = await getExperimentDetail(id);
  const viewer = await currentUser();

  const slots = experiment.slots
    .filter((s) => s.startAt.getTime() > now.getTime())
    .map((s) => ({
      id: s.id,
      startAt: s.startAt.toISOString(),
      endAt: s.endAt.toISOString(),
      capacity: s.capacity,
      bookedCount: s.bookedCount,
      remaining: remainingOf(s),
    }));

  const eligibility = viewer
    ? checkEligibility(
        {
          bannedUntil: viewer.bannedUntil,
          creditScore: viewer.creditScore,
          studentVerified: viewer.studentVerified,
          minCreditScore: experiment.minCreditScore,
          needsVerification: experiment.needsVerification,
        },
        now,
      )
    : ({ ok: true } as const);

  const myAppointments = viewer
    ? await prisma.appointment.findMany({
        where: { experimentId: id, subjectId: viewer.id },
        select: { id: true, slotId: true, status: true },
      })
    : [];

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
    researcher: {
      id: experiment.researcher.id,
      name: experiment.researcher.name,
      school: experiment.researcher.school,
      department: experiment.researcher.department,
      creditScore: experiment.researcher.creditScore,
      studentVerified: experiment.researcher.studentVerified,
      noShowCount: experiment.researcher.noShowCount,
    },
    slots,
    myAppointments,
    eligibility: eligibility.ok
      ? { ok: true }
      : { ok: false, reason: eligibility.reason, message: eligibility.message },
  });
});

/** 编辑实验（主试） */
export const PATCH = handle(async (req: Request, { params }: Params) => {
  const { id } = await params;
  const user = await currentUser();
  if (!user) throw new ApiError(401, "请先登录");
  const experiment = await prisma.experiment.findUnique({ where: { id } });
  if (!experiment) throw new ApiError(404, "实验不存在");
  if (experiment.researcherId !== user.id) throw new ApiError(403, "没有权限");

  const body = (await req.json()) as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  const allow = [
    "title",
    "description",
    "location",
    "durationMin",
    "rewardText",
    "requirements",
    "minCreditScore",
    "needsVerification",
    "status",
  ];
  for (const key of allow) {
    if (body[key] !== undefined) data[key] = body[key];
  }
  const updated = await prisma.experiment.update({ where: { id }, data });
  return ok({ id: updated.id, status: updated.status }, "已更新");
});
