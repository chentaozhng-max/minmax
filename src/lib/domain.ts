/**
 * 领域常量与类型。
 * SQLite 下 Prisma 不支持 enum，所以这里是唯一事实源：数据库存 String，代码用这里的常量约束。
 */
import { z } from "zod";

export const Role = {
  SUBJECT: "SUBJECT",
  RESEARCHER: "RESEARCHER",
  ADMIN: "ADMIN",
} as const;
export type Role = (typeof Role)[keyof typeof Role];

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

/** ChatSession.messages 的元素结构 */
export type ChatToolCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
};

export type ChatMessage = {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  toolCalls?: ChatToolCall[];
  createdAt: string;
};

export function parseMessages(raw: string): ChatMessage[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as ChatMessage[];
  } catch {
    return [];
  }
}

export function stringifyMessages(messages: ChatMessage[]): string {
  return JSON.stringify(messages);
}

/* ------------------------------ Zod schema ------------------------------ */

export const loginSchema = z.object({
  phone: z.string().regex(/^1\d{10}$/, "请输入 11 位手机号"),
  code: z.string().length(6, "验证码为 6 位"),
});

export const sendCodeSchema = z.object({
  phone: z.string().regex(/^1\d{10}$/, "请输入 11 位手机号"),
});

export const verifyEduEmailSchema = z.object({
  school: z.string().min(2, "请填写学校全称"),
  studentId: z.string().min(4, "请填写学号"),
  eduEmail: z.string().email("邮箱格式不正确"),
});

export const confirmVerifySchema = z.object({
  eduEmail: z.string().email("邮箱格式不正确"),
  code: z.string().length(6, "验证码为 6 位"),
});

export const slotInputSchema = z.object({
  startAt: z.string(),
  endAt: z.string(),
  capacity: z.number().int().min(1).max(50),
});

export const createExperimentSchema = z
  .object({
    title: z.string().min(4, "标题至少 4 个字").max(60, "标题最多 60 个字"),
    description: z.string().min(10, "描述至少 10 个字"),
    location: z.string().min(2, "请填写实验地点"),
    durationMin: z.number().int().min(5).max(480),
    rewardText: z.string().min(1, "请填写报酬"),
    type: z.enum(["INDIVIDUAL", "GROUP"]),
    groupSize: z.number().int().min(2).max(30).nullable().optional(),
    requirements: z.string().optional(),
    minCreditScore: z.number().int().min(0).max(100),
    needsVerification: z.boolean(),
    signupDeadline: z.string(),
    slots: z.array(slotInputSchema).min(1, "至少需要一个时段"),
    publish: z.boolean().optional(),
  })
  .refine((v) => v.type !== "GROUP" || (v.groupSize ?? 0) >= 2, {
    message: "团体实验必须填写团体人数（≥2）",
    path: ["groupSize"],
  });

export const bookSlotSchema = z.object({
  slotId: z.string().min(1),
});

export const editExperimentSchema = z.object({
  title: z.string().min(4, "标题至少 4 个字").max(60, "标题最多 60 个字").optional(),
  description: z.string().min(10, "描述至少 10 个字").optional(),
  location: z.string().min(2, "请填写实验地点").optional(),
  durationMin: z.number().int().min(5).max(480).optional(),
  rewardText: z.string().min(1, "请填写报酬").optional(),
  requirements: z.string().nullable().optional(),
  minCreditScore: z.number().int().min(0, "信誉门槛 0–100").max(100, "信誉门槛 0–100").optional(),
  needsVerification: z.boolean().optional(),
  signupDeadline: z.string().optional(),
  status: z.enum(["DRAFT", "PUBLISHED", "CLOSED", "FINISHED"]).optional(),
});export const chatMessageSchema = z.object({
  content: z.string().min(1).max(500),
});
