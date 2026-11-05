import { describe, expect, it } from "vitest";
import { formatDurableFacts } from "@/application/session-facts";
import type { AssistantAppointment, PastExperiment } from "@/domain/ports/assistant-query";

/**
 * 持久事实 → 提示词。
 *
 * 这里守的是「模型的错误多半来自提示词里的数据写错了」。所以断言具体文本，
 * 而不是「包含某个关键词」—— 后者在文案改坏时经常照样绿。
 */

function upcoming(overrides: Partial<AssistantAppointment> = {}): AssistantAppointment {
  return {
    id: "a1",
    status: "CONFIRMED",
    experimentId: "e1",
    experimentTitle: "面孔识别实验",
    location: "心理学楼 302",
    researcherName: "张老师",
    startAt: new Date("2026-11-07T06:00:00.000Z"), // 上海 14:00
    endAt: new Date("2026-11-07T06:30:00.000Z"),
    ...overrides,
  };
}

function past(overrides: Partial<PastExperiment> = {}): PastExperiment {
  return {
    appointmentId: "a0",
    experimentId: "e0",
    experimentTitle: "记忆广度实验",
    finishedAt: new Date("2026-10-01T06:30:00.000Z"),
    status: "COMPLETED",
    ...overrides,
  };
}

describe("formatDurableFacts", () => {
  it("★ 都没有 → 两句明确的「没有」，不留空白", () => {
    const text = formatDurableFacts({ past: [], upcoming: [] });
    expect(text).toContain("当前没有进行中的实验。");
    expect(text).toContain("还没有完成过的实验。");
  });

  it("★ 落款声明「系统查到的，不是他刚说的」（防模型当成新条件）", () => {
    const text = formatDurableFacts({ past: [], upcoming: [] });
    expect(text).toContain("系统实时查到的，不是他刚说的");
  });

  it("进行中的实验带标题 + 时间 + 地点", () => {
    const text = formatDurableFacts({ past: [], upcoming: [upcoming()] });
    expect(text).toContain("进行中的实验 1 场");
    expect(text).toContain("面孔识别实验");
    expect(text).toContain("11月7日 14:00");
    expect(text).toContain("心理学楼 302");
  });

  it("完成过的实验带标题 + 完成时间", () => {
    const text = formatDurableFacts({ past: [past()], upcoming: [] });
    expect(text).toContain("完成过的实验 1 场");
    expect(text).toContain("记忆广度实验");
    expect(text).toContain("10月1日 14:30");
  });

  it("★ 超过 5 条只列 5 条 + 一句「还有 N 场未列出」", () => {
    const many = Array.from({ length: 8 }, (_, i) => past({ appointmentId: `a${i}`, experimentTitle: `实验${i}` }));
    const text = formatDurableFacts({ past: many, upcoming: [] });

    expect(text).toContain("完成过的实验 8 场");
    expect(text).toContain("实验0");
    expect(text).toContain("实验4");
    expect(text).not.toContain("实验5");
    expect(text).toContain("还有 3 场未列出");
  });

  it("★ 明确要求「已约的不要再推荐」（exclude 的语义来源）", () => {
    const text = formatDurableFacts({ past: [], upcoming: [upcoming()] });
    expect(text).toContain("进行中的实验不要再推荐");
  });

  it("★ 明确要求「不要原样念一遍」", () => {
    const text = formatDurableFacts({ past: [past()], upcoming: [upcoming()] });
    expect(text).toContain("不要把这些事实原样念一遍");
  });
});
