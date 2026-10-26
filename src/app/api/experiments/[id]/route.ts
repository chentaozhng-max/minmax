import { prisma } from "@/lib/prisma";
import { ok, handle, ApiError } from "@/lib/http";
import { editExperimentSchema } from "@/lib/domain";
import { currentUser, requireRole } from "@/lib/auth";
import { getExperimentDetail, remainingOf } from "@/server/experiments";
import { checkEligibility, isBanned } from "@/lib/credit";
import { ExperimentStatus } from "@/lib/domain";

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

/** 编辑实验（主试）：改信息 / 上下架。时段用 /slots/batch 追加。 */
export const PATCH = handle(async (req: Request, { params }: Params) => {
  const { id } = await params;
  const user = await requireRole("RESEARCHER");
  const experiment = await prisma.experiment.findUnique({
    where: { id },
    include: { slots: { orderBy: { startAt: "asc" } } },
  });
  if (!experiment) throw new ApiError(404, "实验不存在");
  if (experiment.researcherId !== user.id) throw new ApiError(403, "没有权限");

  const body = await req.json();
  const input = editExperimentSchema.parse(body);
  const now = new Date();

  if (input.status === ExperimentStatus.PUBLISHED && experiment.status !== ExperimentStatus.PUBLISHED) {
    if (isBanned(user.bannedUntil, now)) {
      throw new ApiError(403, "因累计未到场，你当前被限制发布实验");
    }
    const futureSlots = experiment.slots.filter((s) => s.startAt.getTime() > now.getTime());
    if (futureSlots.length === 0) throw new ApiError(400, "没有未来的时段，无法重新发布");
  }

  const data: Record<string, unknown> = {};
  for (const key of [
    "title",
    "description",
    "location",
    "durationMin",
    "rewardText",
    "requirements",
    "minCreditScore",
    "needsVerification",
    "status",
  ] as const) {
    if (input[key] !== undefined) data[key] = input[key];
  }

  if (input.signupDeadline) {
    const deadline = new Date(input.signupDeadline);
    if (Number.isNaN(deadline.getTime())) throw new ApiError(400, "报名截止时间格式不正确");
    const earliest = experiment.slots
      .map((s) => s.startAt)
      .filter((d) => d.getTime() > now.getTime())
      .sort((a, b) => a.getTime() - b.getTime())[0];
    if (earliest && deadline.getTime() >= earliest.getTime()) {
      throw new ApiError(400, "报名截止时间必须早于最早时段的开始时间");
    }
    data.signupDeadline = deadline;
  }

  const updated = await prisma.experiment.update({ where: { id }, data });
  return ok({ id: updated.id, status: updated.status }, "已保存");
});
