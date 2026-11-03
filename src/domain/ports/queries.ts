/**
 * 只读查询端口 —— 与 repositories.ts 的区别：
 *
 * repositories 是「按 id 取一个聚合、改完写回」，面向命令；
 * 这里是「按条件取一屏数据给上层组装视图」，面向查询。
 * 分开的理由：读多写少，读的形状常按页面变化，混进写仓储会让端口长成一坨。
 *
 * 依赖方向同样是向内：application/ → domain/ports/ ← adapters/db/prisma/
 */

import type { AppointmentStatus, ExperimentStatus, ExperimentType } from "@/domain/constants";

/** 实验详情（对话上下文和提示词要用到的全部字段） */
export type ExperimentDetail = {
  id: string;
  title: string;
  researcherId: string;
  researcherName: string;
  status: ExperimentStatus;
  type: ExperimentType;
  groupSize: number | null;
  location: string;
  durationMin: number;
  rewardText: string;
  minCreditScore: number;
  needsVerification: boolean;
  signupDeadline: Date;
};

/** 被试画像（资格判定 + 提示词） */
export type SubjectProfile = {
  id: string;
  creditScore: number;
  noShowCount: number;
  bannedUntil: Date | null;
  studentVerified: boolean;
};

/** 时段摘要（列表展示用，不带实验） */
export type SlotSummary = {
  id: string;
  startAt: Date;
  endAt: Date;
  capacity: number;
  bookedCount: number;
};

/** 已有预约 + 它占的时间与所属实验（用于避让和冲突提示） */
export type BusyAppointment = {
  id: string;
  status: AppointmentStatus;
  slot: {
    startAt: Date;
    endAt: Date;
    experiment: { title: string };
  };
};

export interface SchedulingQueryPort {
  /** 实验详情；不存在返回 null（转换 ApiError 是应用层的事） */
  findExperimentDetail(experimentId: string): Promise<ExperimentDetail | null>;

  /** 被试画像；不存在返回 null */
  findSubjectProfile(userId: string): Promise<SubjectProfile | null>;

  /**
   * 某实验在 `from` 之后的时段，按开始时间升序取前 take 条。
   *
   * 注意：**不在这里过滤「已满」**。SQLite 不支持字段间比较，
   * 过滤放在应用层（内存），这是重构前就有的行为，此处原样保留。
   */
  findUpcomingSlots(experimentId: string, from: Date, take: number): Promise<SlotSummary[]>;

  /** 某被试当前有效的预约（含时段与实验名），按创建时间倒序 */
  findActiveAppointments(subjectId: string, statuses: AppointmentStatus[]): Promise<BusyAppointment[]>;
}
