/**
 * 报名（预约）的纯判定逻辑。
 *
 * 这里**只做判断，不碰数据库、不碰异常类型**：输入是已经查好的数据，
 * 输出是「能约」或「不能约 + 一句给用户看的话」。
 *
 * 为什么要单独拆出来：
 * 原来这段判断和 Prisma 查询、ApiError 抛错、事务混在 40 行里，
 * 想测「报名截止后被拒」得先起数据库。拆出来之后纯函数直接测，零 IO。
 */

import { checkEligibility } from "@/domain/credit";
import { ACTIVE_APPOINTMENT_STATUSES, ExperimentStatus } from "@/domain/constants";
import type {
  AppointmentRecord,
  AppointmentWithSlot,
  ExperimentRecord,
  SlotRecord,
} from "@/domain/ports/repositories";

export type BookingSubject = {
  id: string;
  bannedUntil: Date | null;
  creditScore: number;
  studentVerified: boolean;
};

export type BookableInput = {
  experiment: ExperimentRecord;
  slot: SlotRecord;
  subject: BookingSubject;
  /** 与该时段重叠的其他有效预约 */
  conflicts: AppointmentWithSlot[];
  /** 该被试在该时段上已有的预约（可能是已取消的旧记录） */
  existing: AppointmentRecord | null;
  now: Date;
};

export type Rejection = {
  /** HTTP 状态码，让上层不需要再判断该抛 400 还是 403 还是 409 */
  status: 400 | 403 | 409;
  message: string;
};

/**
 * 报名资格判定。返回 `null` 表示可以约。
 *
 * 判定顺序是**有意的**，不要随意调换：
 *   1. 实验是否开放（状态 / 截止时间）—— 全局约束优先
 *   2. 时段是否已开始             —— 单条约束
 *   3. 不能约自己的实验           —— 身份约束
 *   4. 被试资格（封禁 / 学分 / 认证）—— 人的约束
 *   5. 时间冲突                   —— 与其他数据的关系
 *   6. 重复预约                   —— 与自身数据的关系
 *
 * 先报全局再报个体，用户看到的第一句话才是「该实验不能报名」而不是
 * 「你学分不够」—— 后者会误导用户去刷分，而那根本没用。
 */
export function assertBookable(input: BookableInput): Rejection | null {
  const { experiment, slot, subject, conflicts, existing, now } = input;

  if (experiment.status !== ExperimentStatus.PUBLISHED) {
    return { status: 400, message: "该实验当前不接受报名" };
  }
  if (experiment.signupDeadline.getTime() <= now.getTime()) {
    return { status: 400, message: "报名已截止" };
  }
  if (slot.startAt.getTime() <= now.getTime()) {
    return { status: 400, message: "该时段已开始，无法预约" };
  }
  if (experiment.researcherId === subject.id) {
    return { status: 400, message: "不能报名自己发布的实验" };
  }

  const eligibility = checkEligibility(
    {
      bannedUntil: subject.bannedUntil,
      creditScore: subject.creditScore,
      studentVerified: subject.studentVerified,
      minCreditScore: experiment.minCreditScore,
      needsVerification: experiment.needsVerification,
    },
    now,
  );
  if (!eligibility.ok) {
    return { status: 403, message: eligibility.message };
  }

  if (conflicts.length > 0) {
    return {
      status: 409,
      message: `该时间段与你已预约的「${conflicts[0].slot.experiment.title}」冲突`,
    };
  }

  // 已取消 / 已失约的旧记录不算「重复预约」，允许复活
  if (existing && ACTIVE_APPOINTMENT_STATUSES.includes(existing.status)) {
    return { status: 409, message: "你已经预约了这个时段" };
  }

  return null;
}

/**
 * 命中的名额是否被占用 —— 占位失败时给人看的话。
 * 之所以单独抽出来：这句话是用户会反复看到的，文案要有唯一来源。
 */
export const SLOT_FULL_MESSAGE = "这个时段刚刚被约满了，换一个吧";
