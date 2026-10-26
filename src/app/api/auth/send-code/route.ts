import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, handle } from "@/lib/http";
import { sendCodeSchema } from "@/lib/domain";

export const POST = handle(async (req: Request) => {
  const body = await req.json();
  const { phone } = sendCodeSchema.parse(body);

  const code = "123456"; // 开发环境固定验证码
  await prisma.verifyCode.create({
    data: {
      target: phone,
      purpose: "LOGIN",
      code,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    },
  });
  console.log(`[sms-mock] ${phone} 的登录验证码是 ${code}`);

  return ok({ sent: true, devCode: code }, "验证码已发送");
});
