/**
 * Prisma 实现：AppointmentRepository。
 *
 * 查询条件是从 src/server/appointments.ts 原样搬过来的 ——
 * 尤其 findConflicts 的时间重叠判定（`startAt < endAt AND endAt > startAt`），
 * 一个字都没改。
 */
import type {
  AppointmentRecord,
  AppointmentRepository,
  AppointmentWithSlot,
  CreateAppointmentInput,
  SlotRecord,
} from "@/domain/ports/repositories";
import { ACTIVE_APPOINTMENT_STATUSES } from "@/domain/constants";
import type { PrismaClientLike } from "./types";

type RawAppointment = {
  id: string;
  experimentId: string;
  slotId: string;
  subjectId: string;
  status: string;
  createdAt: Date;
};

type RawAppointmentWithSlot = RawAppointment & {
  slot: { id: string; startAt: Date; endAt: Date; experiment: { title: string } };
};

function toRecord(raw: RawAppointment): AppointmentRecord {
  return {
    id: raw.id,
    experimentId: raw.experimentId,
    slotId: raw.slotId,
    subjectId: raw.subjectId,
    status: raw.status as AppointmentRecord["status"],
    createdAt: raw.createdAt,
  };
}

function toRecordWithSlot(raw: RawAppointmentWithSlot): AppointmentWithSlot {
  return {
    ...toRecord(raw),
    slot: {
      id: raw.slot.id,
      startAt: raw.slot.startAt,
      endAt: raw.slot.endAt,
      experiment: { title: raw.slot.experiment.title },
    },
  };
}

export function makeAppointmentRepository(db: PrismaClientLike): AppointmentRepository {
  return {
    async findBySlotAndSubject(slotId, subjectId) {
      const raw = (await db.appointment.findUnique({
        where: { slotId_subjectId: { slotId, subjectId } },
      })) as RawAppointment | null;
      return raw ? toRecord(raw) : null;
    },

    /** 时间重叠判定：条件与重构前完全一致 */
    async findConflicts(subjectId, slot: SlotRecord) {
      const rows = (await db.appointment.findMany({
        where: {
          subjectId,
          status: { in: ACTIVE_APPOINTMENT_STATUSES },
          slotId: { not: slot.id },
          slot: { startAt: { lt: slot.endAt }, endAt: { gt: slot.startAt } },
        },
        include: { slot: { include: { experiment: true } } },
      })) as RawAppointmentWithSlot[];
      return rows.map(toRecordWithSlot);
    },

    async create(input: CreateAppointmentInput) {
      const raw = (await db.appointment.create({
        data: {
          experimentId: input.experimentId,
          slotId: input.slotId,
          subjectId: input.subjectId,
          status: input.status,
          createdAt: input.createdAt,
        },
      })) as RawAppointment;
      return toRecord(raw);
    },

    /**
     * 复活：把一条已存在的预约重置为待确认。
     * 清空的字段清单与重构前一致 —— 少清一个就会留下上次的签到/失约痕迹。
     */
    async reactivate(id, status, createdAt) {
      const raw = (await db.appointment.update({
        where: { id },
        data: {
          status,
          createdAt,
          confirmedAt: null,
          checkedInAt: null,
          noShowAt: null,
          appealStatus: null,
          appealAt: null,
          appealResolvedAt: null,
          remindedAt: null,
        },
      })) as RawAppointment;
      return toRecord(raw);
    },
  };
}
