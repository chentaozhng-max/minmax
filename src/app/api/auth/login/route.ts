import { prisma } from "@/lib/prisma";
import { ok, handle, ApiError } from "@/lib/http";
import { loginSchema } from "@/lib/domain";
import {
  attachAuthCookies,
  isSecureRequest,
  signAccess,
  signRefresh,
  type SessionPayload,
} from "@/lib/auth";

export const POST = handle(async (req: Request) => {
  const body = await req.json();
  const { phone, code } = loginSchema.parse(body);

  const record = await prisma.verifyCode.findFirst({
    where: { target: phone, purpose: "LOGIN", consumed: false },
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

  let user = await prisma.user.findUnique({ where: { phone } });
  if (!user) {
    user = await prisma.user.create({
      data: { phone, name: `被试${phone.slice(-4)}`, role: "SUBJECT" },
    });
  }

  const payload: SessionPayload = {
    sub: user.id,
    role: user.role as SessionPayload["role"],
    name: user.name,
  };
  const access = await signAccess(payload);
  const refresh = await signRefresh(user.id);

  const res = ok({
    id: user.id,
    name: user.name,
    role: user.role,
    studentVerified: user.studentVerified,
      profileCompleted: user.profileCompleted,
    creditScore: user.creditScore,
  });
  return attachAuthCookies(res, access, refresh, isSecureRequest(req));
});
