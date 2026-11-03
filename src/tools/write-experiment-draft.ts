/**
 * 工具：写一份实验发布草稿。
 *
 * 这是发布助手唯一的能力 —— 模型不能建实验、不能发布、不能查库，
 * 只能把用户的想法整理成结构化字段；真正的落库仍然走
 * `/api/experiments` → `publishExperiment()`，和手动发布是同一条路。
 *
 * 为什么用工具而不是让模型直接输出 JSON：
 *   1. 参数由 Zod 校验，模型少给字段/给错类型不会把页面带崩；
 *   2. schema 只有一份，给模型的 JSON Schema 和运行时校验同源；
 *   3. 与房间/门厅两个注册表保持同一种扩展方式 —— 加能力是加文件，不是改提示词。
 *
 * ⚠️ 时段只收「星期 + 起止 + 周数」，不收具体日期。
 * 让模型算日期是这类系统最常见的错误来源（跨月、闰年、今天算不算下周），
 * 所以日期换算统一交给 domain/experiment-draft.ts 的 planSlots()。
 */
import { z } from "zod";
import type { AgentTool } from "@/tools/registry";
import { normalizeExperimentDraft } from "@/domain/experiment-draft";
import type { DraftContext } from "@/tools/draft-context";

const slotPlanSchema = z.object({
  weekdays: z
    .array(z.number().int().min(1).max(7))
    .min(1)
    .max(7)
    .describe("每周哪几天，1=周一 … 7=周日。例如周二和周四写 [2,4]"),
  startTime: z.string().describe("每天最早开始时间，24 小时制 HH:mm，例如 14:00"),
  endTime: z.string().describe("每天最晚结束时间，HH:mm，例如 17:00"),
  weeks: z.number().int().min(1).max(4).default(1).describe("连续排几周，1–4"),
  anchor: z
    .enum(["TOMORROW", "NEXT_WEEK"])
    .default("TOMORROW")
    .describe("TOMORROW=从明天起算；NEXT_WEEK=从下周一起算（用户说「下周」时用它）"),
});

const draftArgsSchema = z.object({
  title: z.string().describe("实验标题，4–60 字，不要标题党"),
  description: z
    .string()
    .describe("实验说明，120–320 字，写清做什么、多久、报酬、注意事项；不要编造伦理批号"),
  location: z
    .string()
    .describe("楼栋 + 房间。不知道具体房间时填「待补充」，绝对不要编造房间号"),
  durationMin: z.number().int().min(5).max(480).describe("单次实验时长（分钟），5–480"),
  rewardYuan: z.number().int().min(1).max(9999).describe("每人报酬（元），1–9999"),
  type: z.enum(["INDIVIDUAL", "GROUP"]).default("INDIVIDUAL").describe("一对一还是团体"),
  groupSize: z
    .number()
    .int()
    .min(2)
    .max(30)
    .nullable()
    .optional()
    .describe("团体实验每场人数（2–30）；一对一传 null"),
  requirements: z
    .string()
    .describe("参加要求，例如视力、年龄、此前是否参加过同类实验；没有就传空字符串"),
  minCreditScore: z.number().int().min(0).max(100).default(0).describe("信誉分门槛，默认 0"),
  needsVerification: z.boolean().default(true).describe("是否只允许已认证学生报名"),
  slotPlan: slotPlanSchema,
  notes: z
    .array(z.string())
    .max(5)
    .default([])
    .describe("你替用户做的假设，每条一句话，会显示在草稿卡片上"),
});

export const writeExperimentDraftTool: AgentTool<typeof draftArgsSchema, DraftContext> = {
  name: "write_experiment_draft",
  description:
    "把主试的一句话想法写成一份完整的实验发布草稿（标题、说明、地点、时长、报酬、要求、时段计划）。" +
    "信息不全时用合理默认值，并在 notes 里说明假设；绝对不能编造房间号和伦理批号。",
  schema: draftArgsSchema,
  async execute({ ctx }, args) {
    const { draft, issues, notes } = normalizeExperimentDraft(args, {
      now: ctx.now,
      anchorDate: ctx.anchorDate,
    });

    return {
      ok: true,
      draft,
      issues,
      notes: [...notes, ...(args.notes ?? [])].slice(0, 6),
      summary: `已生成：${draft.title}，${draft.slots.length} 个时段`,
    };
  },
};
