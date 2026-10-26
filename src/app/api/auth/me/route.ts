import { ok, handle } from "@/lib/http";
import { currentUser } from "@/lib/auth";
import { isBanned } from "@/lib/credit";
import { prisma } from "@/lib/prisma";

export const GET = handle(async () => {
  const user = await currentUser();
  if (!user) return ok(null);
  const now = new Date();
  return ok({
    id: user.id,
    phone: user.phone,
    name: user.name,
    role: user.role,
    school: user.school,
    department: user.department,
    avatarUrl: user.avatarUrl,
    studentVerified: user.studentVerified,
    studentId: user.studentId,
    eduEmail: user.eduEmail,
    creditScore: user.creditScore,
    noShowCount: user.noShowCount,
    bannedUntil: user.bannedUntil?.toISOString() ?? null,
    banned: isBanned(user.bannedUntil, now),
  });
});

/** 更新自己的资料（姓名 / 学校 / 院系） */
export const PATCH = handle(async (req: Request) => {
  const user = await currentUser();
  if (!user) return ok(null);
  const body = (await req.json()) as { name?: string; school?: string; department?: string };
  const data: Record<string, string> = {};
  if (body.name && body.name.trim().length >= 2) data.name = body.name.trim().slice(0, 20);
  if (body.school !== undefined) data.school = body.school.trim().slice(0, 40);
  if (body.department !== undefined) data.department = body.department.trim().slice(0, 40);
  const updated = await prisma.user.update({ where: { id: user.id }, data });
  return ok({ id: updated.id, name: updated.name }, "已保存");
});
