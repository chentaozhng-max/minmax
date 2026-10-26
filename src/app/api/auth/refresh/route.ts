import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { ok, handle, fail } from "@/lib/http";
import {
  AUTH_COOKIES,
  attachAuthCookies,
  clearAuthCookies,
  signAccess,
  signRefresh,
  verifyRefresh,
} from "@/lib/auth";

/** 用 refresh token 换新的 access token */
export const POST = handle(async () => {
  const jar = await cookies();
  const refresh = jar.get(AUTH_COOKIES.REFRESH_COOKIE)?.value;
  if (!refresh) return fail(401, "登录已过期");
  const userId = await verifyRefresh(refresh);
  if (!userId) return fail(401, "登录已过期");
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    const res = fail(401, "登录已过期");
    return clearAuthCookies(res);
  }
  const access = await signAccess({ sub: user.id, role: user.role as "SUBJECT", name: user.name });
  return attachAuthCookies(ok({ refreshed: true }), access, await signRefresh(user.id));
});
