import { prisma } from "@/lib/prisma";
import { ok, handle, ApiError } from "@/lib/http";
import { verifyEduEmailSchema } from "@/lib/domain";
import { requireUser } from "@/lib/auth";
import { sendVerifyMail } from "@/server/mail";

function domainAllowed(email: string) {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  const extra = (process.env.EDU_EMAIL_DOMAINS ?? "edu.cn,edu")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  // 默认允许 *.edu.cn 与 *.edu 后缀
  if (domain.endsWith(".edu.cn") || domain === "edu.cn") return true;
  if (domain.endsWith(".edu") || domain === "edu") return true;
  return extra.some((suffix) => domain.endsWith(suffix));
}

export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  const body = await req.json();
  const input = verifyEduEmailSchema.parse(body);

  if (!domainAllowed(input.eduEmail)) {
    throw new ApiError(400, "请使用学校提供的教育邮箱（.edu.cn / .edu）");
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  await prisma.verifyCode.create({
    data: {
      target: input.eduEmail.toLowerCase(),
      purpose: "EDU_EMAIL",
      code,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { school: input.school, studentId: input.studentId, eduEmail: input.eduEmail },
  });

  await sendVerifyMail(input.eduEmail, code);

  return ok(
    { sent: true, devCode: process.env.NODE_ENV !== "production" ? code : undefined },
    "验证码已发送到你的教育邮箱",
  );
});
