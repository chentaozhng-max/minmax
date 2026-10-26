import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import type { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/http";
import type { Role } from "@/lib/domain";

const ACCESS_COOKIE = "pm_at";
const REFRESH_COOKIE = "pm_rt";
const ACCESS_TTL_SEC = 60 * 60 * 2; // 2h
const REFRESH_TTL_SEC = 60 * 60 * 24 * 30; // 30d

const accessSecret = new TextEncoder().encode(
  process.env.JWT_SECRET || "dev-only-change-me-access-secret-please",
);
const refreshSecret = new TextEncoder().encode(
  process.env.JWT_REFRESH_SECRET || "dev-only-change-me-refresh-secret-please",
);

export type SessionPayload = { sub: string; role: Role; name: string };

export async function signAccess(payload: SessionPayload) {
  return new SignJWT({ role: payload.role, name: payload.name })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TTL_SEC}s`)
    .sign(accessSecret);
}

export async function signRefresh(userId: string) {
  return new SignJWT({ typ: "refresh" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${REFRESH_TTL_SEC}s`)
    .sign(refreshSecret);
}

export async function verifyAccess(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, accessSecret);
    if (!payload.sub) return null;
    return {
      sub: payload.sub,
      role: payload.role as Role,
      name: (payload.name as string) ?? "",
    };
  } catch {
    return null;
  }
}

export async function verifyRefresh(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, refreshSecret);
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

export function attachAuthCookies(res: NextResponse, access: string, refresh: string) {
  const isProd = process.env.NODE_ENV === "production";
  res.cookies.set(ACCESS_COOKIE, access, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    path: "/",
    maxAge: ACCESS_TTL_SEC,
  });
  res.cookies.set(REFRESH_COOKIE, refresh, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    path: "/",
    maxAge: REFRESH_TTL_SEC,
  });
  return res;
}

export function clearAuthCookies(res: NextResponse) {
  res.cookies.set(ACCESS_COOKIE, "", { path: "/", maxAge: 0 });
  res.cookies.set(REFRESH_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}

/** 读取当前登录会话（服务端）。access 过期时用 refresh 静默续期。 */
export async function getSession(): Promise<SessionPayload | null> {
  const jar = await cookies();
  const access = jar.get(ACCESS_COOKIE)?.value;
  if (access) {
    const payload = await verifyAccess(access);
    if (payload) return payload;
  }
  const refresh = jar.get(REFRESH_COOKIE)?.value;
  if (!refresh) return null;
  const userId = await verifyRefresh(refresh);
  if (!userId) return null;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return null;
  return { sub: user.id, role: user.role as Role, name: user.name };
}

export async function currentUser() {
  const session = await getSession();
  if (!session) return null;
  return prisma.user.findUnique({ where: { id: session.sub } });
}

export type AuthedUser = NonNullable<Awaited<ReturnType<typeof currentUser>>>;

export async function requireUser(): Promise<AuthedUser> {
  const user = await currentUser();
  if (!user) throw new ApiError(401, "请先登录");
  return user;
}

export async function requireRole(role: Role | Role[]): Promise<AuthedUser> {
  const user = await requireUser();
  const roles = Array.isArray(role) ? role : [role];
  if (!roles.includes(user.role as Role)) throw new ApiError(403, "没有权限执行该操作");
  return user;
}

export const AUTH_COOKIES = { ACCESS_COOKIE, REFRESH_COOKIE };
