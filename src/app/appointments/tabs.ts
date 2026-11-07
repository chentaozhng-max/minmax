/**
 * 「我的预约」的分栏定义。
 *
 * 单独一个文件（而不是写在 `appointments-view.tsx` 里），是为了让**服务端页面**也能读：
 * `"use client"` 模块导出的普通函数不能在 RSC 里调用（跨边界拿到的是 client reference），
 * 所以「深链参数 → 分栏」的解析必须待在没有 `"use client"` 的模块里。
 */

export const APPOINTMENT_TABS = [
  // 「进行中」不是一种预约状态，是三个进行中分栏的聚合视角 ——
  // 加它是因为「我的」页那个「进行中」数字被点开时，
  // 落到「待确认」或「已确认」任何一栏都会漏掉另外两栏，与数字对不上。
  { key: "active", label: "进行中" },
  { key: "pending", label: "待确认" },
  { key: "confirmed", label: "已确认" },
  { key: "checkin", label: "待签到" },
  { key: "done", label: "已完成" },
  { key: "cancelled", label: "已取消" },
] as const;

export type AppointmentTab = (typeof APPOINTMENT_TABS)[number]["key"];

/** 「进行中」聚合的那三栏 */
export const ACTIVE_TAB_KEYS = ["pending", "confirmed", "checkin"] as const;

export function parseAppointmentsTab(value: string | string[] | undefined): AppointmentTab {
  const raw = Array.isArray(value) ? value[0] : value;
  return APPOINTMENT_TABS.find((t) => t.key === raw)?.key ?? "pending";
}
