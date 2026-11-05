/**
 * 答卷导出 —— 应用层。
 *
 * 主试收上来一堆线上答卷，最终是要进 SPSS / Excel 做分析的。
 * 页面上「一份份点开看」解决不了这个需求，所以导出必须是
 * 「一行一个被试、一列一道题」的宽表 —— 统计软件认的就是这个形状。
 *
 * 两个刻意的选择：
 *   1. 只给学号，不给手机号。问卷对被试承诺了匿名，联系方式不该随数据外流；
 *      学号是为了学分登记，和日程表导出同一口径。
 *   2. 列名带题号（Q1. 题干），题干截断到 40 字 —— 太长会把表头撑爆，
 *      带题号才能和原问卷对上。
 */

import type { AnswerMap } from "@/domain/questionnaire";
import { formatAnswer, passState } from "@/domain/questionnaire";
import type { QuestionRecord } from "@/domain/ports/questionnaire";
import { CSV_BOM, CSV_EOL, csvCell, csvDateTime, csvStamp, safeFilenamePart } from "./csv-format";

export type ResponseCsvRow = {
  subjectName: string;
  subjectSchool: string | null;
  subjectStudentId: string | null;
  subjectVerified: boolean;
  answers: AnswerMap;
  score: number | null;
  passed: boolean | null;
  status: string;
  submittedAt: Date;
  invitedAt: Date | null;
};

export type ResponseCsvInput = {
  experimentTitle: string;
  passScore: number | null;
  questions: QuestionRecord[];
  responses: ResponseCsvRow[];
};

const STATUS_LABEL: Record<string, string> = {
  SUBMITTED: "待算分",
  SCORED: "已算分",
  INVITED: "已通知",
};

export const RESPONSE_CSV_HEADER = [
  "编号",
  "姓名",
  "学校",
  "学号",
  "学生认证",
  "提交时间",
  "分数",
  "是否通过",
  "状态",
  "通知时间",
] as const;

/** 列名：Q1. 题干。题号保证能和原问卷对上，截断避免把表头撑着走 */
function questionHeader(question: QuestionRecord, index: number): string {
  return `Q${index + 1}. ${question.title.replace(/\s+/g, " ").trim().slice(0, 40)}`;
}

/** 与答卷后台同一口径：先看人工判定，再退回「分数 vs 分数线」 */
function passLabel(row: ResponseCsvRow, passScore: number | null): string {
  if (row.passed === true) return "通过";
  if (row.passed === false) return "未通过";
  const state = passState(row.score, passScore);
  if (state === "PASS") return "通过";
  if (state === "FAIL") return "未通过";
  return row.score === null ? "未算分" : "未设分数线";
}

export function buildResponseCsv(input: ResponseCsvInput): string {
  const { questions, responses, passScore } = input;

  const header = [...RESPONSE_CSV_HEADER, ...questions.map(questionHeader)];
  const lines: string[] = [header.map(csvCell).join(",")];

  responses.forEach((row, index) => {
    lines.push(
      [
        csvCell(index + 1),
        csvCell(row.subjectName),
        csvCell(row.subjectSchool),
        csvCell(row.subjectStudentId),
        csvCell(row.subjectVerified ? "已认证" : "未认证"),
        csvCell(csvDateTime(row.submittedAt)),
        csvCell(row.score),
        csvCell(passLabel(row, passScore)),
        csvCell(STATUS_LABEL[row.status] ?? row.status),
        csvCell(row.invitedAt ? csvDateTime(row.invitedAt) : null),
        ...questions.map((question) => csvCell(formatAnswer(question, row.answers[question.id]))),
      ].join(","),
    );
  });

  return CSV_BOM + lines.join(CSV_EOL) + CSV_EOL;
}

/** 文件名带实验名与日期，导到本地一眼能认出来 */
export function responseCsvFilename(experimentTitle: string | null, now: Date = new Date()): string {
  return `答卷-${safeFilenamePart(experimentTitle, "问卷")}-${csvStamp(now)}.csv`;
}
