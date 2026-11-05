/**
 * 日程导出 —— 应用层。
 *
 * 这是「同一份数据、两种消费者」的第二条腿：
 *   消费者 A：主试日程页（渲染成表）
 *   消费者 B：CSV 导出（主试拿去实验室点名）
 * 两者都读 ScheduleQuery.listSchedule()，不各写一份查询。
 *
 * BOM / 转义 / CRLF 这些格式细节在 csv-format.ts，答卷导出共用同一套。
 */

import type { ScheduleRow } from "@/domain/ports/schedule";
import { appointmentStatusLabel, type AppointmentStatus } from "@/domain/constants";
import { formatDayCN, formatHM } from "@/lib/time";
import { CSV_BOM, CSV_EOL, csvCell, csvDateTime, csvStamp, safeFilenamePart } from "./csv-format";

// 老引用（tests/schedule-export.test.ts）还从这儿拿，别删
export { csvCell, csvDateTime };

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
  return CSV_BOM + lines.join(CSV_EOL) + CSV_EOL;
}

/**
 * 文件名。带实验名与日期，导到本地一眼能认出来。
 * 去掉 Windows 文件名非法字符，否则下载会失败。
 */
export function scheduleCsvFilename(experimentTitle: string | null, now: Date = new Date()): string {
  return `日程表-${safeFilenamePart(experimentTitle, "全部实验")}-${csvStamp(now)}.csv`;
}
