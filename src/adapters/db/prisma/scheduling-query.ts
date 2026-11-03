/**
 * Prisma 实现：SchedulingQueryPort。
 *
 * 这里每个查询的 args 都是从 src/server/agent.ts 的 loadContext() **原样搬过来的**：
 * where / orderBy / take / include 一个字没改。搬家的目的是让 agent.ts 不再出现
 * `prisma.`，不是顺手"优化"查询 —— 改查询语义就不是重构，是改需求。
 */
import type {
  BusyAppointment,
  ExperimentDetail,
  SchedulingQueryPort,
  SlotSummary,
  SubjectProfile,
} from "@/domain/ports/queries";
import type { QueryClientLike } from "./types";

type RawExperiment = {
  id: string;
  title: string;
  researcherId: string;
  status: string;
  type: string;
  groupSize: number | null;
  location: string;
  durationMin: number;
  rewardText: string;
  minCreditScore: number;
  needsVerification: boolean;
  signupDeadline: Date;
  researcher: { name: string };
};

type RawUser = {
  id: string;
  creditScore: number;
  noShowCount: number;
  bannedUntil: Date | null;
  studentVerified: boolean;
};

type RawSlot = {
  id: string;
  startAt: Date;
  endAt: Date;
  capacity: number;
  bookedCount: number;
};

type RawAppointment = {
  id: string;
  status: string;
  slot: { startAt: Date; endAt: Date; experiment: { title: string } };
};

export function makeSchedulingQuery(db: QueryClientLike): SchedulingQueryPort {
  return {
    async findExperimentDetail(experimentId) {
      const raw = (await db.experiment.findUnique({
        where: { id: experimentId },
        include: { researcher: true },
      })) as RawExperiment | null;
      if (!raw) return null;

      const detail: ExperimentDetail = {
        id: raw.id,
        title: raw.title,
        researcherId: raw.researcherId,
        researcherName: raw.researcher.name,
        status: raw.status as ExperimentDetail["status"],
        type: raw.type as ExperimentDetail["type"],
        groupSize: raw.groupSize,
        location: raw.location,
        durationMin: raw.durationMin,
        rewardText: raw.rewardText,
        minCreditScore: raw.minCreditScore,
        needsVerification: raw.needsVerification,
        signupDeadline: raw.signupDeadline,
      };
      return detail;
    },

    async findSubjectProfile(userId) {
      const raw = (await db.user.findUnique({ where: { id: userId } })) as RawUser | null;
      if (!raw) return null;

      const profile: SubjectProfile = {
        id: raw.id,
        creditScore: raw.creditScore,
        noShowCount: raw.noShowCount,
        bannedUntil: raw.bannedUntil,
        studentVerified: raw.studentVerified,
      };
      return profile;
    },

    /**
     * 只按时间过滤，不在 SQL 里过滤「已满」。
     *
     * 原实现注释写着「SQLite 不支持字段间比较，这里先取全部再用内存过滤」。
     * 保留这个行为是有意的：换到支持字段比较的库（Postgres）再改，属于另一件事。
     */
    async findUpcomingSlots(experimentId, from, take) {
      const raw = (await db.slot.findMany({
        where: { experimentId, startAt: { gt: from } },
        orderBy: { startAt: "asc" },
        take,
      })) as RawSlot[];

      return raw.map(
        (s): SlotSummary => ({
          id: s.id,
          startAt: s.startAt,
          endAt: s.endAt,
          capacity: s.capacity,
          bookedCount: s.bookedCount,
        }),
      );
    },

    async findActiveAppointments(subjectId, statuses) {
      const raw = (await db.appointment.findMany({
        where: { subjectId, status: { in: statuses } },
        include: { slot: { include: { experiment: true } } },
        orderBy: { createdAt: "desc" },
      })) as RawAppointment[];

      return raw.map(
        (a): BusyAppointment => ({
          id: a.id,
          status: a.status as BusyAppointment["status"],
          slot: {
            startAt: a.slot.startAt,
            endAt: a.slot.endAt,
            experiment: { title: a.slot.experiment.title },
          },
        }),
      );
    },
  };
}
