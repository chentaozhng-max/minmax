import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { attachAuthCookies, isSecureRequest, signAccess, signRefresh } from "@/lib/auth";
import type { Role } from "@/lib/domain";

/**
 * 开发/自测用的一键登录（给截图、冒烟脚本用）。
 * 只有显式设置 ENABLE_DEV_LOGIN=true 才生效，默认 404，部署时不会成为后门。
 * 用法：/api/dev/login?phone=13900000001&to=/appointments
 */
export async function GET(req: Request) {
  const enabled = process.env.ENABLE_DEV_LOGIN === "true";

  if (!enabled) {
    return NextResponse.json({ code: 404, message: "Not Found", data: null }, { status: 404 });
  }

  const url = new URL(req.url);
  const phone = url.searchParams.get("phone") ?? "";
  const to = url.searchParams.get("to") ?? "/";

  const user = await prisma.user.findUnique({ where: { phone } });
  if (!user) return NextResponse.redirect(new URL("/login", url));

  const res = NextResponse.redirect(new URL(to, url));
  return attachAuthCookies(
    res,
    await signAccess({ sub: user.id, role: user.role as Role, name: user.name }),
    await signRefresh(user.id),
    isSecureRequest(req),
  );
}
