/**
 * 信誉分规则（被试与主试共用同一套）。
 * 这里只放纯函数，方便单测；落库在 src/server/credit.ts。
 */

export const CREDIT = {
  INITIAL: 100,
  MAX: 100,
  MIN: 0,
  /** 按时到场并完成 */
  ATTENDED_DELTA: 1,
  /** 未到场 / 主试未到场 / 主试 <24h 取消 */
  PENALTY_DELTA: 2,
  /** 累计次数 ≤ 此值时禁 1 天 */
  BAN_SOFT_THRESHOLD: 3,
  BAN_SOFT_DAYS: 1,
  BAN_LONG_DAYS: 7,
  /** 主试取消是否算"临时取消"的阈值（小时） */
  LATE_CANCEL_HOURS: 24,
  /** 被试免费取消的提前量（小时） */
  FREE_CANCEL_HOURS: 12,
  /** 主试信誉分低于此值时，实验在列表里降权 */
  LOW_CREDIT_THRESHOLD: 60,
} as const;

/** 第几次未到场对应多长禁期（入参是"本次之后"的累计次数） */
export function banDaysFor(noShowCountAfterIncrement: number): number {
  return noShowCountAfterIncrement <= CREDIT.BAN_SOFT_THRESHOLD
    ? CREDIT.BAN_SOFT_DAYS
    : CREDIT.BAN_LONG_DAYS;
}

export type CreditSnapshot = {
  creditScore: number;
  noShowCount: number;
  bannedUntil: Date | null;
};

export type PenaltyResult = CreditSnapshot & { delta: number };

/**
 * 未到场类处罚：先扣分（不低于 0）→ 次数 +1 → 按累计次数设置禁期。
 * 禁期只延长不缩短：若旧禁期更晚，保留更晚的那个。
 */
export function applyPenalty(snapshot: CreditSnapshot, now: Date): PenaltyResult {
  const creditScore = Math.max(CREDIT.MIN, snapshot.creditScore - CREDIT.PENALTY_DELTA);
  const noShowCount = snapshot.noShowCount + 1;
  const days = banDaysFor(noShowCount);
  const nextBan = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  const bannedUntil =
    snapshot.bannedUntil && snapshot.bannedUntil.getTime() > nextBan.getTime()
      ? snapshot.bannedUntil
      : nextBan;
  return { creditScore, noShowCount, bannedUntil, delta: -CREDIT.PENALTY_DELTA };
}

/** 到场并完成：+1，上限 100。返回实际生效的 delta（到顶时可能为 0） */
export function applyAttendance(snapshot: CreditSnapshot): { creditScore: number; delta: number } {
  const next = Math.min(CREDIT.MAX, snapshot.creditScore + CREDIT.ATTENDED_DELTA);
  return { creditScore: next, delta: next - snapshot.creditScore };
}

/**
 * 主试取消整场实验时，针对单个 Appointment 判断是否要记一次"主试未到场"。
 * 距离该 Appointment 所在 Slot 开始 ≥ 24h → 不扣分、不计次。
 */
export function shouldPenalizeResearcherCancel(slotStartAt: Date, now: Date): boolean {
  const hours = (slotStartAt.getTime() - now.getTime()) / (60 * 60 * 1000);
  return hours < CREDIT.LATE_CANCEL_HOURS;
}

/** 被试取消是否免费（距时段开始 ≥ 12h） */
export function isFreeSubjectCancel(slotStartAt: Date, now: Date): boolean {
  const hours = (slotStartAt.getTime() - now.getTime()) / (60 * 60 * 1000);
  return hours >= CREDIT.FREE_CANCEL_HOURS;
}

export function isBanned(bannedUntil: Date | null | undefined, now: Date): boolean {
  return !!bannedUntil && bannedUntil.getTime() > now.getTime();
}

export type EligibilityInput = {
  bannedUntil: Date | null;
  creditScore: number;
  studentVerified: boolean;
  minCreditScore: number;
  needsVerification: boolean;
};

export type EligibilityResult =
  | { ok: true }
  | { ok: false; reason: "BANNED" | "CREDIT" | "VERIFY"; message: string };

/** 报名资格判定：服务端与前端共用同一份逻辑，避免两端说法不一致 */
export function checkEligibility(input: EligibilityInput, now: Date): EligibilityResult {
  if (isBanned(input.bannedUntil, now)) {
    const rest = Math.max(0, (input.bannedUntil as Date).getTime() - now.getTime());
    return {
      ok: false,
      reason: "BANNED",
      message: `因未到场被限制报名，${Math.ceil(rest / (24 * 60 * 60 * 1000))} 天后解除`,
    };
  }
  if (input.creditScore < input.minCreditScore) {
    return {
      ok: false,
      reason: "CREDIT",
      message: `信誉分不足（需 ${input.minCreditScore}，你 ${input.creditScore}）`,
    };
  }
  if (input.needsVerification && !input.studentVerified) {
    return { ok: false, reason: "VERIFY", message: "需完成学生认证" };
  }
  return { ok: true };
}
