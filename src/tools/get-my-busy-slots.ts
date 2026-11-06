/**
 * 工具 2/7：读取当前被试已有的预约，用于避让时间冲突。
 */
import { z } from "zod";
import type { AgentTool } from "@/tools/registry";
import type { AgentContext } from "@/tools/context";
import { formatSlotRange } from "@/lib/time";

export const getMyBusySlotsTool: AgentTool<z.ZodObject<{}>, AgentContext> = {
  name: "get_my_busy_slots",
  description: "读取当前被试已有的预约，用于避让时间冲突",
  risk: "read",
  schema: z.object({}),
  async execute({ ctx }) {
    return {
      ok: true,
      slots: ctx.busy.map((a) => ({
        label: formatSlotRange(a.slot.startAt, a.slot.endAt),
        experiment: a.slot.experiment.title,
        status: a.status,
      })),
    };
  },
};
