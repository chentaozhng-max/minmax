/**
 * 工具 4/7：向被试展示 2-3 个候选时段供其选择。
 *
 * 时序约束：展示后应等待用户挑选，不要立刻 book_slot。
 * 这个约束靠 description 告知模型 + sink.state 置 PROPOSED 供上层校验。
 */
import { z } from "zod";
import type { AgentTool } from "@/tools/registry";
import type { AgentContext } from "@/tools/context";
import { ChatState } from "@/lib/domain";

export const proposeSlotsTool: AgentTool<
  z.ZodObject<{ slotIds: z.ZodArray<z.ZodString>; reasonText: z.ZodString }>,
  AgentContext
> = {
  name: "propose_slots",
  description:
    "向被试展示 2-3 个候选时段供其选择。展示后等待用户挑选，不要继续调用 book_slot",
  schema: z.object({
    slotIds: z
      .array(z.string())
      .describe("候选时段的 id，必须来自 get_available_slots 的结果"),
    reasonText: z.string().describe("一句话说明为什么推荐这几个"),
  }),
  async execute({ ctx, sink }, args) {
    // 再确认一次这些时段是否还可约（可能刚被抢）
    const fresh = await ctx.reloadSlots();
    const picked = fresh.filter((s) => args.slotIds.includes(s.id)).slice(0, 3);

    if (picked.length === 0) {
      return { ok: false, error: "这些时段已经不可用，请重新选择" };
    }

    sink.state = ChatState.PROPOSED;
    return { ok: true, reason: args.reasonText, slots: picked };
  },
};
