/**
 * Prisma 实现：AssistantQuery。
 *
 * 只有一句查询。`status: { in: statuses }` 与 `slot.startAt: { gte: from }` 都进 where，
 * 不在内存里筛 —— 助手要看的可能是一个学期的预约，全取回来再过滤等于把数据库当磁盘用。
 *
 * 与 schedule-query 的差别：
 *   schedule 是「主试看被试」，以 Slot 为基表（0 人报名也要成行）；
 *   assistant 是「被试看自己」，以 Appointment 为基表（没预约就是没事）。
 * 方向相反，所以必须是两个查询，不能硬套一个。
 */
import { prisma } from "@/lib/prisma";
import type {
  AssistantAppointment,
  AssistantQuery,
  PastExperiment,
} from "@/domain/ports/assistant-query";

type RawAppointment = {
  id: string;
  status: string;
  experimentId: string;
  slot: { startAt: Date; endAt: Date };
  experiment: {
    title: string;
    location: string;
    researcher: { name: string } | null;
  };
};

type RawPast = {
  id: string;
  status: string;
  experimentId: string;
  slot: { endAt: Date };
  experiment: { title: string };
};

type AppointmentFindMany = (args: unknown) => Promise<unknown[]>;

export type AssistantClientLike = {
  appointment: { findMany: AppointmentFindMany };
};

export function makeAssistantQuery(db: AssistantClientLike): AssistantQuery {
  return {
    async listMyPastExperiments(
      subjectId: string,
      before: Date,
      statuses: string[],
    ): Promise<PastExperiment[]> {
      if (statuses.length === 0) return [];

      const rows = (await db.appointment.findMany({
        where: {
          subjectId,
          status: { in: statuses },
          slot: { endAt: { lt: before } },
        },
        orderBy: [{ slot: { endAt: "desc" } }, { id: "desc" }],
        select: {
          id: true,
          status: true,
          experimentId: true,
          slot: { select: { endAt: true } },
          experiment: { select: { title: true } },
        },
      })) as RawPast[];

      return rows.map((row) => ({
        appointmentId: row.id,
        experimentId: row.experimentId,
        experimentTitle: row.experiment.title,
        finishedAt: row.slot.endAt,
        status: row.status,
      }));
    },
    async listMyUpcomingAppointments(
      subjectId: string,
      from: Date,
      statuses: string[],
    ): Promise<AssistantAppointment[]> {
      // 空状态列表 = 「什么都不算占用」，直接返回空，不必打一次库
      if (statuses.length === 0) return [];

      const rows = (await db.appointment.findMany({
        where: {
          subjectId,
          status: { in: statuses },
          slot: { startAt: { gte: from } },
        },
        orderBy: [{ slot: { startAt: "asc" } }, { id: "asc" }],
        select: {
          id: true,
          status: true,
          experimentId: true,
          slot: { select: { startAt: true, endAt: true } },
          experiment: {
            select: {
              title: true,
              location: true,
              researcher: { select: { name: true } },
            },
          },
        },
      })) as RawAppointment[];

      return rows.map((row) => ({
        id: row.id,
        status: row.status,
        experimentId: row.experimentId,
        experimentTitle: row.experiment.title,
        location: row.experiment.location,
        researcherName: row.experiment.researcher?.name ?? "",
        startAt: row.slot.startAt,
        endAt: row.slot.endAt,
      }));
    },
  };
}

/** 生产装配入口 */
export function makeDefaultAssistantQuery(): AssistantQuery {
  return makeAssistantQuery(prisma as unknown as AssistantClientLike);
}
