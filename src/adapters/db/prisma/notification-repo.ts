/**
 * Prisma 实现：NotificationRepository。
 *
 * 三个要点：
 *   1. 候选查询用 `status: CONFIRMED` —— 只有确认过的预约才值得提醒。
 *      待确认的预约还没定下来，提醒了反而添乱。
 *   2. 幂等靠 `@@unique([appointmentId, level])`，捕获 P2002 转成 created:false。
 *      「重复」是正常返回，不是异常 —— 上层据此计入 skipped。
 *   3. 所有方法都是单句查询，没有事务：一条通知的写入不需要原子性。
 */
import { prisma } from "@/lib/prisma";
import type { ReminderLevel } from "@/domain/reminder-levels";
import type {
  CreateBookingNoticeInput,
  CreateReminderInput,
  NotificationRecord,
  NotificationRepository,
  ReminderCandidate,
} from "@/domain/ports/notification-repo";

type FindMany = (args: unknown) => Promise<unknown[]>;
type Create = (args: unknown) => Promise<unknown>;
type UpdateMany = (args: unknown) => Promise<{ count: number }>;
type Count = (args: unknown) => Promise<number>;

export type NotificationClientLike = {
  appointment: { findMany: FindMany };
  notification: {
    create: Create;
    findMany: FindMany;
    count: Count;
    updateMany: UpdateMany;
  };
};

type RawCandidate = {
  id: string;
  experimentId: string;
  subjectId: string;
  slot: { startAt: Date; endAt: Date };
  experiment: { title: string; location: string; researcher: { name: string } | null };
};

/** Prisma 唯一约束冲突 */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
}

export function makeNotificationRepository(db: NotificationClientLike): NotificationRepository {
  return {
    async findReminderCandidates(now: Date, withinMs: number): Promise<ReminderCandidate[]> {
      const until = new Date(now.getTime() + withinMs);
      const rows = (await db.appointment.findMany({
        where: {
          status: "CONFIRMED",
          slot: { startAt: { gt: now, lte: until } },
        },
        select: {
          id: true,
          experimentId: true,
          subjectId: true,
          slot: { select: { startAt: true, endAt: true } },
          experiment: {
            select: {
              title: true,
              location: true,
              researcher: { select: { name: true } },
            },
          },
        },
      })) as RawCandidate[];

      return rows.map((row) => ({
        appointmentId: row.id,
        experimentId: row.experimentId,
        subjectId: row.subjectId,
        startAt: row.slot.startAt,
        endAt: row.slot.endAt,
        experimentTitle: row.experiment.title,
        location: row.experiment.location,
        researcherName: row.experiment.researcher?.name ?? "",
      }));
    },

    async createReminder(input: CreateReminderInput) {
      try {
        const created = (await db.notification.create({
          data: {
            userId: input.userId,
            kind: "REMINDER",
            level: input.level,
            appointmentId: input.appointmentId,
            experimentId: input.experimentId,
            content: input.content,
            channel: "IN_APP",
            createdAt: input.createdAt,
          },
          select: { id: true },
        })) as { id: string };
        return { id: created.id, created: true };
      } catch (error) {
        // 这一档已经发过 —— 正常的重复，不是错误
        if (isUniqueViolation(error)) return { id: "", created: false };
        throw error;
      }
    },

    async hasReminder(appointmentId: string, level: ReminderLevel): Promise<boolean> {
      const count = await db.notification.count({
        where: { appointmentId, level },
      });
      return count > 0;
    },

    async createBookingNotice(input: CreateBookingNoticeInput) {
      // level 留 null：唯一约束是 `(appointmentId, level)`，而 NULL 在唯一索引里
      // 互不相等，所以同一场实验反复约也不会互相顶掉（SQLite/Postgres 都是这语义）。
      const created = (await db.notification.create({
        data: {
          userId: input.userId,
          kind: "BOOKING_CONFIRMED",
          level: null,
          appointmentId: input.appointmentId,
          experimentId: input.experimentId,
          content: input.content,
          channel: "IN_APP",
          createdAt: input.createdAt,
        },
        select: { id: true },
      })) as { id: string };
      return { id: created.id };
    },

    async listForUser(userId: string, limit: number): Promise<NotificationRecord[]> {
      return (await db.notification.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: limit,
        select: {
          id: true,
          kind: true,
          level: true,
          appointmentId: true,
          experimentId: true,
          content: true,
          readAt: true,
          createdAt: true,
        },
      })) as NotificationRecord[];
    },

    async countUnread(userId: string): Promise<number> {
      return db.notification.count({ where: { userId, readAt: null } });
    },

    async markAllRead(userId: string, now: Date): Promise<number> {
      const result = await db.notification.updateMany({
        where: { userId, readAt: null },
        data: { readAt: now },
      });
      return result.count;
    },
  };
}

/** 生产装配入口 */
export function makeDefaultNotificationRepository(): NotificationRepository {
  return makeNotificationRepository(prisma as unknown as NotificationClientLike);
}
