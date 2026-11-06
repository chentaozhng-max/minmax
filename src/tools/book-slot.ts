/**
 * 工具 5/7：锁定时段并创建预约。
 *
 * 时序约束：只有被试明确选定某个时段后才调用。
 * 失败时 sink 必须保持干净（不能被污染成 BOOKED）。
 */
import { z } from "zod";
import type { AgentTool } from "@/tools/registry";
import type { AgentContext } from "@/tools/context";
import { ChatState } from "@/lib/domain";

export const bookSlotTool: AgentTool<z.ZodObject<{ slotId: z.ZodString }>, AgentContext> = {
  name: "book_slot",
  description: "锁定时段并创建预约。只有被试明确选定某个时段后才调用",
  // write：产出一张业务单据。闸会无条件拒绝它（下单只能由用户点组件）
  risk: "write",
  schema: z.object({
    slotId: z.string().describe("被选中的时段 id"),
  }),
  async execute({ ctx, sink }, args) {
    const target = ctx.availableSlots.find((s) => s.id === args.slotId);
    if (!target) {
      return { ok: false, error: "该时段不在候选列表中" };
    }

    try {
      const appointment = await ctx.book(args.slotId);
      // 只有成功之后才写 sink —— 保证失败时状态干净
      sink.state = ChatState.BOOKED;
      sink.appointmentId = appointment.id;
      sink.bookedLabel = target.label;
      return {
        ok: true,
        appointmentId: appointment.id,
        label: target.label,
        status: appointment.status,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "预订失败";
      return { ok: false, error: message };
    }
  },
};
