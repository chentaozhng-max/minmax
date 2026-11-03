/**
 * 报名用例 —— 应用层。
 *
 * 这个文件只做三件事：取数据 → 让领域规则判定 → 在一个事务里落库。
 * 没有一句 SQL，没有一个 Prisma 类型，没有 HTTP 概念。
 *
 * 防超卖的位置没变，但现在是「命名清晰的一步」：
 *   tx.slots.tryOccupy(slot.id) —— 失败即抛，与建单在同一个事务里。
 */

import { ApiError } from "@/lib/http";
import { assertBookable, SLOT_FULL_MESSAGE } from "@/domain/booking-rules";
import { AppointmentStatus } from "@/domain/constants";
import type {
  AppointmentRepository,
  RepositoryBundle,
  SlotRepository,
  TransactionPort,
} from "@/domain/ports/repositories";

export type BookInput = {
  userId: string;
  slotId: string;
  now?: Date;
  /** AGENT | FORM | DIRECT，仅用于记录来源 */
  source?: string;
};

export type BookDeps = {
  /** 事务外读数据用的仓储（读不需要事务） */
  readers: Pick<RepositoryBundle, "slots" | "appointments">;
  uow: TransactionPort;
  /** 取被试的资格字段（封禁 / 信誉分 / 认证）—— 独立端口，见 ports/users */
  loadSubject(id: string): Promise<{
    id: string;
    bannedUntil: Date | null;
    creditScore: number;
    studentVerified: boolean;
  }>;
};

/**
 * 报名 / 锁定时段。
 *
 * 防超卖核心：在同一个事务里用条件 UPDATE 抢占名额，影响行数为 0 直接失败。
 */
export async function bookSlot(input: BookInput, deps: BookDeps) {
  const now = input.now ?? new Date();

  const slot = await deps.readers.slots.findById(input.slotId);
  if (!slot) throw new ApiError(404, "时段不存在");

  const subject = await deps.loadSubject(input.userId);
  const conflicts = await deps.readers.appointments.findConflicts(input.userId, slot);
  const existing = await deps.readers.appointments.findBySlotAndSubject(slot.id, input.userId);

  const rejection = assertBookable({ experiment: slot.experiment, slot, subject, conflicts, existing, now });
  if (rejection) throw new ApiError(rejection.status, rejection.message);

  return deps.uow.runInTransaction(async (tx: RepositoryBundle) => {
    const ok = await tx.slots.tryOccupy(slot.id);
    if (!ok) throw new ApiError(409, SLOT_FULL_MESSAGE);

    if (existing) {
      return tx.appointments.reactivate(existing.id, AppointmentStatus.PENDING_SUBJECT_CONFIRM, now);
    }

    return tx.appointments.create({
      experimentId: slot.experiment.id,
      slotId: slot.id,
      subjectId: input.userId,
      status: AppointmentStatus.PENDING_SUBJECT_CONFIRM,
      createdAt: now,
    });
  });
}

/** 只是为了让 SlotRepository / AppointmentRepository 的类型被本文件引用到（避免未使用告警） */
export type _RepoTypes = [SlotRepository, AppointmentRepository];
