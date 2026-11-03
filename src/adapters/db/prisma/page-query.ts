/**
 * Prisma 实现：PageQueryPort。
 *
 * 每个方法的 where / include / orderBy / take 都是从页面里**原样搬过来的**。
 * 页面能拿到什么数据、拿到多少条，重构前后必须一致 —— 否则就是改了产品行为，
 * 而那不是这次要做的事。
 *
 * 唯一有"聪明"的地方是 countAppointmentsByStatus：原来页面用 groupBy 一次拿到
 * 所有状态计数，再在页面里 reduce。这里保留 groupBy（一次查询），
 * 但把 reduce 也收进来，页面只拿两个数字。
 */

import type {
  AppointmentCounts,
  ChatHeaderExperiment,
  ChatSessionSummary,
  CreditEventSummary,
  MeProfile,
  PageQueryPort,
} from "@/domain/ports/page-queries";
import type { PageQueryClientLike } from "./types";

type RawUser = {
  id: string;
  name: string;
  school: string | null;
  department: string | null;
  phone: string;
  studentVerified: boolean;
  creditScore: number;
  noShowCount: number;
  bannedUntil: Date | null;
};

type RawCreditEvent = {
  id: string;
  delta: number;
  reason: string;
  note: string | null;
  createdAt: Date;
};

type RawGroupedCount = { status: string; _count: { _all: number } };

type RawChatSession = {
  id: string;
  experimentId: string;
  state: string;
  messages: string;
  updatedAt: Date;
  experiment: {
    title: string;
    durationMin: number;
    rewardText: string;
    researcher: { name: string };
  };
};

type RawExperimentWithResearcher = {
  id: string;
  title: string;
  durationMin: number;
  location: string;
  rewardText: string;
  researcher: { name: string };
};

export function makePageQuery(db: PageQueryClientLike): PageQueryPort {
  return {
    async findMeProfile(userId) {
      // 只 select 卡片用得到的字段 —— 原来 prisma.user.findUnique 拿的是整行，
      // 包含 studentId / eduEmail / passwordHash。这里收窄是有意的：
      // 页面组件不需要的东西就不该被送到渲染层。
      const raw = (await db.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          name: true,
          school: true,
          department: true,
          phone: true,
          studentVerified: true,
          creditScore: true,
          noShowCount: true,
          bannedUntil: true,
        },
      })) as RawUser | null;
      if (!raw) return null;

      const profile: MeProfile = {
        id: raw.id,
        name: raw.name,
        school: raw.school,
        department: raw.department,
        phone: raw.phone,
        studentVerified: raw.studentVerified,
        creditScore: raw.creditScore,
        noShowCount: raw.noShowCount,
        bannedUntil: raw.bannedUntil,
      };
      return profile;
    },

    async findRecentCreditEvents(userId, take) {
      const raw = (await db.creditEvent.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take,
      })) as RawCreditEvent[];

      return raw.map(
        (e): CreditEventSummary => ({
          id: e.id,
          delta: e.delta,
          reason: e.reason,
          note: e.note,
          createdAt: e.createdAt,
        }),
      );
    },

    async countAppointmentsByStatus(userId, completedStatuses, ongoingStatuses) {
      const grouped = (await db.appointment.groupBy({
        by: ["status"],
        where: { subjectId: userId },
        _count: { _all: true },
      })) as RawGroupedCount[];

      const sum = (statuses: string[]) =>
        statuses.reduce(
          (total, status) => total + (grouped.find((g) => g.status === status)?._count._all ?? 0),
          0,
        );

      const counts: AppointmentCounts = {
        completed: sum(completedStatuses),
        ongoing: sum(ongoingStatuses),
      };
      return counts;
    },

    async findChatSessionsForSubject(subjectId) {
      const raw = (await db.chatSession.findMany({
        where: { subjectId },
        include: { experiment: { include: { researcher: true } } },
        orderBy: { updatedAt: "desc" },
      })) as RawChatSession[];

      return raw.map(
        (s): ChatSessionSummary => ({
          id: s.id,
          experimentId: s.experimentId,
          state: s.state,
          messages: s.messages,
          updatedAt: s.updatedAt,
          experiment: {
            title: s.experiment.title,
            durationMin: s.experiment.durationMin,
            rewardText: s.experiment.rewardText,
            researcherName: s.experiment.researcher.name,
          },
        }),
      );
    },

    async findChatHeaderExperiment(experimentId) {
      const raw = (await db.experiment.findUnique({
        where: { id: experimentId },
        include: { researcher: true },
      })) as RawExperimentWithResearcher | null;
      if (!raw) return null;

      const header: ChatHeaderExperiment = {
        id: raw.id,
        title: raw.title,
        durationMin: raw.durationMin,
        location: raw.location,
        rewardText: raw.rewardText,
        researcherName: raw.researcher.name,
      };
      return header;
    },
  };
}
