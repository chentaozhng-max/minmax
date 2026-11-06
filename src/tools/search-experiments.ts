/**
 * 助手工具 1：按条件跨实验搜索。
 *
 * 这是「门厅」唯一需要的工具。它只输出列表，不做排期、不建预约 ——
 * 点卡片进「房间」（单实验对话）之后才排期，那条链路复用现有的 7 个工具。
 *
 * ## 为什么 description 写这么长
 *
 * 模型对「什么时候该调我」最敏感。写清楚三件事：
 *   1. 用户还不知道是哪门实验时用它（这是唯一入口）
 *   2. 条件**原样**传中文，不要自己算日期（算日期是确定性代码的事）
 *   3. 没有条件也要调一次 —— 否则模型会跳过工具直接瞎聊
 */
import { z } from "zod";
import type { AgentTool } from "@/tools/registry";
import { searchCriteriaSchema } from "@/domain/search-criteria";
import type { AssistantContext } from "@/tools/assistant-context";

export const searchExperimentsTool: AgentTool<
  typeof searchCriteriaSchema,
  AssistantContext
> = {
  name: "search_experiments",
  description: [
    "按条件查找可以报名的实验。用户说「想找实验」「有什么实验」「周三下午的」「奖励高的」时调用。",
    "条件原样传中文（如 weekday: \"周三\"、timeOfDay: \"下午\"），不要自己换算日期。",
    "即使没有任何条件也要调用一次，用来拿当前的实验列表。",
  ].join(""),
  risk: "read",
  schema: searchCriteriaSchema,
  async execute({ ctx }, args) {
    const payload = await ctx.search(args);
    return {
      ok: true,
      ...payload,
      // 明确告诉模型「接下来该做什么」：它只需要复述 summary + 说「点卡片选时间」
      nextAction:
        payload.experiments.length > 0
          ? "把 summary 用自然中文说给用户，并提示他点下方卡片里的时段来报名。不要自己编时间，也不要罗列所有字段。"
          : "照实说没找到，并给一句放宽条件的建议。",
    };
  },
};
