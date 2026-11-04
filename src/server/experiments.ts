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
  /** ONLINE = 线上实验：没有时段，卡片改成「随时可填」而不是「已约满」 */
  mode: string;
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
    const online = experiment.mode === "ONLINE";
    const openSlots = experiment.slots.filter((s) => remainingOf(s) > 0);
    // 线上实验没有时段，不能拿「有空位」当门槛 —— 否则发布后首页永远看不到它
    if (!online && openSlots.length === 0) continue;

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
      mode: experiment.mode,
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

/**
 * 主试详情接口的入参形状。
 *
 * 只声明用得到的字段：这样 route 里的 prisma 查询结果可以结构上直接传进来，
 * 而 server 层不必 import Prisma 的类型。
 */
export type ResearcherDetailRow = {
  id: string;
  title: string;
  description: string;
  location: string;
  durationMin: number;
  rewardText: string;
  type: string;
  mode: string;
  needsQuestionnaire: boolean;
  openAnytime: boolean;
  groupSize: number | null;
  requirements: string | null;
  minCreditScore: number;
  needsVerification: boolean;
  signupDeadline: Date;
  status: string;
  slots: { id: string; startAt: Date; endAt: Date; capacity: number; bookedCount: number }[];
  appointments: {
    id: string;
    status: string;
    appealStatus: string | null;
    createdAt: Date;
    subject: {
      id: string;
      name: string;
      school: string | null;
      studentId: string | null;
      creditScore: number;
      studentVerified: boolean;
      noShowCount: number;
    };
    slot: { startAt: Date; endAt: Date };
  }[];
};

/** 主试详情：把时间转成 ISO、把「这个状态能做什么」算成布尔位，页面直接用 */
export function formatResearcherDetail(experiment: ResearcherDetailRow, now: Date = new Date()) {
  return {
    id: experiment.id,
    title: experiment.title,
    description: experiment.description,
    location: experiment.location,
    durationMin: experiment.durationMin,
    rewardText: experiment.rewardText,
    type: experiment.type,
    mode: experiment.mode,
    needsQuestionnaire: experiment.needsQuestionnaire,
    openAnytime: experiment.openAnytime,
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
      canRelease: a.status === "PENDING_SUBJECT_CONFIRM" || a.status === "AWAITING_RESEARCHER",
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
  };
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
    mode: e.mode,
    rewardText: e.rewardText,
    durationMin: e.durationMin,
    location: e.location,
    signupDeadline: e.signupDeadline.toISOString(),
    openAnytime: e.openAnytime,
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
