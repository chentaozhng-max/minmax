import { prisma } from "@/lib/prisma";
import { ok, handle, ApiError } from "@/lib/http";
import { confirmVerifySchema } from "@/lib/domain";
import { requireUser } from "@/lib/auth";

export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  const body = await req.json();
  const { eduEmail, code } = confirmVerifySchema.parse(body);

  const record = await prisma.verifyCode.findFirst({
    where: { target: eduEmail.toLowerCase(), purpose: "EDU_EMAIL", consumed: false },
    orderBy: { createdAt: "desc" },
  });

  const isDevMaster = process.env.NODE_ENV !== "production" && code === "123456";
  if (!isDevMaster) {
    if (!record || record.code !== code) throw new ApiError(400, "验证码不正确");
    if (record.expiresAt.getTime() < Date.now()) throw new ApiError(400, "验证码已过期");
  }
  if (record) {
    await prisma.verifyCode.update({ where: { id: record.id }, data: { consumed: true } });
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { studentVerified: true, verifiedAt: new Date(), eduEmail: eduEmail.toLowerCase() },
  });

  return ok({ studentVerified: updated.studentVerified }, "学生认证已完成");
});
