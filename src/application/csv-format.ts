/**
 * CSV 的公共格式细节 —— 日程表与答卷两份导出共用。
 *
 * 三处细节都是为了「Excel 双击能直接打开、不乱码、不串列」：
 *   1. 开头加 UTF-8 BOM —— 没有 BOM 的 UTF-8 CSV 在中文 Windows 上会变乱码
 *   2. 字段里含逗号/引号/换行时用双引号包起来，内部引号翻倍（RFC 4180）
 *   3. 用 CRLF 行尾 —— Excel 对 LF 的兼容性不如 CRLF
 */

import { toShanghai } from "@/lib/time";

export const CSV_BOM = "\uFEFF";
export const CSV_EOL = "\r\n";

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
 * CSV 专用时间格式：带年份。
 * 页面上的 formatDateTimeCN 不带年（同一年内看足够），但导出件会被存档、
 * 会和往年的表混在一起 —— 没有年份就分不清是哪一年。
 */
export function csvDateTime(date: Date): string {
  const p = toShanghai(date);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`;
}

/** 文件名里的时间戳：20261105 */
export function csvStamp(date: Date): string {
  return csvDateTime(date).replace(/[-: ]/g, "").slice(0, 8);
}

/** 去掉 Windows 文件名非法字符，否则下载会失败 */
export function safeFilenamePart(text: string | null, fallback: string): string {
  return (text ?? fallback).replace(/[\\/:*?"<>|]/g, "_").slice(0, 40);
}
