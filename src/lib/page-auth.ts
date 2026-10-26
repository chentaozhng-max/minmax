import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import type { Role } from "@/lib/domain";

/** 页面级登录校验（服务端）。角色不符时送回各自首页，不显示 404。 */
export async function requirePage(role?: Role | Role[]) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (role) {
    const roles = Array.isArray(role) ? role : [role];
    if (!roles.includes(session.role)) {
      redirect(session.role === "RESEARCHER" ? "/r/experiments" : "/");
    }
  }
  return session;
}

export async function redirectIfLoggedIn() {
  const session = await getSession();
  if (!session) return;
  redirect(session.role === "RESEARCHER" ? "/r/experiments" : "/");
}
