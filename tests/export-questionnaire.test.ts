import { describe, expect, it } from "vitest";
import type { QuestionRecord } from "@/domain/ports/questionnaire";
import {
  buildResponseCsv,
  RESPONSE_CSV_HEADER,
  responseCsvFilename,
  type ResponseCsvRow,
} from "@/application/export-questionnaire";

function question(over: Partial<QuestionRecord> & { id: string; title: string }): QuestionRecord {
  return {
    order: 1,
    round: 1,
    type: "SINGLE",
    required: true,
    options: [],
    scaleMin: null,
    scaleMax: null,
    ...over,
  };
}

function response(over: Partial<ResponseCsvRow> = {}): ResponseCsvRow {
  return {
    subjectName: "林知夏",
    subjectSchool: "华东师范大学",
    subjectStudentId: "10235501401",
    subjectVerified: true,
    answers: {},
    score: 82,
    passed: true,
    status: "SCORED",
    submittedAt: new Date("2026-11-05T02:30:00.000Z"),
    invitedAt: null,
    ...over,
  };
}

/** 去掉 BOM 后按 CRLF 切成行；空行不算 */
function rows(csv: string): string[] {
  return csv.replace(/^\uFEFF/, "").split("\r\n").filter((line) => line !== "");
}

const questions = [
  question({ id: "q1", order: 1, title: "你的年龄段是？" }),
  question({ id: "q2", order: 2, title: "你练习正念的主要方式有哪些？", type: "MULTI" }),
  question({ id: "q3", order: 3, title: "我能觉察到自己当下的情绪变化。", type: "SCALE" }),
];

describe("buildResponseCsv", () => {
  it("表头是固定列 + 每题一列，题目带题号", () => {
    const csv = buildResponseCsv({ experimentTitle: "测试", passScore: 60, questions, responses: [] });
    const [header] = rows(csv);
    const cells = header.split(",");

    expect(cells.slice(0, RESPONSE_CSV_HEADER.length)).toEqual([...RESPONSE_CSV_HEADER]);
    expect(cells[RESPONSE_CSV_HEADER.length]).toBe("Q1. 你的年龄段是？");
    expect(cells[RESPONSE_CSV_HEADER.length + 1]).toBe("Q2. 你练习正念的主要方式有哪些？");
  });

  it("一行一个被试，答案按题号落在对应列", () => {
    const csv = buildResponseCsv({
      experimentTitle: "测试",
      passScore: 60,
      questions,
      responses: [
        response({ answers: { q1: "18–25 岁", q2: ["呼吸觉察", "身体扫描"], q3: 5 } }),
      ],
    });
    const line = rows(csv)[1].split(",");

    expect(line[0]).toBe("1");
    expect(line[1]).toBe("林知夏");
    expect(line[2]).toBe("华东师范大学");
    expect(line[3]).toBe("10235501401");
    expect(line[4]).toBe("已认证");
    const answerStart = RESPONSE_CSV_HEADER.length;
    expect(line[answerStart]).toBe("18–25 岁");
    expect(line[answerStart + 1]).toBe("呼吸觉察、身体扫描");
    expect(line[answerStart + 2]).toBe("5");
  });

  it("没作答的题写「（未作答）」，不能留空 —— 留空在统计里会被当成缺失值", () => {
    const csv = buildResponseCsv({
      experimentTitle: "测试",
      passScore: null,
      questions,
      responses: [response({ answers: { q1: "18–25 岁" } })],
    });
    const line = rows(csv)[1].split(",");
    const answerStart = RESPONSE_CSV_HEADER.length;

    expect(line[answerStart]).toBe("18–25 岁");
    expect(line[answerStart + 1]).toBe("（未作答）");
    expect(line[answerStart + 2]).toBe("（未作答）");
  });

  it("三个通过状态：通过 / 未通过 / 未算分", () => {
    const csv = buildResponseCsv({
      experimentTitle: "测试",
      passScore: 60,
      questions,
      responses: [
        response({ subjectName: "甲", score: 90, passed: true }),
        response({ subjectName: "乙", score: 40, passed: false }),
        response({ subjectName: "丙", score: null, passed: null }),
      ],
    });
    const lines = rows(csv).slice(1);
    const passIndex = RESPONSE_CSV_HEADER.indexOf("是否通过");

    expect(lines[0].split(",")[passIndex]).toBe("通过");
    expect(lines[1].split(",")[passIndex]).toBe("未通过");
    expect(lines[2].split(",")[passIndex]).toBe("未算分");
  });

  it("人工判定优先于分数：passed=true 就是通过，哪怕分数低于线", () => {
    const csv = buildResponseCsv({
      experimentTitle: "测试",
      passScore: 60,
      questions,
      responses: [response({ score: 30, passed: true })],
    });
    const passIndex = RESPONSE_CSV_HEADER.indexOf("是否通过");
    expect(rows(csv)[1].split(",")[passIndex]).toBe("通过");
  });

  it("有分但没设分数线：写「未设分数线」，不冒充通过", () => {
    const csv = buildResponseCsv({
      experimentTitle: "测试",
      passScore: null,
      questions,
      responses: [response({ score: 88, passed: null })],
    });
    const passIndex = RESPONSE_CSV_HEADER.indexOf("是否通过");
    expect(rows(csv)[1].split(",")[passIndex]).toBe("未设分数线");
  });

  it("文本题里有逗号和换行时按 RFC 4180 包起来", () => {
    const csv = buildResponseCsv({
      experimentTitle: "测试",
      passScore: null,
      questions: [question({ id: "q1", title: "想补充点什么？" })],
      responses: [response({ answers: { q1: "第一行，有逗号\n第二行" } })],
    });

    expect(csv).toContain('"第一行，有逗号\n第二行"');
  });

  it("开头有 BOM、行尾是 CRLF —— Excel 双击才不乱码不串行", () => {
    const csv = buildResponseCsv({ experimentTitle: "测试", passScore: 60, questions, responses: [response()] });

    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv).not.toMatch(/[^\r]\n/);
  });

  it("状态与通知时间：已通知的填时间，没通知的留空", () => {
    const csv = buildResponseCsv({
      experimentTitle: "测试",
      passScore: 60,
      questions,
      responses: [
        response({ status: "SUBMITTED", score: null, passed: null, invitedAt: null }),
        response({
          subjectName: "乙",
          status: "INVITED",
          invitedAt: new Date("2026-11-05T06:00:00.000Z"),
        }),
      ],
    });
    const lines = rows(csv).slice(1);
    const statusIndex = RESPONSE_CSV_HEADER.indexOf("状态");
    const invitedIndex = RESPONSE_CSV_HEADER.indexOf("通知时间");

    expect(lines[0].split(",")[statusIndex]).toBe("待算分");
    expect(lines[1].split(",")[statusIndex]).toBe("已通知");
    expect(lines[1].split(",")[invitedIndex]).toBe("2026-11-05 14:00");
  });
});

describe("responseCsvFilename", () => {
  it("带实验名与日期，Windows 非法字符被替换", () => {
    const name = responseCsvFilename("正念/情绪:测试", new Date("2026-11-05T10:00:00.000Z"));
    expect(name).toBe("答卷-正念_情绪_测试-20261105.csv");
  });

  it("没有实验名时用「问卷」兜底", () => {
    expect(responseCsvFilename(null, new Date("2026-11-05T10:00:00.000Z"))).toBe("答卷-问卷-20261105.csv");
  });
});
