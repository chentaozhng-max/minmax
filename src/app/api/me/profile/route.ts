import { z } from "zod";
import { ok, handle } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  skip: z.boolean().optional(),
  isStudent: z.boolean().optional(),
  school: z.string().max(40).optional(),
  department: z.string().max(40).optional(),
  grade: z.string().max(20).optional(),
  interests: z.array(z.string().max(20)).max(10).optional(),
  timePreference: z.array(z.string().max(20)).max(10).optional(),
});

/**
 * 完善资料（首次进入的引导）。
 * skip=true 表示"先跳过"，同样标记完成，避免每次进首页都被拦。
 */
export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  const input = schema.parse(await req.json());

  const data: Record<string, unknown> = { profileCompleted: true };

  if (!input.skip) {
    if (input.school !== undefined) data.school = input.school.trim() || null;
    if (input.department !== undefined) data.department = input.department.trim() || null;
    if (input.grade !== undefined) data.grade = input.grade || null;
    if (input.interests) data.interests = input.interests.join(",");
    if (input.timePreference) data.timePreference = input.timePreference.join(",");
  }

  const updated = await prisma.user.update({ where: { id: user.id }, data });
  return ok({ profileCompleted: updated.profileCompleted }, input.skip ? "已跳过" : "资料已保存");
});
