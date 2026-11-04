/**
 * Prisma 实现：SlotRepository。
 *
 * ⚠️ 这里那句条件 UPDATE 是从 src/server/appointments.ts **原样搬过来的**，
 * 一个字都没改。防超卖的语义不因为重构而变 —— 这是 Phase 4 的硬约束。
 */
import type { SlotRecord, SlotRepository } from "@/domain/ports/repositories";
import type { PrismaClientLike } from "./types";

/** Slot 查询用到的 include 形状（含实验，报名判定要看实验状态与门槛） */
const SLOT_INCLUDE = {
  experiment: {
    select: {
      id: true,
      title: true,
      researcherId: true,
      status: true,
      signupDeadline: true,
      minCreditScore: true,
      needsVerification: true,
      needsQuestionnaire: true,
    },
  },
} as const;

type RawSlot = {
  id: string;
  experimentId: string;
  startAt: Date;
  endAt: Date;
  capacity: number;
  bookedCount: number;
  experiment: {
    id: string;
    title: string;
    researcherId: string;
    status: string;
    signupDeadline: Date;
    minCreditScore: number;
    needsVerification: boolean;
    needsQuestionnaire: boolean;
  };
};

function toRecord(raw: RawSlot): SlotRecord {
  return {
    id: raw.id,
    experimentId: raw.experimentId,
    startAt: raw.startAt,
    endAt: raw.endAt,
    capacity: raw.capacity,
    bookedCount: raw.bookedCount,
    experiment: {
      id: raw.experiment.id,
      title: raw.experiment.title,
      researcherId: raw.experiment.researcherId,
      status: raw.experiment.status as SlotRecord["experiment"]["status"],
      signupDeadline: raw.experiment.signupDeadline,
      minCreditScore: raw.experiment.minCreditScore,
      needsVerification: raw.experiment.needsVerification,
      needsQuestionnaire: raw.experiment.needsQuestionnaire,
    },
  };
}

export function makeSlotRepository(db: PrismaClientLike): SlotRepository {
  return {
    async findById(id) {
      const raw = (await db.slot.findUnique({ where: { id }, include: SLOT_INCLUDE })) as RawSlot | null;
      return raw ? toRecord(raw) : null;
    },

    /**
     * 原子占位 —— 防超卖的唯一实现点。
     *
     * 必须是条件 UPDATE：`WHERE bookedCount < capacity`。
     * 绝不允许改写成「先 findUnique 查余量，再 update 自增」：
     * 两个请求同时查到余量 1，就会都通过检查，最后超卖。
     */
    async tryOccupy(slotId) {
      const affected = await db.$executeRaw`
        UPDATE "Slot"
        SET "bookedCount" = "bookedCount" + 1
        WHERE "id" = ${slotId} AND "bookedCount" < "capacity"
      `;
      return affected > 0;
    },

    async release(slotId) {
      await db.$executeRaw`
        UPDATE "Slot" SET "bookedCount" = MAX("bookedCount" - 1, 0) WHERE "id" = ${slotId}
      `;
    },
  };
}
