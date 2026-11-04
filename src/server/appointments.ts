import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/http";
import { CREDIT, isFreeSubjectCancel, shouldPenalizeResearcherCancel } from "@/lib/credit";
import {
  ACTIVE_APPOINTMENT_STATUSES,
  AppointmentStatus,
  ChatState,
  ExperimentStatus,
  type AppointmentStatus as Status,
} from "@/lib/domain";
import { penalizeTx, rewardAttendanceTx } from "@/server/credit";
import { bookSlot as bookSlotUseCase, type BookInput } from "@/application/book-slot";
import { makeBundle, makeUnitOfWork } from "@/adapters/db/prisma/unit-of-work";
import { hasPassedQuestionnaire } from "@/server/questionnaire-service";

/**
 * 报名 / 锁定时段。
 *
 * Phase 4 起真正的实现在 `application/book-slot.ts`，这里只负责组装依赖：
 *   - 读仓储：绑定 prisma（读不需要事务）
 *   - 写仓储：UnitOfWork（事务内绑 tx）
 *   - 被试资格：这里查一次 user 表
 *
 * 防超卖逻辑已搬到 `adapters/db/prisma/slot-repo.ts` 的 `tryOccupy`，SQL 一字未改。
 */
export async function bookSlot(input: BookInput) {
  const uow = makeUnitOfWork();

  return bookSlotUseCase(input, {
    readers: uow,
    uow,
    async loadSubject(id: string) {
      const user = await prisma.user.findUniqueOrThrow({
        where: { id },
        select: { id: true, bannedUntil: true, creditScore: true, studentVerified: true },
      });
      return user;
    },
    questionnairePass: hasPassedQuestionnaire,
  });
}

async function loadAppointment(id: string) {
  const appointment = await prisma.appointment.findUnique({
    where: { id },
    include: {
      slot: true,
      experiment: { include: { researcher: true } },
      subject: true,
    },
  });
  if (!appointment) throw new ApiError(404, "预约不存在");
  return appointment;
}

/** 被试确认 → 进入主试待确认队列 */
export async function confirmAsSubject(id: string, userId: string) {
  const appointment = await loadAppointment(id);
  if (appointment.subjectId !== userId) throw new ApiError(403, "只能操作自己的预约");
  if (appointment.status !== AppointmentStatus.PENDING_SUBJECT_CONFIRM) {
    throw new ApiError(400, "当前状态无法确认");
  }
  return prisma.appointment.update({
    where: { id },
    data: { status: AppointmentStatus.AWAITING_RESEARCHER },
  });
}

/** 主试确认预约 → CONFIRMED */
export async function confirmAsResearcher(id: string, researcherId: string) {
  const appointment = await loadAppointment(id);
  if (appointment.experiment.researcherId !== researcherId) throw new ApiError(403, "没有权限");
  if (appointment.status !== AppointmentStatus.AWAITING_RESEARCHER) {
    throw new ApiError(400, "该预约不在待确认状态");
  }
  return prisma.appointment.update({
    where: { id },
    data: {
      status: AppointmentStatus.CONFIRMED,
      confirmedAt: new Date(),
    },
  });
}

/**
 * 被试到场签到：不需要签到码，一键签到。
 * 只限制时间窗（开始前 30 分钟 ~ 结束），防止提前几百天点掉。
 */
export async function checkIn(id: string, userId: string, now = new Date()) {
  const appointment = await loadAppointment(id);
  if (appointment.subjectId !== userId) throw new ApiError(403, "只能操作自己的预约");
  if (appointment.status === AppointmentStatus.CHECKED_IN) throw new ApiError(400, "你已经签到过了");
  // AWAITING_RESEARCHER（被试已确认、主试还没点）也允许签到：
  // 主试忘了确认不该由到了现场的被试买单——否则他既签不了到，又会被判未到场。
  if (
    appointment.status !== AppointmentStatus.CONFIRMED &&
    appointment.status !== AppointmentStatus.AWAITING_RESEARCHER
  ) {
    throw new ApiError(400, "当前状态无法签到");
  }

  const target = appointment.slot;
  if (now.getTime() < target.startAt.getTime() - 30 * 60 * 1000) {
    throw new ApiError(400, "还没到签到时间，实验开始前 30 分钟内可签到");
  }
  if (now.getTime() > target.endAt.getTime()) throw new ApiError(400, "该时段已结束");

  return prisma.appointment.update({
    where: { id },
    data: { status: AppointmentStatus.CHECKED_IN, checkedInAt: now },
  });
}

/** 主试确认到场 → COMPLETED，被试 +1，主试 +1 */
export async function verifyAttendance(id: string, researcherId: string, now = new Date()) {
  const appointment = await loadAppointment(id);
  if (appointment.experiment.researcherId !== researcherId) throw new ApiError(403, "没有权限");
  if (appointment.status !== AppointmentStatus.CHECKED_IN) {
    throw new ApiError(400, "该预约尚未签到");
  }
  return prisma.$transaction(async (tx) => {
    const updated = await tx.appointment.update({
      where: { id },
      data: { status: AppointmentStatus.COMPLETED },
    });
    await rewardAttendanceTx(tx, {
      userId: appointment.subjectId,
      appointmentId: id,
      note: `${appointment.experiment.title} 到场完成`,
    });
    await rewardAttendanceTx(tx, {
      userId: researcherId,
      appointmentId: id,
      note: `${appointment.experiment.title} 按时主持`,
    });
    return updated;
  });
}

/** 主试标记未到 → NO_SHOW，被试 -2 */
export async function markNoShow(id: string, researcherId: string, now = new Date()) {
  const appointment = await loadAppointment(id);
  if (appointment.experiment.researcherId !== researcherId) throw new ApiError(403, "没有权限");
  if (
    appointment.status !== AppointmentStatus.CONFIRMED &&
    appointment.status !== AppointmentStatus.AWAITING_RESEARCHER
  ) {
    throw new ApiError(400, "该预约当前不能标记未到");
  }
  // 时段开始前不能判定「没来」——之前可以提前几天把人标成未到场，直接 -2 并禁期。
  if (now.getTime() < appointment.slot.startAt.getTime()) {
    throw new ApiError(400, "时段还没开始，不能标记未到");
  }
  return prisma.$transaction(async (tx) => {
    const updated = await tx.appointment.update({
      where: { id },
      data: { status: AppointmentStatus.NO_SHOW, noShowAt: now },
    });
    // 名额要放出来：之前标记未到不碰 Slot，那一格永远显示已约满。
    await makeBundle(tx as never).slots.release(appointment.slotId);
    await penalizeTx(tx, {
      userId: appointment.subjectId,
      reason: "NO_SHOW",
      appointmentId: id,
      note: `${appointment.experiment.title} 未到场`,
      now,
    });
    return updated;
  });
}

/** 被试取消：距开始 ≥ 12h 免费取消 */
export async function cancelBySubject(id: string, userId: string, now = new Date()) {
  const appointment = await loadAppointment(id);
  if (appointment.subjectId !== userId) throw new ApiError(403, "只能操作自己的预约");
  if (
    !ACTIVE_APPOINTMENT_STATUSES.includes(appointment.status as Status)
  ) {
    throw new ApiError(400, "当前状态无法取消");
  }
  if (!isFreeSubjectCancel(appointment.slot.startAt, now)) {
    throw new ApiError(400, `距开始不足 ${CREDIT.FREE_CANCEL_HOURS} 小时，无法取消；请到场后正常签到`);
  }
  return prisma.$transaction(async (tx) => {
    const updated = await tx.appointment.update({
      where: { id },
      data: { status: AppointmentStatus.CANCELLED_BY_SUBJECT },
    });
    await makeBundle(tx as never).slots.release(appointment.slotId);
    return updated;
  });
}

/**
 * 主试取消整场实验。
 * 逐条按 Appointment 对应的 Slot.startAt 判断：< 24h 才记主试未到场（-2 + 禁期），
 * ≥ 24h 只改状态、不扣分、不计次、不写 CreditEvent。
 */
/**
 * 主试释放一个还没确认的预约（名额被锁死时的出口），不扣分、不计次。
 * 之前主试端对 PENDING_SUBJECT_CONFIRM 零操作，只能等。
 */
export async function releaseByResearcher(id: string, researcherId: string) {
  const appointment = await loadAppointment(id);
  if (appointment.experiment.researcherId !== researcherId) throw new ApiError(403, "没有权限");
  if (
    appointment.status !== AppointmentStatus.PENDING_SUBJECT_CONFIRM &&
    appointment.status !== AppointmentStatus.AWAITING_RESEARCHER
  ) {
    throw new ApiError(400, "只有待确认的预约可以释放");
  }
  return prisma.$transaction(async (tx) => {
    const updated = await tx.appointment.update({
      where: { id },
      data: { status: AppointmentStatus.CANCELLED_BY_RESEARCHER },
    });
    await makeBundle(tx as never).slots.release(appointment.slotId);
    return updated;
  });
}
export async function cancelExperimentByResearcher(
  experimentId: string,
  researcherId: string,
  now = new Date(),
) {
  const experiment = await prisma.experiment.findUnique({
    where: { id: experimentId },
    include: { appointments: { include: { slot: true } } },
  });
  if (!experiment) throw new ApiError(404, "实验不存在");
  if (experiment.researcherId !== researcherId) throw new ApiError(403, "没有权限");

  const affected = experiment.appointments.filter((a) =>
    ACTIVE_APPOINTMENT_STATUSES.includes(a.status as Status),
  );

  const settled = await prisma.$transaction(async (tx) => {
    // 一次取消动作只记一次，不按预约条数累计：
    // 之前 4 条预约会让主试直接吃到 7 天禁期，而弹窗和接口文案都写「记你一次未到场」。
    const lateList = affected.filter((appointment) =>
      shouldPenalizeResearcherCancel(appointment.slot.startAt, now),
    );
    const lateCount = lateList.length;
    const lateAppointment = lateList[0];
    for (const appointment of affected) {
      await tx.appointment.update({
        where: { id: appointment.id },
        data: { status: AppointmentStatus.CANCELLED_BY_RESEARCHER },
      });
    }
    if (lateAppointment) {
      await penalizeTx(tx, {
        userId: researcherId,
        reason: "RESEARCHER_CANCEL",
        appointmentId: lateAppointment.id,
        note: `${experiment.title} 取消，距时段开始不足 24 小时`,
        now,
      });
    }
    const penalized = lateCount > 0 ? 1 : 0;
    const waived = affected.length - lateCount;
    await tx.experiment.update({
      where: { id: experimentId },
      data: { status: ExperimentStatus.CLOSED },
    });
    await tx.slot.updateMany({ where: { experimentId }, data: { bookedCount: 0 } });
    return { penalized, waived };
  });

  return { ...settled, total: affected.length, lateCount: settled.penalized > 0 ? affected.length - settled.waived : 0 };
}

/** 被试提交申诉（主试未到场），CHECKED_IN 后 24h 内 */
export async function submitAppeal(id: string, userId: string, note: string, now = new Date()) {
  const appointment = await loadAppointment(id);
  if (appointment.subjectId !== userId) throw new ApiError(403, "只能操作自己的预约");
  if (appointment.status !== AppointmentStatus.CHECKED_IN) {
    throw new ApiError(400, "只有已签到的预约可以申诉主试未到场");
  }
  if (appointment.appealStatus) throw new ApiError(400, "你已提交过申诉");
  const deadline = (appointment.checkedInAt ?? now).getTime() + 24 * 60 * 60 * 1000;
  if (now.getTime() > deadline) throw new ApiError(400, "申诉时限已过（签到后 24 小时内可申诉）");

  return prisma.appointment.update({
    where: { id },
    data: { appealStatus: "PENDING", appealAt: now, appealNote: note.slice(0, 200) },
  });
}

/** 主试处理申诉 */
export async function resolveAppeal(
  appointmentId: string,
  researcherId: string,
  result: "UPHELD" | "REJECTED",
  now = new Date(),
) {
  const appointment = await loadAppointment(appointmentId);
  if (appointment.experiment.researcherId !== researcherId) throw new ApiError(403, "没有权限");
  if (appointment.appealStatus !== "PENDING") throw new ApiError(400, "该申诉不在待处理状态");

  return prisma.$transaction(async (tx) => {
    if (result === "UPHELD") {
      const updated = await tx.appointment.update({
        where: { id: appointmentId },
        data: {
          status: AppointmentStatus.CANCELLED_BY_RESEARCHER,
          appealStatus: "UPHELD",
          appealResolvedAt: now,
        },
      });
      await penalizeTx(tx, {
        userId: researcherId,
        reason: "RESEARCHER_NO_SHOW",
        appointmentId,
        note: `${appointment.experiment.title} 申诉成立`,
        now,
      });
      return updated;
    }
    return tx.appointment.update({
      where: { id: appointmentId },
      data: { appealStatus: "REJECTED", appealResolvedAt: now },
    });
  });
}

/** 更新聊天会话状态（预约成功后用） */
export async function markChatState(experimentId: string, subjectId: string, state: string) {
  await prisma.chatSession.updateMany({
    where: { experimentId, subjectId },
    data: { state },
  });
}

export const CHAT_STATE_CLOSED = ChatState.CLOSED;
