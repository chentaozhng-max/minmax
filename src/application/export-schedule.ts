/**
 * 日程导出 —— 应用层。
 *
 * 这是「同一份数据、两种消费者」的第二条腿：
 *   消费者 A：主试日程页（渲染成表）
 *   消费者 B：CSV 导出（主试拿去实验室点名）
 * 两者都读 ScheduleQuery.listSchedule()，不各写一份查询。
 *
 * CSV 的三处细节都是为了「Excel 双击能直接打开、不乱码、不串列」：
 *   1. 开头加 UTF-8 BOM —— 没有 BOM 的 UTF-8 CSV 在中文 Windows 上会变乱码
 *   2. 字段里含逗号/引号/换行时用双引号包起来，内部引号翻倍（RFC 4180）
 *   3. 用 CRLF 行尾 —— Excel 对 LF 的兼容性不如 CRLF
 */

import type { ScheduleRow } from "@/domain/ports/schedule";
import { appointmentStatusLabel, type AppointmentStatus } from "@/domain/constants";
import { formatDayCN, formatHM, toShanghai } from "@/lib/time";

const BOM = "\uFEFF";
const EOL = "\r\n";

/**
 * CSV 专用时间格式：带年份。
 * 页面上的 formatDateTimeCN 不带年（同一年内看足够），但导出件会被存档、
 * 会和往年的表混在一起 —— 没有年份就分不清是哪一年。
 */
function csvDateTime(date: Date): string {
  const p = toShanghai(date);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`;
}

export const SCHEDULE_CSV_HEADER = [
  "时段",
  "开始时间",
  "结束时间",
  "容量",
  "已报",
  "姓名",
  "手机号",
  "学校",
  "学号",
  "信誉分",
  "学生认证",
  "预约状态",
  "签到时间",
  "申诉",
] as const;

/** RFC 4180：含逗号 / 引号 / 换行 / 首尾空格时加引号，内部引号翻倍 */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (text === "") return "";
  if (/[",\r\n]/.test(text) || /^\s|\s$/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/**
 * 把日程行转成 CSV 文本。
 *
 * 空时段（没人报名）也保留一行，姓名等列留空 —— 主试要看到「这格是空的」，
 * 而不是「这格不存在」。这正是以 Slot 为基表的意义。
 */
export function buildScheduleCsv(rows: ScheduleRow[], now: Date = new Date()): string {
  const lines: string[] = [SCHEDULE_CSV_HEADER.map(csvCell).join(",")];

  for (const row of rows) {
    const slotLabel = `${formatDayCN(row.startAt)} ${formatHM(row.startAt)}-${formatHM(row.endAt)}`;
    const subject = row.subject;

    lines.push(
      [
        csvCell(slotLabel),
        csvCell(csvDateTime(row.startAt)),
        csvCell(csvDateTime(row.endAt)),
        csvCell(row.capacity),
        csvCell(row.bookedCount),
        csvCell(subject?.name),
        csvCell(subject?.phone),
        csvCell(subject?.school),
        csvCell(subject?.studentId),
        csvCell(subject?.creditScore),
        csvCell(subject ? (subject.studentVerified ? "已认证" : "未认证") : null),
        csvCell(row.appointmentStatus ? appointmentStatusLabel[row.appointmentStatus as AppointmentStatus] ?? row.appointmentStatus : "空位"),
        csvCell(row.checkedInAt ? csvDateTime(row.checkedInAt) : null),
        csvCell(row.appealStatus),
      ].join(","),
    );
  }

  void now; // 保留参数：将来可能要按 now 区分「已过期/未开始」
  return BOM + lines.join(EOL) + EOL;
}

/**
 * 文件名。带实验名与日期，导到本地一眼能认出来。
 * 去掉 Windows 文件名非法字符，否则下载会失败。
 */
export function scheduleCsvFilename(experimentTitle: string | null, now: Date = new Date()): string {
  const safeTitle = (experimentTitle ?? "全部实验").replace(/[\\/:*?"<>|]/g, "_").slice(0, 40);
  const stamp = csvDateTime(now).replace(/[-: ]/g, "").slice(0, 8);
  return `日程表-${safeTitle}-${stamp}.csv`;
}
