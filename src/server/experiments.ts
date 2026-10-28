import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/http";
import { checkEligibility, CREDIT } from "@/lib/credit";
import {
  ACTIVE_APPOINTMENT_STATUSES,
  OCCUPYING_STATUSES,
  AppointmentStatus,
  ExperimentStatus,
  type AppointmentStatus as Status,
  type ExperimentType,
} from "@/lib/domain";
import { DAY } from "@/lib/time";

export type SlotView = {
  id: string;
  startAt: string;
  endAt: string;
  capacity: number;
  bookedCount: number;
  remaining: number;
};

export type CardView = {
  id: string;
  title: string;
  location: string;
  durationMin: number;
  rewardText: string;
  type: ExperimentType;
  groupSize: number | null;
  minCreditScore: number;
  needsVerification: boolean;
  signupDeadline: string;
  researcher: {
    id: string;
    name: string;
    school: string | null;
    creditScore: number;
    studentVerified: boolean;
  };
  remainingSeats: number;
  nextSlotAt: string | null;
  lowCreditResearcher: boolean;
  eligibility: { ok: boolean; reason?: string; message?: string };
};

export function remainingOf(slot: { capacity: number; bookedCount: number }) {
  return Math.max(0, slot.capacity - slot.bookedCount);
}

export async function listExperimentCards(params: {
  viewer: {
    id: string;
    creditScore: number;
    studentVerified: boolean;
    bannedUntil: Date | null;
  } | null;
  keyword?: string;
  duration?: string;
  reward?: string;
  date?: string;
  onlyEligible?: boolean;
  now?: Date;
}) {
  const now = params.now ?? new Date();
  const where: Record<string, unknown> = {
    status: ExperimentStatus.PUBLISHED,
    signupDeadline: { gt: now },
  };
  if (params.keyword) {
    where.OR = [
      { title: { contains: params.keyword } },
      { description: { contains: params.keyword } },
      { location: { contains: params.keyword } },
    ];
  }
  if (params.duration === "short") where.durationMin = { lte: 30 };
  if (params.duration === "medium") where.durationMin = { gt: 30, lte: 60 };
  if (params.duration === "long") where.durationMin = { gt: 60 };

  const experiments = await prisma.experiment.findMany({
    where,
    include: {
      researcher: true,
      slots: {
        where: { startAt: { gt: now } },
        orderBy: { startAt: "asc" },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const cards: CardView[] = [];
  for (const experiment of experiments) {
    const openSlots = experiment.slots.filter((s) => remainingOf(s) > 0);
    if (openSlots.length === 0) continue;

    if (params.date) {
      const target = params.date; // YYYY-MM-DD (Asia/Shanghai)
      const has = openSlots.some((s) => {
        const d = new Date(s.startAt.getTime() + 8 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10);
        return d === target;
      });
      if (!has) continue;
    }

    const eligibility = params.viewer
      ? checkEligibility(
          {
            bannedUntil: params.viewer.bannedUntil,
            creditScore: params.viewer.creditScore,
            studentVerified: params.viewer.studentVerified,
            minCreditScore: experiment.minCreditScore,
            needsVerification: experiment.needsVerification,
          },
          now,
        )
      : ({ ok: true } as const);

    cards.push({
      id: experiment.id,
      title: experiment.title,
      location: experiment.location,
      durationMin: experiment.durationMin,
      rewardText: experiment.rewardText,
      type: experiment.type as ExperimentType,
      groupSize: experiment.groupSize,
      minCreditScore: experiment.minCreditScore,
      needsVerification: experiment.needsVerification,
      signupDeadline: experiment.signupDeadline.toISOString(),
      researcher: {
        id: experiment.researcher.id,
        name: experiment.researcher.name,
        school: experiment.researcher.school,
        creditScore: experiment.researcher.creditScore,
        studentVerified: experiment.researcher.studentVerified,
      },
      remainingSeats: openSlots.reduce((sum, s) => sum + remainingOf(s), 0),
      nextSlotAt: openSlots[0]?.startAt.toISOString() ?? null,
      lowCreditResearcher: experiment.researcher.creditScore < CREDIT.LOW_CREDIT_THRESHOLD,
      eligibility: eligibility.ok
        ? { ok: true }
        : { ok: false, reason: eligibility.reason, message: eligibility.message },
    });
  }

  // 主试信誉分 < 60 的实验排到末尾；其余按"最近可约"升序
  cards.sort((a, b) => {
    if (a.lowCreditResearcher !== b.lowCreditResearcher) return a.lowCreditResearcher ? 1 : -1;
    return (a.nextSlotAt ?? "").localeCompare(b.nextSlotAt ?? "");
  });

  return params.onlyEligible ? cards.filter((c) => c.eligibility.ok) : cards;
}

export async function getExperimentDetail(id: string) {
  const experiment = await prisma.experiment.findUnique({
    where: { id },
    include: {
      researcher: true,
      slots: { orderBy: { startAt: "asc" } },
    },
  });
  if (!experiment) throw new ApiError(404, "实验不存在");
  return experiment;
}

export async function listResearcherExperiments(researcherId: string) {
  const experiments = await prisma.experiment.findMany({
    where: { researcherId },
    include: {
      slots: { orderBy: { startAt: "asc" } },
      appointments: true,
    },
    orderBy: { createdAt: "desc" },
  });
  return experiments.map((e) => ({
    id: e.id,
    title: e.title,
    status: e.status,
    type: e.type,
    rewardText: e.rewardText,
    durationMin: e.durationMin,
    location: e.location,
    signupDeadline: e.signupDeadline.toISOString(),
    slotCount: e.slots.length,
    bookedCount: e.appointments.filter((a) =>
      OCCUPYING_STATUSES.includes(a.status as Status),
    ).length,
    capacityTotal: e.slots.reduce((s, x) => s + x.capacity, 0),
    pendingCount: e.appointments.filter(
      (a) =>
        a.status === AppointmentStatus.AWAITING_RESEARCHER ||
        a.status === AppointmentStatus.PENDING_SUBJECT_CONFIRM ||
        a.appealStatus === "PENDING",
    ).length,
  }));
}

/** 被试"我的预约"分组 */
export function appointmentGroupOf(status: Status): "pending" | "confirmed" | "checkin" | "done" | "cancelled" {
  switch (status) {
    case AppointmentStatus.PENDING_SUBJECT_CONFIRM:
    case AppointmentStatus.AWAITING_RESEARCHER:
      return "pending";
    case AppointmentStatus.CONFIRMED:
      return "confirmed";
    case AppointmentStatus.CHECKED_IN:
      return "checkin";
    case AppointmentStatus.COMPLETED:
    case AppointmentStatus.NO_SHOW:
      return "done";
    default:
      return "cancelled";
  }
}

export const ACTIVE_STATUS_LIST = ACTIVE_APPOINTMENT_STATUSES;
export const OCCUPYING_STATUS_LIST = OCCUPYING_STATUSES;
export const ONE_DAY = DAY;
