import { describe, expect, it } from "vitest";
import type { LlmMessage, LlmPort, LlmReply, LlmToolSpec } from "@/domain/ports/llm";
import type { ReminderCandidate } from "@/domain/ports/notification-repo";
import { ReminderLevel } from "@/domain/reminder-levels";
import { composeReminder } from "@/application/send-reminders";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const NOW = new Date("2026-11-10T09:00:00+08:00");

function candidate(startAt: Date): ReminderCandidate {
  return {
    appointmentId: "a1",
    experimentId: "e1",
    subjectId: "s1",
    startAt,
    endAt: new Date(startAt.getTime() + 60 * MINUTE),
    experimentTitle: "面孔识别实验",
    location: "心理学楼 302",
    researcherName: "王老师",
  };
}

function makeLlm(behavior: { configured?: boolean; reply?: string; throws?: boolean }) {
  const calls: LlmMessage[][] = [];
  const llm: LlmPort = {
    configured: () => behavior.configured ?? true,
    async chat(params: { messages: LlmMessage[]; tools: LlmToolSpec[] }): Promise<LlmReply> {
      calls.push(params.messages);
      if (behavior.throws) throw new Error("模型超时");
      return { content: behavior.reply ?? "提醒你一下，别忘了周三的实验。", toolCalls: [] };
    },
  };
  return { llm, calls };
}

const promptOf = (calls: LlmMessage[][]) => calls[0].map((m) => m.content).join("\n");

describe("composeReminder 降级路径", () => {
  it("LLM 未配置 → 用模板，不发请求，且仍然产出文案", async () => {
    const { llm, calls } = makeLlm({ configured: false });

    const result = await composeReminder(llm, candidate(new Date(NOW.getTime() + 3 * HOUR)), ReminderLevel.H3, NOW);

    expect(result.usedFallback).toBe(true);
    expect(result.content).toContain("面孔识别实验");
    expect(calls).toHaveLength(0);
  });

  it("LLM 抛错 → 用模板兜底，不丢通知", async () => {
    const { llm } = makeLlm({ throws: true });

    const result = await composeReminder(llm, candidate(new Date(NOW.getTime() + HOUR)), ReminderLevel.H1, NOW);

    expect(result.usedFallback).toBe(true);
    expect(result.content).toContain("心理学楼 302");
  });

  it("LLM 返回空串 → 也走模板（模型偶尔会这么干）", async () => {
    const { llm } = makeLlm({ reply: "   " });

    const result = await composeReminder(llm, candidate(new Date(NOW.getTime() + HOUR)), ReminderLevel.H1, NOW);

    expect(result.usedFallback).toBe(true);
    expect(result.content.length).toBeGreaterThan(10);
  });

  it("LLM 正常 → 用模型文案，不用模板", async () => {
    const { llm } = makeLlm({ reply: "一小时后见，心理学楼 302。" });

    const result = await composeReminder(llm, candidate(new Date(NOW.getTime() + HOUR)), ReminderLevel.H1, NOW);

    expect(result.usedFallback).toBe(false);
    expect(result.content).toBe("一小时后见，心理学楼 302。");
  });
});

describe("composeReminder 提示词", () => {
  it("10 分钟档要求说签到", async () => {
    const { llm, calls } = makeLlm({});
    await composeReminder(llm, candidate(new Date(NOW.getTime() + 10 * MINUTE)), ReminderLevel.M10, NOW);
    expect(promptOf(calls)).toContain("签到");
  });

  it("提示词里带真实实验事实（给模型的事实源只有这些）", async () => {
    const { llm, calls } = makeLlm({});
    await composeReminder(llm, candidate(new Date(NOW.getTime() + 3 * HOUR)), ReminderLevel.H3, NOW);
    const prompt = promptOf(calls);
    expect(prompt).toContain("面孔识别实验");
    expect(prompt).toContain("心理学楼 302");
    expect(prompt).toContain("王老师");
  });

  it("还剩多少分钟按拨表时刻算，不是硬编码档位标签", async () => {
    const { llm, calls } = makeLlm({});
    // 距开场 137 分钟：落在 H3 窗口里，但真实剩余是 137 而不是 180
    await composeReminder(llm, candidate(new Date(NOW.getTime() + 137 * MINUTE)), ReminderLevel.H3, NOW);
    expect(promptOf(calls)).toContain("137");
  });
});
