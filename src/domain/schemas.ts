/**
 * 请求体校验用的 Zod schema。
 *
 * 全是「外部输入」的边界校验：API 路由、表单提交都走这里。
 * 与 constants.ts 分开的理由：常量是领域事实，schema 是接口契约，
 * 两者的变更频率与责任人不同（改文案 vs 改类型）。
 */
import { z } from "zod";

export const loginSchema = z.object({
  phone: z.string().regex(/^1\d{10}$/, "请输入 11 位手机号"),
  code: z.string().length(6, "验证码为 6 位"),
  /** 登录页选的身份。老客户端不传时按已有账号的身份处理。 */
  role: z.enum(["SUBJECT", "RESEARCHER"]).optional(),
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
    rewardText: z.string().regex(/^¥\d{1,4}$/, "奖励金额请填 1–9999 元的数字"),
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
  rewardText: z.string().regex(/^¥\d{1,4}$/, "奖励金额请填 1–9999 元的数字").optional(),
  requirements: z.string().nullable().optional(),
  minCreditScore: z.number().int().min(0, "信誉门槛 0–100").max(100, "信誉门槛 0–100").optional(),
  needsVerification: z.boolean().optional(),
  signupDeadline: z.string().optional(),
  status: z.enum(["DRAFT", "PUBLISHED", "CLOSED", "FINISHED"]).optional(),
});

export const chatMessageSchema = z.object({
  content: z.string().min(1).max(500),
});

/**
 * 发布助手请求体。
 *
 * history 只带最近的文字轮次；上一版草稿单独传，服务端拼成一条 user 消息。
 * 这样「再便宜点」这类追问能落在具体字段上，而不是让模型凭记忆改。
 */
export const publishDraftRequestSchema = z.object({
  brief: z.string().trim().min(2, "说一句你想做的实验").max(500, "一次说太多了，控制在 500 字以内"),
  previousDraft: z.unknown().optional(),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(2000),
      }),
    )
    .max(8, "历史消息太多")
    .optional(),
});
