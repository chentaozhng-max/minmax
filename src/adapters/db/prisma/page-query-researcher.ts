/**
 * Prisma 实现：主试公开主页 + 主试个人中心。
 *
 * 来源：app/researchers/[id]/page.tsx、app/r/profile/page.tsx
 *
 * 主试个人中心那 5 个查询原来散在页面的 Promise.all 里，
 * 页面同时管「并发」和「怎么拼」两件事。现在并发留在适配器，页面只拿结果对象。
 */

import type {
  ResearcherDashboard,
  ResearcherPageQuery,
  ResearcherPublicPage,
} from "@/domain/ports/page-queries";
import type { PageQueryClientLike } from "./types";

type RawResearcher = {
  id: string;
  name: string;
  school: string | null;
  department: string | null;
  studentVerified: boolean;
  creditScore: number;
  noShowCount: number;
  role: string;
};

type RawPublicExperiment = {
  id: string;
  title: string;
  rewardText: string;
  durationMin: number;
  location: string;
  slots: Array<{ startAt: Date; capacity: number; bookedCount: number }>;
};

export function makeResearcherPageQuery(db: PageQueryClientLike): ResearcherPageQuery {
  return {
    async findResearcherPublicPage(researcherId) {
      const raw = (await db.user.findUnique({
        where: { id: researcherId },
        include: {
          experiments: {
            where: { status: "PUBLISHED" },
            include: { slots: true },
            orderBy: { createdAt: "desc" },
          },
        },
      })) as (RawResearcher & { experiments: RawPublicExperiment[] }) | null;
      if (!raw || raw.role !== "RESEARCHER") return null;

      // 「按时主持」= 该主试因 ATTENDED 得到的信誉流水条数，与重构前同一口径
      const hostedCount = (await db.creditEvent.count({
        where: { userId: raw.id, reason: "ATTENDED" },
      })) as number;

      const page: ResearcherPublicPage = {
        id: raw.id,
        name: raw.name,
        school: raw.school,
        department: raw.department,
        studentVerified: raw.studentVerified,
        creditScore: raw.creditScore,
        noShowCount: raw.noShowCount,
        hostedCount,
        experiments: raw.experiments.map((e) => ({
          id: e.id,
          title: e.title,
          rewardText: e.rewardText,
          durationMin: e.durationMin,
          location: e.location,
          // 页面只用 startAt / capacity / bookedCount 算余位与最近场次
          slots: e.slots.map((s) => ({
            startAt: s.startAt,
            capacity: s.capacity,
            bookedCount: s.bookedCount,
          })),
        })),
      };
      return page;
    },

    async findResearcherDashboard(userId, eventTake) {
      // 原来是页面里 Promise.all([5 个查询])。并发结构原样保留，
      // 只是把「怎么拼」搬到适配器，页面拿一个对象
      const [events, experimentCount, publishedCount, awaitingCount, appealCount] =
        await Promise.all([
          db.creditEvent.findMany({
            where: { userId },
            orderBy: { createdAt: "desc" },
            take: eventTake,
          }) as Promise<
            Array<{ id: string; delta: number; reason: string; note: string | null; createdAt: Date }>
          >,
          db.experiment.count({ where: { researcherId: userId } }) as Promise<number>,
          db.experiment.count({
            where: { researcherId: userId, status: "PUBLISHED" },
          }) as Promise<number>,
          db.appointment.count({
            where: {
              experiment: { researcherId: userId },
              status: { in: ["AWAITING_RESEARCHER", "CHECKED_IN"] },
            },
          }) as Promise<number>,
          db.appointment.count({
            where: { experiment: { researcherId: userId }, appealStatus: "PENDING" },
          }) as Promise<number>,
        ]);

      const dashboard: ResearcherDashboard = {
        events: events.map((e) => ({
          id: e.id,
          delta: e.delta,
          reason: e.reason,
          note: e.note,
          createdAt: e.createdAt,
        })),
        experimentCount,
        publishedCount,
        awaitingCount,
        appealCount,
      };
      return dashboard;
    },
  };
}
