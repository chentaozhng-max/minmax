import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { applyAttendance, applyPenalty } from "@/lib/credit";
import type { CreditReason } from "@/lib/domain";

type Tx = Prisma.TransactionClient;

export async function penalizeTx(
  tx: Tx,
  params: {
    userId: string;
    reason: CreditReason;
    appointmentId?: string | null;
    note?: string;
    now?: Date;
  },
) {
  const now = params.now ?? new Date();
  const user = await tx.user.findUniqueOrThrow({ where: { id: params.userId } });
  const next = applyPenalty(
    {
      creditScore: user.creditScore,
      noShowCount: user.noShowCount,
      bannedUntil: user.bannedUntil,
    },
    now,
  );
  await tx.user.update({
    where: { id: user.id },
    data: {
      creditScore: next.creditScore,
      noShowCount: next.noShowCount,
      bannedUntil: next.bannedUntil,
    },
  });
  await tx.creditEvent.create({
    data: {
      userId: user.id,
      delta: next.delta,
      reason: params.reason,
      appointmentId: params.appointmentId ?? null,
      note: params.note ?? null,
    },
  });
  return next;
}

export async function rewardAttendanceTx(
  tx: Tx,
  params: { userId: string; appointmentId?: string | null; note?: string },
) {
  const user = await tx.user.findUniqueOrThrow({ where: { id: params.userId } });
  const next = applyAttendance({
    creditScore: user.creditScore,
    noShowCount: user.noShowCount,
    bannedUntil: user.bannedUntil,
  });
  if (next.delta === 0) return next; // 已满分，不产生变动
  await tx.user.update({ where: { id: user.id }, data: { creditScore: next.creditScore } });
  await tx.creditEvent.create({
    data: {
      userId: user.id,
      delta: next.delta,
      reason: "ATTENDED",
      appointmentId: params.appointmentId ?? null,
      note: params.note ?? null,
    },
  });
  return next;
}

/** 清理解禁（定时任务用）。noShowCount 保留不动。 */
export async function clearExpiredBans(now = new Date()) {
  const result = await prisma.user.updateMany({
    where: { bannedUntil: { lt: now } },
    data: { bannedUntil: null },
  });
  return result.count;
}
