import { z } from "zod";
import { ok, handle, ApiError } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import type { Role } from "@/lib/domain";
import { listThreads, openThread } from "@/server/dm";

export const GET = handle(async () => {
  const user = await requireUser();
  const items = await listThreads(user.id, user.role as Role);
  return ok(items);
});

const openSchema = z.object({
  researcherId: z.string().min(1),
  experimentId: z.string().min(1).optional().nullable(),
});

export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  if (user.role !== "SUBJECT") throw new ApiError(403, "只有被试可以发起私信");

  const body = openSchema.parse(await req.json());
  const thread = await openThread({
    subjectId: user.id,
    researcherId: body.researcherId,
    experimentId: body.experimentId ?? null,
  });

  return ok({ id: thread.id }, "已打开会话");
});
