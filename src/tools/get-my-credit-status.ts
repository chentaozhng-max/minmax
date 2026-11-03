/**
 * 工具 3/7：读取当前被试的信誉分与是否被禁报名。
 */
import { z } from "zod";
import type { AgentTool } from "@/tools/registry";
import type { AgentContext } from "@/tools/context";

export const getMyCreditStatusTool: AgentTool<z.ZodObject<{}>, AgentContext> = {
  name: "get_my_credit_status",
  description: "读取当前被试的信誉分与是否被禁报名",
  schema: z.object({}),
  async execute({ ctx }) {
    return {
      ok: true,
      creditScore: ctx.subject.creditScore,
      noShowCount: ctx.subject.noShowCount,
      bannedUntil: ctx.subject.bannedUntil?.toISOString() ?? null,
      studentVerified: ctx.subject.studentVerified,
      minCreditScore: ctx.experiment.minCreditScore,
      needsVerification: ctx.experiment.needsVerification,
    };
  },
};
