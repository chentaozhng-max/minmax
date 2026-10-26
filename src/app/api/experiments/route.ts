import { prisma } from "@/lib/prisma";
import { ok, handle, ApiError } from "@/lib/http";
import { createExperimentSchema } from "@/lib/domain";
import { currentUser, requireRole } from "@/lib/auth";
import { listExperimentCards } from "@/server/experiments";
import { isBanned } from "@/lib/credit";
import { ExperimentStatus } from "@/lib/domain";

export const GET = handle(async (req: Request) => {
  const url = new URL(req.url);
  const viewer = await currentUser();
  const cards = await listExperimentCards({
    viewer: viewer
      ? {
          id: viewer.id,
          creditScore: viewer.creditScore,
          studentVerified: viewer.studentVerified,
          bannedUntil: viewer.bannedUntil,
        }
      : null,
    keyword: url.searchParams.get("keyword") ?? undefined,
    duration: url.searchParams.get("duration") ?? undefined,
    reward: url.searchParams.get("reward") ?? undefined,
    date: url.searchParams.get("date") ?? undefined,
    onlyEligible: url.searchParams.get("onlyEligible") === "true",
  });
  return ok(cards);
});

/** 发布实验（主试） */
export const POST = handle(async (req: Request) => {
  const user = await requireRole("RESEARCHER");
  const now = new Date();
  if (isBanned(user.bannedUntil, now)) {
    const until = user.bannedUntil ? user.bannedUntil.toISOString() : "";
    throw new ApiError(403, `因累计未到场，禁发布至 ${until.slice(0, 10)}`);
  }

  const body = await req.json();
  const input = createExperimentSchema.parse(body);

  const slotTimes = input.slots
    .map((s) => ({ startAt: new Date(s.startAt), endAt: new Date(s.endAt), capacity: s.capacity }))
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime());

  const deadline = new Date(input.signupDeadline);
  if (Number.isNaN(deadline.getTime())) throw new ApiError(400, "报名截止时间格式不正确");

  const earliest = slotTimes[0];
  if (deadline.getTime() >= earliest.startAt.getTime()) {
    throw new ApiError(400, "报名截止时间必须早于最早时段的开始时间");
  }
  for (const slot of slotTimes) {
    if (slot.endAt.getTime() <= slot.startAt.getTime()) {
      throw new ApiError(400, "时段的结束时间必须晚于开始时间");
    }
  }
  for (let i = 1; i < slotTimes.length; i += 1) {
    if (slotTimes[i].startAt.getTime() < slotTimes[i - 1].endAt.getTime()) {
      throw new ApiError(400, "时段之间存在重叠，请检查后重试");
    }
  }

  const created = await prisma.experiment.create({
    data: {
      researcherId: user.id,
      title: input.title,
      description: input.description,
      location: input.location,
      durationMin: input.durationMin,
      rewardText: input.rewardText,
      type: input.type,
      groupSize: input.type === "GROUP" ? (input.groupSize ?? 2) : null,
      requirements: input.requirements ?? null,
      minCreditScore: input.minCreditScore,
      needsVerification: input.needsVerification,
      signupDeadline: deadline,
      status: input.publish ? ExperimentStatus.PUBLISHED : ExperimentStatus.DRAFT,
      slots: {
        create: slotTimes.map((s) => ({
          startAt: s.startAt,
          endAt: s.endAt,
          capacity: s.capacity,
        })),
      },
    },
  });

  return ok({ id: created.id, status: created.status }, input.publish ? "实验已发布" : "已保存为草稿");
});
