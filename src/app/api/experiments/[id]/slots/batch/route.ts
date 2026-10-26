import { prisma } from "@/lib/prisma";
import { ok, handle, ApiError } from "@/lib/http";
import { z } from "zod";
import { requireRole } from "@/lib/auth";

const batchSchema = z.object({
  startAt: z.string(),
  endAt: z.string(),
  capacity: z.number().int().min(1).max(50),
});

type Params = { params: Promise<{ id: string }> };

/** 批量追加时段（覆盖已有同开始时间的时段） */
export const POST = handle(async (req: Request, { params }: Params) => {
  const { id } = await params;
  const user = await requireRole("RESEARCHER");
  const experiment = await prisma.experiment.findUnique({ where: { id } });
  if (!experiment) throw new ApiError(404, "实验不存在");
  if (experiment.researcherId !== user.id) throw new ApiError(403, "没有权限");

  const body = await req.json();
  const slots = z.array(batchSchema).min(1).parse(body);

  const existing = await prisma.slot.findMany({
    where: { experimentId: id },
    select: { startAt: true },
  });
  const existingKeys = new Set(existing.map((s) => s.startAt.toISOString()));

  const toCreate = slots
    .map((s) => ({ startAt: new Date(s.startAt), endAt: new Date(s.endAt), capacity: s.capacity }))
    .filter((s) => !Number.isNaN(s.startAt.getTime()) && s.endAt > s.startAt)
    .filter((s) => !existingKeys.has(s.startAt.toISOString()));

  if (toCreate.length === 0) return ok({ created: 0 }, "没有新增时段");

  await prisma.slot.createMany({
    data: toCreate.map((s) => ({ experimentId: id, ...s })),
  });
  return ok({ created: toCreate.length }, `已新增 ${toCreate.length} 个时段`);
});
