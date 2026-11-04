import { ok, handle } from "@/lib/http";
import { requireRole } from "@/lib/auth";
import { z } from "zod";
import { setExperimentPublished } from "@/server/experiment-state";

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z.object({ publish: z.boolean() });

/**
 * 主试上架 / 下架实验。
 *
 * 与发布表单不同：这里是「已经有实验了，只改状态」。校验逻辑在
 * server/experiment-state，那里会按库里的真实数据重跑一遍领域规则。
 */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const user = await requireRole("RESEARCHER");
  const { id } = await ctx.params;
  const body = bodySchema.parse(await req.json());

  const updated = await setExperimentPublished({
    experimentId: id,
    researcherId: user.id,
    publish: body.publish,
  });

  return ok(updated, body.publish ? "实验已发布" : "已下架");
});
