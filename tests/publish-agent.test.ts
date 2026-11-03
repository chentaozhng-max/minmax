import { afterEach, describe, expect, it } from "vitest";
import { generatePublishDraft } from "@/server/publish-agent";
import { resetLlmCache } from "@/adapters/llm";

const NOW = new Date("2026-11-03T10:00:00+08:00");
const ENV_KEYS = ["LLM_PROVIDER", "LLM_API_KEY", "LLM_MOCK_SCRIPT", "LLM_BASE_URL", "LLM_MODEL"];
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  resetLlmCache();
});

function useMock(script: unknown[]) {
  process.env.LLM_PROVIDER = "mock";
  process.env.LLM_MOCK_SCRIPT = JSON.stringify(script);
  resetLlmCache();
}

const draftArgs = {
  title: "情绪面孔的注意偏向",
  description:
    "你需要在电脑上完成一轮点探测任务：先看两张情绪面孔，再对探测点位置按键。全程约 30 分钟，报酬当场结算。",
  location: "俊秀楼 412",
  durationMin: 30,
  rewardYuan: 40,
  type: "INDIVIDUAL",
  groupSize: null,
  requirements: "矫正视力正常",
  minCreditScore: 0,
  needsVerification: true,
  slotPlan: { weekdays: [3], startTime: "14:00", endTime: "17:00", weeks: 1, anchor: "NEXT_WEEK" },
  notes: ["报酬按你说的 40 元填写"],
};

describe("generatePublishDraft —— 模型只写草稿，不建实验", () => {
  it("没配模型时走规则版，字段仍然是全的", async () => {
    process.env.LLM_PROVIDER = "openai-compatible";
    process.env.LLM_API_KEY = "";
    resetLlmCache();

    const result = await generatePublishDraft({
      brief: "面孔吸引力判断实验，30分钟，报酬30元，下周三下午",
      now: NOW,
    });

    expect(result.mode).toBe("fallback");
    expect(result.notice).toBeTruthy();
    expect(result.draft.durationMin).toBe(30);
    expect(result.draft.slots.length).toBeGreaterThan(0);
    expect(result.issues.some((i) => i.field === "location")).toBe(true);
  });

  it("模型调 write_experiment_draft → 草稿经领域层归一化", async () => {
    useMock([
      {
        content: "写好了，重点核对地点和时段。",
        toolCalls: [{ id: "call_1", name: "write_experiment_draft", args: draftArgs }],
      },
    ]);

    const result = await generatePublishDraft({
      brief: "情绪面孔的注意偏向，30分钟，40元，下周三下午",
      now: NOW,
    });

    expect(result.mode).toBe("llm");
    expect(result.reply).toContain("写好了");
    expect(result.draft.title).toBe("情绪面孔的注意偏向");
    expect(result.draft.rewardYuan).toBe(40);
    // NEXT_WEEK + 周三 → 下周三，一共 6 段
    expect(result.draft.slots).toHaveLength(6);
    expect(result.assumptions[0]).toContain("40 元");
    expect(result.issues.filter((i) => i.level === "block")).toEqual([]);
  });

  it("模型把 JSON 写在正文里也能救回来", async () => {
    useMock([{ content: "```json\n" + JSON.stringify(draftArgs) + "\n```" }]);

    const result = await generatePublishDraft({
      brief: "情绪面孔的注意偏向",
      now: NOW,
    });

    expect(result.mode).toBe("llm");
    expect(result.draft.title).toBe("情绪面孔的注意偏向");
  });

  it("模型没给结构化草稿时降级，而不是把错误抛给主试", async () => {
    useMock([{ content: "我觉得这个实验挺好的，你想招多少人？" }]);

    const result = await generatePublishDraft({
      brief: "一个记忆实验",
      now: NOW,
    });

    expect(result.mode).toBe("fallback");
    expect(result.draft.title.length).toBeGreaterThan(0);
    expect(result.notice).toContain("规则");
  });
});
