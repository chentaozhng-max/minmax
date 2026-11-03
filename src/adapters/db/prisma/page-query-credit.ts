/**
 * Prisma 实现：信誉分列表页 + 详情页。
 *
 * 来源：app/me/credit/page.tsx、app/me/credit/[id]/page.tsx
 *
 * 这两页原来是「查用户 → 查流水 → 再从流水里捞出 appointmentId 批量查预约」，
 * 一条链上 3-4 次查询散在页面里。现在每一步都有名字，页面只负责拿来渲染。
 */

import type {
  CreditAppointmentBrief,
  CreditAppointmentFull,
  CreditEventFull,
  CreditPageQuery,
  CreditPageUser,
} from "@/domain/ports/page-queries";
import type { PageQueryClientLike } from "./types";

export function makeCreditPageQuery(db: PageQueryClientLike): CreditPageQuery {
  return {
    async findCreditPageUser(userId) {
      // select 收窄：信誉分页只需要 role / 分数 / 未到场 / 限制期
      const raw = (await db.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          role: true,
          creditScore: true,
          noShowCount: true,
          bannedUntil: true,
        },
      })) as CreditPageUser | null;
      if (!raw) return null;

      const user: CreditPageUser = {
        id: raw.id,
        role: raw.role,
        creditScore: raw.creditScore,
        noShowCount: raw.noShowCount,
        bannedUntil: raw.bannedUntil,
      };
      return user;
    },

    async findCreditEvents(userId, take) {
      const raw = (await db.creditEvent.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take,
      })) as CreditEventFull[];

      return raw.map((e) => ({
        id: e.id,
        delta: e.delta,
        reason: e.reason,
        note: e.note,
        appointmentId: e.appointmentId,
        createdAt: e.createdAt,
      }));
    },

    async findAppointmentsByIds(ids) {
      // 调用方已经保证 ids 非空才调（空数组会让 in: [] 变全表）
      if (ids.length === 0) return [];

      const raw = (await db.appointment.findMany({
        where: { id: { in: ids } },
        include: { experiment: true, slot: true },
      })) as Array<{
        id: string;
        status: string;
        experiment: { title: string };
        slot: { startAt: Date; endAt: Date };
      }>;

      return raw.map(
        (a): CreditAppointmentBrief => ({
          id: a.id,
          status: a.status,
          experiment: { title: a.experiment.title },
          slot: { startAt: a.slot.startAt, endAt: a.slot.endAt },
        }),
      );
    },

    async findOwnedCreditEvent(eventId, userId) {
      const raw = (await db.creditEvent.findUnique({ where: { id: eventId } })) as
        | (CreditEventFull & { userId: string })
        | null;
      // 归属校验放在适配器里：调用方拿不到「别人的流水」，
      // 也就不存在「忘记校验」这种漏洞
      if (!raw || raw.userId !== userId) return null;

      const event: CreditEventFull = {
        id: raw.id,
        delta: raw.delta,
        reason: raw.reason,
        note: raw.note,
        appointmentId: raw.appointmentId,
        createdAt: raw.createdAt,
      };
      return event;
    },

    async findAppointmentFull(appointmentId) {
      const raw = (await db.appointment.findUnique({
        where: { id: appointmentId },
        include: {
          experiment: { include: { researcher: true } },
          slot: true,
          subject: true,
        },
      })) as {
        id: string;
        status: string;
        appealStatus: string | null;
        experimentId: string;
        experiment: { title: string; location: string; researcher: { name: string } };
        slot: { startAt: Date; endAt: Date };
        subject: { name: string };
      } | null;
      if (!raw) return null;

      const full: CreditAppointmentFull = {
        id: raw.id,
        status: raw.status,
        appealStatus: raw.appealStatus,
        experimentId: raw.experimentId,
        experiment: {
          title: raw.experiment.title,
          location: raw.experiment.location,
          researcher: { name: raw.experiment.researcher.name },
        },
        slot: { startAt: raw.slot.startAt, endAt: raw.slot.endAt },
        subject: { name: raw.subject.name },
      };
      return full;
    },

    async findCreditDeltasAsc(userId) {
      // 只取 id + delta：详情页要按时间顺序重放算「这条生效时的分数」
      const raw = (await db.creditEvent.findMany({
        where: { userId },
        orderBy: { createdAt: "asc" },
        select: { id: true, delta: true },
      })) as Array<{ id: string; delta: number }>;

      return raw.map((e) => ({ id: e.id, delta: e.delta }));
    },
  };
}
