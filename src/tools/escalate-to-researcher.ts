/**
 * 工具 7/7：被试需要人工沟通时，给主试留言。
 */
import { z } from "zod";
import type { AgentTool } from "@/tools/registry";
import type { AgentContext } from "@/tools/context";
import { ChatState } from "@/lib/domain";

export const escalateToResearcherTool: AgentTool<z.ZodObject<{ message: z.ZodString }>, AgentContext> = {
  name: "escalate_to_researcher",
  description: "被试需要人工沟通时，给主试留言",
  risk: "side-effect",
  schema: z.object({
    message: z.string().describe("给主试的留言"),
  }),
  async execute({ sink }, args) {
    sink.state = ChatState.ESCALATED;
    return { ok: true, delivered: args.message };
  },
};
