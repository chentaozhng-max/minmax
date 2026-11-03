/**
 * 提醒所需的持久化能力 —— 领域层对「通知存在哪」的唯一认知。
 *
 * 只有三类能力：找该提醒的预约、写一条提醒、读用户的提醒。
 * 没有「标记已发」这种字段 —— 幂等靠 `(appointmentId, level)` 唯一约束，
 * 不靠一个会忘记更新的布尔位。
 */

import type { ReminderLevel } from "@/domain/reminder-levels";

/** 一条待提醒的预约（含生成文案所需的全部事实，一次查清，不在循环里补查） */
export type ReminderCandidate = {
  appointmentId: string;
  experimentId: string;
  subjectId: string;
  startAt: Date;
  endAt: Date;
  experimentTitle: string;
  location: string;
  researcherName: string;
};

export type CreateReminderInput = {
  userId: string;
  appointmentId: string;
  experimentId: string;
  level: ReminderLevel;
  content: string;
  createdAt: Date;
};

export type NotificationRecord = {
  id: string;
  kind: string;
  level: string | null;
  appointmentId: string | null;
  experimentId: string | null;
  content: string;
  readAt: Date | null;
  createdAt: Date;
};

export interface NotificationRepository {
  /**
   * 找「未来一段时间内开始、且状态为已确认」的预约。
   *
   * `withinMs` 由应用层给（= 最宽的那一档 + 扫描余量），
   * 适配器不做时间窗口的业务判断 —— 那是领域层的事。
   */
  findReminderCandidates(now: Date, withinMs: number): Promise<ReminderCandidate[]>;

  /**
   * 写一条提醒。
   *
   * @returns created=false 表示这一档已经发过（唯一键冲突），调用方跳过即可。
   * 用返回值而不是抛异常：重复是**正常情况**，不是错误。
   */
  createReminder(input: CreateReminderInput): Promise<{ id: string; created: boolean }>;

  /**
   * 这一档是否已经发过。
   *
   * 存在性检查先于生成文案 —— 否则重复扫描时会白白调用一次模型。
   * 它**不能取代**唯一约束：两道检查之间仍可能并发插入，最终仍靠 createReminder 兜住。
   */
  hasReminder(appointmentId: string, level: ReminderLevel): Promise<boolean>;

  /** 某用户的提醒，新的在前 */
  listForUser(userId: string, limit: number): Promise<NotificationRecord[]>;

  /** 未读数（站内红点） */
  countUnread(userId: string): Promise<number>;

  /** 全部标记已读，返回受影响条数 */
  markAllRead(userId: string, now: Date): Promise<number>;
}
