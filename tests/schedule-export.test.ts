import { describe, expect, it } from "vitest";
import type { ScheduleRow } from "@/domain/ports/schedule";
import {
  buildScheduleCsv,
  csvCell,
  scheduleCsvFilename,
  SCHEDULE_CSV_HEADER,
} from "@/application/export-schedule";

const SLOT_START = new Date("2026-11-04T06:00:00.000Z"); // 上海 14:00
const SLOT_END = new Date("2026-11-04T06:30:00.000Z");

function row(overrides: Partial<ScheduleRow> = {}): ScheduleRow {
  return {
    experimentId: "e1",
    experimentTitle: "面孔识别实验",
    slotId: "s1",
    startAt: SLOT_START,
    endAt: SLOT_END,
    capacity: 3,
    bookedCount: 1,
    groupSize: 3,
    appointmentId: "a1",
    appointmentStatus: "CONFIRMED",
    checkedInAt: null,
    appealStatus: null,
    subject: {
      id: "u1",
      name: "张三",
      phone: "13800000000",
      school: "示范大学",
      studentId: "2023001",
      creditScore: 98,
      studentVerified: true,
    },
    ...overrides,
  };
}

describe("csvCell", () => {
  it("普通文本原样输出", () => {
    expect(csvCell("张三")).toBe("张三");
    expect(csvCell(42)).toBe("42");
  });

  it("null / undefined / 空串都输出空字符串", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell("")).toBe("");
  });

  it("含逗号 → 加引号（否则会串列）", () => {
    expect(csvCell("心理学楼,302")).toBe('"心理学楼,302"');
  });

  it("含双引号 → 加引号并把内部引号翻倍（RFC 4180）", () => {
    expect(csvCell('他说"好"')).toBe('"他说""好"""');
  });

  it("含换行 → 加引号", () => {
    expect(csvCell("第一行\n第二行")).toBe('"第一行\n第二行"');
  });

  it("首尾空格 → 加引号（否则会被 Excel 吃掉）", () => {
    expect(csvCell(" 张三 ")).toBe('" 张三 "');
  });
});

describe("buildScheduleCsv", () => {
  it("以 BOM 开头，Excel 打开中文不乱码", () => {
    expect(buildScheduleCsv([row()])).toMatch(/^\uFEFF/);
  });

  it("用 CRLF 行尾", () => {
    const csv = buildScheduleCsv([row()]);
    expect(csv).toContain("\r\n");
    expect(csv.split("\r\n").length).toBeGreaterThanOrEqual(3);
  });

  it("第一行是表头，列数与数据行一致", () => {
    const lines = buildScheduleCsv([row()]).replace(/^\uFEFF/, "").split("\r\n");
    expect(lines[0].split(",")).toHaveLength(SCHEDULE_CSV_HEADER.length);
    expect(lines[1].split(",")).toHaveLength(SCHEDULE_CSV_HEADER.length);
  });

  it("有人报名的行带上被试信息", () => {
    const csv = buildScheduleCsv([row()]);
    expect(csv).toContain("张三");
    expect(csv).toContain("13800000000");
    expect(csv).toContain("已认证");
    expect(csv).toContain("已确认");
  });

  it("空时段也保留一行，姓名留空、状态写「空位」", () => {
    const empty = row({
      appointmentId: null,
      appointmentStatus: null,
      bookedCount: 0,
      subject: null,
    });
    const csv = buildScheduleCsv([empty]);
    expect(csv).toContain("空位");
    expect(csv).not.toContain("张三");
  });

  it("导出时间带年份（页面上的不带年，导出件会被存档）", () => {
    const csv = buildScheduleCsv([row()]);
    expect(csv).toContain("2026-11-04 14:00");
  });

  it("没有数据时只有表头，仍然是合法 CSV", () => {
    const lines = buildScheduleCsv([]).replace(/^\uFEFF/, "").split("\r\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("时段");
  });
});

describe("scheduleCsvFilename", () => {
  it("带实验名与日期", () => {
    const name = scheduleCsvFilename("面孔识别实验", new Date("2026-11-02T10:00:00+08:00"));
    expect(name).toBe("日程表-面孔识别实验-20261102.csv");
  });

  it("去掉 Windows 文件名非法字符，否则下载会失败", () => {
    const name = scheduleCsvFilename('A/B:C*D?E"F<G>H|I', new Date("2026-11-02T10:00:00+08:00"));
    expect(name).not.toMatch(/[\\/:*?"<>|]/);
    expect(name).toContain("A_B_C_D_E_F_G_H_I");
  });

  it("实验名为 null 时用「全部实验」（总表导出）", () => {
    expect(scheduleCsvFilename(null, new Date("2026-11-02T10:00:00+08:00"))).toContain("全部实验");
  });
});
