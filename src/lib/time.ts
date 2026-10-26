/** 时间统一以 UTC 存储，展示一律 Asia/Shanghai（UTC+8）。 */
const TZ_OFFSET_MS = 8 * 60 * 60 * 1000;
export const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;

/** 把 UTC 时间转成上海时区的"墙上时间"字段 */
function shanghaiParts(date: Date) {
  const shifted = new Date(date.getTime() + TZ_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    weekday: shifted.getUTCDay(), // 0=周日
  };
}

export function toShanghai(date: Date) {
  return shanghaiParts(date);
}

/** 例：10月31日 周五 */
export function formatDayCN(date: Date) {
  const p = shanghaiParts(date);
  const wd = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][p.weekday];
  return `${p.month}月${p.day}日 ${wd}`;
}

/** 例：10-31 */
export function formatDayKey(date: Date) {
  const p = shanghaiParts(date);
  return `${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** 例：10-31 周五（紧凑，用于列表里的副信息） */
export function formatShortDayCN(date: Date) {
  const p = shanghaiParts(date);
  const wd = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][p.weekday];
  return `${formatDayKey(date)} ${wd}`;
}

/** 例：14:30 */
export function formatHM(date: Date) {
  const p = shanghaiParts(date);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/** 例：10月31日 周五 14:30-15:00 */
export function formatSlotRange(start: Date, end: Date) {
  return `${formatDayCN(start)} ${formatHM(start)}-${formatHM(end)}`;
}

/** 例：2 小时 15 分 后 */
export function formatCountdown(ms: number) {
  if (ms <= 0) return "已到期";
  const totalMin = Math.floor(ms / 60000);
  const d = Math.floor(totalMin / (60 * 24));
  const h = Math.floor((totalMin % (60 * 24)) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${d} 天 ${h} 小时`;
  if (h > 0) return `${h} 小时 ${m} 分`;
  return `${m} 分钟`;
}

/** 例：还剩 3 天 02:15 */
export function formatCountdownClock(ms: number) {
  if (ms <= 0) return "00:00:00";
  const totalSec = Math.floor(ms / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const clock = [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
  return d > 0 ? `${d} 天 ${clock}` : clock;
}

export function formatDateTimeCN(date: Date) {
  const p = shanghaiParts(date);
  return `${p.month}月${p.day}日 ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/** 上海时区某一天的 00:00 对应的 UTC 时刻 */
export function startOfShanghaiDay(date: Date) {
  const p = shanghaiParts(date);
  return new Date(Date.UTC(p.year, p.month - 1, p.day, 0, 0, 0) - TZ_OFFSET_MS);
}

export function hoursBetween(a: Date, b: Date) {
  return (b.getTime() - a.getTime()) / HOUR;
}

/** 供 LLM 阅读的时间串 */
export function formatForPrompt(date: Date) {
  const p = shanghaiParts(date);
  const wd = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][p.weekday];
  return `${p.month}月${p.day}日(${wd}) ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/** "2026-10-28" + "14:00" → 上海时区对应的 UTC ISO */
export function toShanghaiIso(date: string, time: string) {
  return new Date(`${date}T${time}:00+08:00`).toISOString();
}

/** 上海时区的今天，YYYY-MM-DD */
export function todayInShanghai() {
  return new Date(Date.now() + TZ_OFFSET_MS).toISOString().slice(0, 10);
}

/** 在 YYYY-MM-DD 上加天数 */
export function addDaysToDateStr(dateStr: string, days: number) {
  const base = new Date(`${dateStr}T00:00:00+08:00`);
  return new Date(base.getTime() + days * DAY).toISOString().slice(0, 10);
}
