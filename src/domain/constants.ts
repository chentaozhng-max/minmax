/**
 * 领域常量与枚举。
 *
 * SQLite 下 Prisma 不支持 enum，所以这里是唯一事实源：
 * 数据库存 String，代码用这里的常量约束。
 *
 * 注意：下面每个枚举都是「同名 const + 同名 type」的写法
 * （`export const Role = {...}` + `export type Role = ...`），
 * 两者必须留在同一个文件里，否则拆开就断。
 */

export const Role = {
  SUBJECT: "SUBJECT",
  RESEARCHER: "RESEARCHER",
  ADMIN: "ADMIN",
} as const;
export type Role = (typeof Role)[keyof typeof Role];

/** 界面上出现的身份叫法，避免各处手写"主试/被试"写岔 */
export const roleLabel: Record<string, string> = {
  SUBJECT: "被试",
  RESEARCHER: "主试",
  ADMIN: "管理员",
};

export const ExperimentType = {
  INDIVIDUAL: "INDIVIDUAL",
  GROUP: "GROUP",
} as const;
export type ExperimentType = (typeof ExperimentType)[keyof typeof ExperimentType];

export const ExperimentStatus = {
  DRAFT: "DRAFT",
  PUBLISHED: "PUBLISHED",
  CLOSED: "CLOSED",
  FINISHED: "FINISHED",
} as const;
export type ExperimentStatus = (typeof ExperimentStatus)[keyof typeof ExperimentStatus];

export const AppointmentStatus = {
  PENDING_SUBJECT_CONFIRM: "PENDING_SUBJECT_CONFIRM",
  AWAITING_RESEARCHER: "AWAITING_RESEARCHER",
  CONFIRMED: "CONFIRMED",
  CHECKED_IN: "CHECKED_IN",
  COMPLETED: "COMPLETED",
  NO_SHOW: "NO_SHOW",
  CANCELLED_BY_SUBJECT: "CANCELLED_BY_SUBJECT",
  CANCELLED_BY_RESEARCHER: "CANCELLED_BY_RESEARCHER",
} as const;
export type AppointmentStatus = (typeof AppointmentStatus)[keyof typeof AppointmentStatus];

export const CreditReason = {
  ATTENDED: "ATTENDED",
  NO_SHOW: "NO_SHOW",
  RESEARCHER_NO_SHOW: "RESEARCHER_NO_SHOW",
  RESEARCHER_CANCEL: "RESEARCHER_CANCEL",
  MANUAL_ADJUST: "MANUAL_ADJUST",
} as const;
export type CreditReason = (typeof CreditReason)[keyof typeof CreditReason];

export const AppealStatus = {
  PENDING: "PENDING",
  UPHELD: "UPHELD",
  REJECTED: "REJECTED",
} as const;
export type AppealStatus = (typeof AppealStatus)[keyof typeof AppealStatus];

/** 站内通知的类别 */
export const NotificationKind = {
  /** 实验开始前的到时提醒（三档） */
  REMINDER: "REMINDER",
} as const;
export type NotificationKind = (typeof NotificationKind)[keyof typeof NotificationKind];

export const ChatState = {
  COLLECTING_AVAILABILITY: "COLLECTING_AVAILABILITY",
  PROPOSED: "PROPOSED",
  BOOKED: "BOOKED",
  WAITLIST: "WAITLIST",
  ESCALATED: "ESCALATED",
  CLOSED: "CLOSED",
} as const;
export type ChatState = (typeof ChatState)[keyof typeof ChatState];

/** 仍占用名额、且会与被试其他安排冲突的状态 */
export const ACTIVE_APPOINTMENT_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.PENDING_SUBJECT_CONFIRM,
  AppointmentStatus.AWAITING_RESEARCHER,
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.CHECKED_IN,
];

/** 会阻塞同一时段的其他报名（容量已被占） */
export const OCCUPYING_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.PENDING_SUBJECT_CONFIRM,
  AppointmentStatus.AWAITING_RESEARCHER,
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.CHECKED_IN,
  AppointmentStatus.COMPLETED,
];

export const appointmentStatusLabel: Record<AppointmentStatus, string> = {
  PENDING_SUBJECT_CONFIRM: "待我确认",
  AWAITING_RESEARCHER: "待主试确认",
  CONFIRMED: "已确认",
  CHECKED_IN: "已签到",
  COMPLETED: "已完成",
  NO_SHOW: "未到场",
  CANCELLED_BY_SUBJECT: "我已取消",
  CANCELLED_BY_RESEARCHER: "主试已取消",
};

export const creditReasonLabel: Record<CreditReason, string> = {
  ATTENDED: "按时到场完成实验",
  NO_SHOW: "未到场",
  RESEARCHER_NO_SHOW: "主试未到场",
  RESEARCHER_CANCEL: "主试临时取消",
  MANUAL_ADJUST: "人工调整",
};

export const experimentStatusLabel: Record<ExperimentStatus, string> = {
  DRAFT: "草稿",
  PUBLISHED: "招募中",
  CLOSED: "已关闭",
  FINISHED: "已结束",
};
