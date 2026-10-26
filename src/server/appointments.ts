import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/http";
import { checkEligibility, CREDIT, isFreeSubjectCancel, shouldPenalizeResearcherCancel } from "@/lib/credit";
import {
  ACTIVE_APPOINTMENT_STATUSES,
  AppointmentStatus,
  ChatState,
  ExperimentStatus,
  type AppointmentStatus as Status,
} from "@/lib/domain";
import { penalizeTx, rewardAttendanceTx } from "@/server/credit";

type BookInput = {
  userId: string;
  slotId: string;
  now?: Date;
  /** AGENT | FORM | DIRECT，仅用于记录来源 */
  source?: string;
};

/**
 * 报名 / 锁定时段。
 * 防超卖核心：先在同一事务内用条件 UPDATE 抢占名额，影响行数为 0 直接失败。
 */
export async function bookSlot(input: BookInput) {
  const now = input.now ?? new Date();
  const slot = await prisma.slot.findUnique({
    where: { id: input.slotId },
    include: { experiment: { include: { researcher: true } } },
  });
  if (!slot) throw new ApiError(404, "时段不存在");

  const experiment = slot.experiment;
  if (experiment.status !== ExperimentStatus.PUBLISHED) throw new ApiError(400, "该实验当前不接受报名");
  if (experiment.signupDeadline.getTime() <= now.getTime()) throw new ApiError(400, "报名已截止");
  if (slot.startAt.getTime() <= now.getTime()) throw new ApiError(400, "该时段已开始，无法预约");
  if (experiment.researcherId === input.userId) throw new ApiError(400, "不能报名自己发布的实验");

  const user = await prisma.user.findUniqueOrThrow({ where: { id: input.userId } });

  // 门槛前置校验（服务端硬校验，前端置灰只是提示）
  const eligibility = checkEligibility(
    {
      bannedUntil: user.bannedUntil,
      creditScore: user.creditScore,
      studentVerified: user.studentVerified,
      minCreditScore: experiment.minCreditScore,
      needsVerification: experiment.needsVerification,
    },
    now,
  );
  if (!eligibility.ok) throw new ApiError(403, eligibility.message);

  // 与被试已有预约的时间冲突
  const conflicts = await prisma.appointment.findMany({
    where: {
      subjectId: input.userId,
      status: { in: ACTIVE_APPOINTMENT_STATUSES },
      slotId: { not: slot.id },
      slot: { startAt: { lt: slot.endAt }, endAt: { gt: slot.startAt } },
    },
    include: { slot: { include: { experiment: true } } },
  });
  if (conflicts.length > 0) {
    throw new ApiError(409, `该时间段与你已预约的「${conflicts[0].slot.experiment.title}」冲突`);
  }

  const existing = await prisma.appointment.findUnique({
    where: { slotId_subjectId: { slotId: slot.id, subjectId: input.userId } },
  });
  if (existing && ACTIVE_APPOINTMENT_STATUSES.includes(existing.status as Status)) {
    throw new ApiError(409, "你已经预约了这个时段");
  }

  return prisma.$transaction(async (tx) => {
    const affected = await tx.$executeRaw`
      UPDATE "Slot"
      SET "bookedCount" = "bookedCount" + 1
      WHERE "id" = ${slot.id} AND "bookedCount" < "capacity"
    `;
    if (affected === 0) {
      throw new ApiError(409, "这个时段刚刚被约满了，换一个吧");
    }

    if (existing) {
      return tx.appointment.update({
        where: { id: existing.id },
        data: {
          status: AppointmentStatus.PENDING_SUBJECT_CONFIRM,
          createdAt: now,
          confirmedAt: null,
          checkedInAt: null,
          noShowAt: null,
          appealStatus: null,
          appealAt: null,
          appealResolvedAt: null,
          remindedAt: null,
        },
      });
    }

    return tx.appointment.create({
      data: {
        experimentId: experiment.id,
        slotId: slot.id,
        subjectId: input.userId,
        status: AppointmentStatus.PENDING_SUBJECT_CONFIRM,
        createdAt: now,
      },
    });
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
  if (appointment.status !== AppointmentStatus.CONFIRMED) throw new ApiError(400, "当前状态无法签到");

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
  return prisma.$transaction(async (tx) => {
    const updated = await tx.appointment.update({
      where: { id },
      data: { status: AppointmentStatus.NO_SHOW, noShowAt: now },
    });
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
    await tx.$executeRaw`
      UPDATE "Slot" SET "bookedCount" = MAX("bookedCount" - 1, 0) WHERE "id" = ${appointment.slotId}
    `;
    return updated;
  });
}

/**
 * 主试取消整场实验。
 * 逐条按 Appointment 对应的 Slot.startAt 判断：< 24h 才记主试未到场（-2 + 禁期），
 * ≥ 24h 只改状态、不扣分、不计次、不写 CreditEvent。
 */
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
    let penalized = 0;
    let waived = 0;
    for (const appointment of affected) {
      const late = shouldPenalizeResearcherCancel(appointment.slot.startAt, now);
      await tx.appointment.update({
        where: { id: appointment.id },
        data: { status: AppointmentStatus.CANCELLED_BY_RESEARCHER },
      });
      if (late) {
        await penalizeTx(tx, {
          userId: researcherId,
          reason: "RESEARCHER_CANCEL",
          appointmentId: appointment.id,
          note: `${experiment.title} 取消，距时段开始不足 24 小时`,
          now,
        });
        penalized += 1;
      } else {
        waived += 1;
      }
    }
    await tx.experiment.update({
      where: { id: experimentId },
      data: { status: ExperimentStatus.CLOSED },
    });
    await tx.slot.updateMany({ where: { experimentId }, data: { bookedCount: 0 } });
    return { penalized, waived };
  });

  return { ...settled, total: affected.length };
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
