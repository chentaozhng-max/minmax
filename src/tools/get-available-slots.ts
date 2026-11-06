/**
 * 工具 1/7：读取该实验当前还有空位的时段。
 * 这是「系统事实」的唯一来源 —— 禁止模型自己编时间。
 */
import { z } from "zod";
import type { AgentTool } from "@/tools/registry";
import type { AgentContext } from "@/tools/context";

export const getAvailableSlotsTool: AgentTool<z.ZodObject<{}>, AgentContext> = {
  name: "get_available_slots",
  description: "读取该实验当前还有空位的时段（系统事实，不要自己编时间）",
  risk: "read",
  schema: z.object({}),
  async execute({ ctx }) {
    // 每次现读一次，保证给模型的是最新余位（可能刚被别人抢走）
    const fresh = await ctx.reloadSlots();
    return {
      ok: true,
      slots: fresh.map((s) => ({ id: s.id, label: s.label, remaining: s.remaining })),
    };
  },
};
