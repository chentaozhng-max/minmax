/**
 * Prisma 实现：ScheduleQuery。
 *
 * 用 `slot.findMany({ include: { appointments } })` 取，而不是从 Appointment 起。
 * 这是「行骨架」的落点：Slot 一定返回，appointments 可能是空数组。
 * 再从内存里把每格展开成「一行一个被试」，空位补一行 subject=null。
 *
 * 为什么不用 $queryRaw 写 LEFT JOIN：
 *   · Prisma 的 include 语义天然就是 LEFT JOIN（一对多带空数组），没必要自己写 SQL；
 *   · SQL 一旦写进 adapter，字段改名时编译器不会提醒你 —— Prisma 的 include 会。
 *
 * 为什么不用数据库 VIEW：Prisma 不认识 VIEW，`prisma migrate` 会把它当 schema drift，
 * 而这里只有一个消费者（本文件），VIEW 的「多处复用」收益接近于零、migrate 负债是永久的。
 */
import { prisma } from "@/lib/prisma";
import type { ScheduleFilter, ScheduleQuery, ScheduleRow } from "@/domain/ports/schedule";

type SlotWithAppointments = {
  id: string;
  experimentId: string;
  startAt: Date;
  endAt: Date;
  capacity: number;
  bookedCount: number;
  experiment: {
    title: string;
    groupSize: number | null;
    researcherId: string;
  };
  appointments: {
    id: string;
    status: string;
    checkedInAt: Date | null;
    appealStatus: string | null;
    subject: {
      id: string;
      name: string;
      phone: string;
      school: string | null;
      studentId: string | null;
      creditScore: number;
      studentVerified: boolean;
    };
  }[];
};

type SlotFindMany = (args: unknown) => Promise<unknown[]>;

export type ScheduleClientLike = {
  slot: { findMany: SlotFindMany };
};

const SLOT_SELECT = {
  select: {
    id: true,
    experimentId: true,
    startAt: true,
    endAt: true,
    capacity: true,
    bookedCount: true,
    experiment: { select: { title: true, groupSize: true, researcherId: true } },
    appointments: {
      select: {
        id: true,
        status: true,
        checkedInAt: true,
        appealStatus: true,
        subject: {
          select: {
            id: true,
            name: true,
            phone: true,
            school: true,
            studentId: true,
            creditScore: true,
            studentVerified: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    },
  },
} as const;

export function makeScheduleQuery(db: ScheduleClientLike): ScheduleQuery {
  return {
    async listSchedule(filter?: ScheduleFilter): Promise<ScheduleRow[]> {
      // where 只在真的有限制条件时才拼，避免给 Prisma 传 `{ }` 空对象
      const where: { experimentId?: string; experiment?: { researcherId: string } } = {};
      if (filter?.experimentId) where.experimentId = filter.experimentId;
      if (filter?.researcherId) where.experiment = { researcherId: filter.researcherId };

      const slots = (await db.slot.findMany({
        where: Object.keys(where).length > 0 ? where : undefined,
        orderBy: [{ startAt: "asc" }, { id: "asc" }],
        ...SLOT_SELECT,
      })) as SlotWithAppointments[];

      return slots.flatMap((slot): ScheduleRow[] => {
        const base = {
          experimentId: slot.experimentId,
          experimentTitle: slot.experiment.title,
          slotId: slot.id,
          startAt: slot.startAt,
          endAt: slot.endAt,
          capacity: slot.capacity,
          bookedCount: slot.bookedCount,
          groupSize: slot.experiment.groupSize,
        };

        // 没人报名 → 照样出一行，subject 为 null（前端/CSV 据此表示空位）
        if (slot.appointments.length === 0) {
          return [
            {
              ...base,
              appointmentId: null,
              appointmentStatus: null,
              checkedInAt: null,
              appealStatus: null,
              subject: null,
            },
          ];
        }

        return slot.appointments.map((a) => ({
          ...base,
          appointmentId: a.id,
          appointmentStatus: a.status,
          checkedInAt: a.checkedInAt,
          appealStatus: a.appealStatus,
          subject: a.subject,
        }));
      });
    },
  };
}

/** 生产装配入口 */
export function makeDefaultScheduleQuery(): ScheduleQuery {
  return makeScheduleQuery(prisma as unknown as ScheduleClientLike);
}
