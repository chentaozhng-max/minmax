import { describe, expect, it } from "vitest";
import { createDraftToolRegistry } from "@/tools";
import type { DraftContext } from "@/tools/draft-context";
import type { ExperimentDraft } from "@/domain/experiment-draft";

const NOW = new Date("2026-11-03T10:00:00+08:00");
const ctx: DraftContext = { now: NOW, anchorDate: "2026-11-04" };
const toolCtx = { ctx, sink: {}, now: NOW };

const validArgs = {
  title: "面孔吸引力判断实验",
  description: "在实验室完成一段电脑任务，全程约 30 分钟，报酬当场结算。",
  location: "俊秀楼 305",
  durationMin: 30,
  rewardYuan: 30,
  type: "INDIVIDUAL",
  groupSize: null,
  requirements: "矫正视力正常",
  minCreditScore: 0,
  needsVerification: true,
  slotPlan: { weekdays: [3], startTime: "14:00", endTime: "17:00", weeks: 1, anchor: "TOMORROW" },
  notes: ["按 30 元/半小时估算报酬"],
};

describe("发布助手工具注册表", () => {
  it("只有写草稿一个工具，参数 schema 随注册表生成", () => {
    const registry = createDraftToolRegistry();
    expect(registry.names()).toEqual(["write_experiment_draft"]);

    const spec = registry.specs()[0];
    expect(spec.function.name).toBe("write_experiment_draft");
    const params = spec.function.parameters as {
      required?: string[];
      properties?: Record<string, unknown>;
    };
    // 标题、说明、时段计划是模型必须给的，不能靠运行时补
    expect(params.required).toContain("title");
    expect(params.required).toContain("description");
    expect(params.required).toContain("slotPlan");
    expect(params.properties?.slotPlan).toBeTruthy();
  });

  it("正常参数 → 归一化成带时段与容量的草稿", async () => {
    const result = await createDraftToolRegistry().exec("write_experiment_draft", validArgs, toolCtx);
    expect(result.ok).toBe(true);

    const draft = result.draft as ExperimentDraft;
    expect(draft.title).toBe("面孔吸引力判断实验");
    expect(draft.slots).toHaveLength(6);
    expect(draft.slots[0].capacity).toBe(1);
    expect((result.notes as string[])[0]).toContain("30 元");
  });

  it("参数不合法返回 ok:false，不抛异常打断对话", async () => {
    const result = await createDraftToolRegistry().exec(
      "write_experiment_draft",
      { title: "太短", durationMin: 9999 },
      toolCtx,
    );
    expect(result.ok).toBe(false);
    expect(String(result.error)).toContain("参数不合法");
  });

  it("不认识别的工具", async () => {
    const result = await createDraftToolRegistry().exec("book_slot", {}, toolCtx);
    expect(result.ok).toBe(false);
  });
});
