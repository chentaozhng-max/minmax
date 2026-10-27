import { prisma } from "@/lib/prisma";
import { ok, handle, ApiError } from "@/lib/http";
import { loginSchema, roleLabel } from "@/lib/domain";
import {
  attachAuthCookies,
  isSecureRequest,
  signAccess,
  signRefresh,
  type SessionPayload,
} from "@/lib/auth";

/**
 * 自动建号时用的默认昵称，"主试8937" / "被试8937"。
 * 也用来判断一个账号是不是还没被用过（见 switchableRole）。
 */
function autoName(role: "SUBJECT" | "RESEARCHER", phone: string) {
  return `${roleLabel[role]}${phone.slice(-4)}`;
}

/**
 * 可以换身份的账号：还没发布过实验、也没有信誉流水的「空身份」。
 * 理由：新手机号第一次登录才建号，如果当时手滑选了"被试"，之后再想发实验就没路了。
 * 已经发布过实验或已经产生信誉记录的账号一律不改——那部分数据是绑在身份上的。
 * （被试侧的零散预约不阻挡切换：切过去之后在主试界面看不到，也不会被误删。）
 */
async function isFreshAccount(userId: string) {
  const [experiments, events] = await Promise.all([
    prisma.experiment.count({ where: { researcherId: userId } }),
    prisma.creditEvent.count({ where: { userId } }),
  ]);
  return experiments === 0 && events === 0;
}

export const POST = handle(async (req: Request) => {
  const body = await req.json();
  const { phone, code, role: claimedRole } = loginSchema.parse(body);

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
    // 第一次登录：按登录页选的身份建号，不再一律建成被试
    const role = claimedRole ?? "SUBJECT";
    user = await prisma.user.create({
      data: { phone, name: autoName(role, phone), role },
    });
  } else if (claimedRole && claimedRole !== user.role) {
    // 选的身份和账号身份不一致：空账号放行并改过来，有数据的要求切回正确身份
    if (await isFreshAccount(user.id)) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { role: claimedRole, name: autoName(claimedRole, phone) },
      });
    } else {
      throw new ApiError(
        400,
        `这个手机号是${roleLabel[user.role]}账号，请切回「我是${roleLabel[user.role]}」再登录`,
      );
    }
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
