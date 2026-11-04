/**
 * Prisma 实现：实验详情页 + 账号表单页的只读查询。
 *
 * 来源：app/experiments/[id]/page.tsx、app/me/verify/page.tsx、
 *       app/onboarding/page.tsx、app/r/profile/verify/page.tsx
 *
 * 原则同前：where / include / orderBy 一律不改（改了就是改产品行为），
 * 但返回类型收窄成端口定义的形状 —— 页面用不到的字段不往下传。
 */

import type {
  AccountPageQuery,
  ExperimentPageDetail,
  ExperimentPageQuery,
  MyAppointmentBrief,
  OnboardingUser,
  ResearcherCard,
  VerifyFormUser,
} from "@/domain/ports/page-queries";
import type { ExperimentType } from "@/domain/constants";
import type { PageQueryClientLike } from "./types";

type RawResearcher = {
  id: string;
  name: string;
  school: string | null;
  department: string | null;
  studentVerified: boolean;
  creditScore: number;
};

type RawSlot = { id: string; startAt: Date; endAt: Date; capacity: number; bookedCount: number };

type RawExperimentDetail = {
  id: string;
  title: string;
  researcherId: string;
  status: string;
  type: string;
  mode: string;
  needsQuestionnaire: boolean;
  groupSize: number | null;
  location: string;
  durationMin: number;
  rewardText: string;
  description: string;
  requirements: string | null;
  minCreditScore: number;
  needsVerification: boolean;
  signupDeadline: Date;
  researcher: RawResearcher;
  slots: RawSlot[];
};

function toResearcherCard(r: RawResearcher): ResearcherCard {
  return {
    id: r.id,
    name: r.name,
    school: r.school,
    department: r.department,
    studentVerified: r.studentVerified,
    creditScore: r.creditScore,
  };
}

export function makeExperimentPageQuery(db: PageQueryClientLike): ExperimentPageQuery {
  return {
    async findExperimentPageDetail(experimentId) {
      // include 与重构前一致：主试全字段 + 时段升序
      const raw = (await db.experiment.findUnique({
        where: { id: experimentId },
        include: { researcher: true, slots: { orderBy: { startAt: "asc" } } },
      })) as RawExperimentDetail | null;
      if (!raw) return null;

      const detail: ExperimentPageDetail = {
        id: raw.id,
        title: raw.title,
        researcherId: raw.researcherId,
        status: raw.status,
        type: raw.type as ExperimentType,
        mode: raw.mode === "ONLINE" ? "ONLINE" : "OFFLINE",
        needsQuestionnaire: raw.needsQuestionnaire,
        groupSize: raw.groupSize,
        location: raw.location,
        durationMin: raw.durationMin,
        rewardText: raw.rewardText,
        description: raw.description,
        requirements: raw.requirements,
        minCreditScore: raw.minCreditScore,
        needsVerification: raw.needsVerification,
        signupDeadline: raw.signupDeadline,
        // researcher 只留卡片要用的字段。原来页面能摸到 passwordHash / eduEmail / studentId
        researcher: toResearcherCard(raw.researcher),
        slots: raw.slots.map((s) => ({
          id: s.id,
          startAt: s.startAt,
          endAt: s.endAt,
          capacity: s.capacity,
          bookedCount: s.bookedCount,
        })),
      };
      return detail;
    },

    async findMyAppointment(experimentId, subjectId, statuses) {
      const raw = (await db.appointment.findFirst({
        where: { experimentId, subjectId, status: { in: statuses } },
        include: { slot: true },
      })) as { id: string; status: string; slot: { startAt: Date; endAt: Date } } | null;
      if (!raw) return null;

      const brief: MyAppointmentBrief = {
        id: raw.id,
        status: raw.status,
        slot: { startAt: raw.slot.startAt, endAt: raw.slot.endAt },
      };
      return brief;
    },

    async countPublishedExperiments(researcherId) {
      return (await db.experiment.count({
        where: { researcherId, status: "PUBLISHED" },
      })) as number;
    },
  };
}

export function makeAccountPageQuery(db: PageQueryClientLike): AccountPageQuery {
  return {
    async findVerifyFormUser(userId) {
      // 认证表单只回填 3 个值 + 是否已完成。用 select 收窄，
      // 别把 passwordHash / refreshToken 送进客户端组件的 props
      const raw = (await db.user.findUnique({
        where: { id: userId },
        select: { studentVerified: true, school: true, studentId: true, eduEmail: true },
      })) as VerifyFormUser | null;
      if (!raw) return null;

      const form: VerifyFormUser = {
        studentVerified: raw.studentVerified,
        school: raw.school,
        studentId: raw.studentId,
        eduEmail: raw.eduEmail,
      };
      return form;
    },

    async findOnboardingUser(userId) {
      const raw = (await db.user.findUnique({
        where: { id: userId },
        select: {
          role: true,
          school: true,
          department: true,
          grade: true,
          interests: true,
          timePreference: true,
        },
      })) as OnboardingUser | null;
      if (!raw) return null;

      const user: OnboardingUser = {
        role: raw.role,
        school: raw.school,
        department: raw.department,
        grade: raw.grade,
        interests: raw.interests,
        timePreference: raw.timePreference,
      };
      return user;
    },
  };
}
