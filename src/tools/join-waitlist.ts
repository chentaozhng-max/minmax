/**
 * 工具 6/7：没有可用时段时，登记候补。
 */
import { z } from "zod";
import type { AgentTool } from "@/tools/registry";
import type { AgentContext } from "@/tools/context";
import { ChatState } from "@/lib/domain";

export const joinWaitlistTool: AgentTool<z.ZodObject<{}>, AgentContext> = {
  name: "join_waitlist",
  description: "没有可用时段时，登记候补",
  // write 语义，但闸会拒绝它 —— 候补机制根本没实现，登记了也不会有人通知
  risk: "write",
  schema: z.object({}),
  async execute({ sink }) {
    sink.state = ChatState.WAITLIST;
    return { ok: true };
  },
};
