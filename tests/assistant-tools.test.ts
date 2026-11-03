import { describe, expect, it } from "vitest";
import { createAssistantToolRegistry, createToolRegistry } from "@/tools";
import type { AssistantContext, AssistantSearchPayload } from "@/tools/assistant-context";

/**
 * 两个注册表的能力边界测试。
 *
 * 这里真正要守住的是**一件事**：搜索场景下模型看不到也调不了排期/预约工具。
 * 「靠提示词劝模型别乱约」是不可靠的；靠注册表划边界才是编译期和运行期都成立的。
 */

const ctx: AssistantContext = {
  subject: {
    id: "sub_1",
    creditScore: 100,
    studentVerified: true,
    bannedUntil: null,
  },
  now: new Date("2026-11-04T08:00:00+08:00"),
  search: async () => emptyPayload,
};

const emptyPayload: AssistantSearchPayload = {
  summary: "没找到",
  experiments: [],
  totalEligible: 0,
  excluded: [],
  excludedCount: 0,
};

describe("createAssistantToolRegistry", () => {
  it("只有 search_experiments 一个工具", () => {
    const reg = createAssistantToolRegistry();
    expect(reg.names()).toEqual(["search_experiments"]);
  });

  it("⚠️ 看不到任何排期/预约工具", () => {
    const reg = createAssistantToolRegistry();
    for (const name of ["get_available_slots", "book_slot", "propose_slots", "join_waitlist"]) {
      expect(reg.has(name)).toBe(false);
    }
  });

  it("生成的 spec 是合法 function 形状", () => {
    const [spec] = createAssistantToolRegistry().specs();
    expect(spec.type).toBe("function");
    expect(spec.function.name).toBe("search_experiments");
    expect(spec.function.parameters).toHaveProperty("type", "object");
    // 条件字段要出现在给模型的 schema 里，否则模型不知道能传什么
    const props = (spec.function.parameters as any).properties;
    expect(Object.keys(props)).toEqual(
      expect.arrayContaining(["keyword", "weekday", "timeOfDay", "maxDurationMin", "sortBy"]),
    );
  });
});

describe("老注册表不受影响", () => {
  it("仍然是原来的 7 个，一个不多一个不少", () => {
    expect(createToolRegistry().names()).toEqual([
      "get_available_slots",
      "get_my_busy_slots",
      "get_my_credit_status",
      "propose_slots",
      "book_slot",
      "join_waitlist",
      "escalate_to_researcher",
    ]);
  });

  it("老注册表里没有 search_experiments（能力按场景分开）", () => {
    expect(createToolRegistry().has("search_experiments")).toBe(false);
  });
});

describe("search_experiments 执行", () => {
  it("把模型的原始条件透传给 search（不在工具层做归一）", async () => {
    const seen: unknown[] = [];
    const reg = createAssistantToolRegistry();
    await reg.exec(
      "search_experiments",
      { weekday: "周三", timeOfDay: "下午", maxDurationMin: 60 },
      {
        ctx: { ...ctx, search: async (c) => (seen.push(c), emptyPayload) },
        sink: {},
        now: ctx.now,
      },
    );

    expect(seen[0]).toEqual({ weekday: "周三", timeOfDay: "下午", maxDurationMin: 60 });
  });

  it("有结果时 nextAction 提示「点卡片选时间」，不让模型自己排期", async () => {
    const reg = createAssistantToolRegistry();
    const r = await reg.exec("search_experiments", {}, {
      ctx: {
        ...ctx,
        search: async () => ({
          ...emptyPayload,
          summary: "找到 2 门",
          totalEligible: 2,
          experiments: [
            {
              id: "a",
              title: "决策实验",
              location: "302",
              durationMin: 45,
              rewardText: "40 元",
              researcherName: "张",
              matchedSlotCount: 1,
              nextSlotAt: null,
              matchedSlots: [],
            },
          ],
        }),
      },
      sink: {},
      now: ctx.now,
    });

    expect(r.ok).toBe(true);
    expect(r.summary).toBe("找到 2 门");
    expect(String(r.nextAction)).toContain("卡片");
  });

  it("无结果时 nextAction 提示给放宽建议", async () => {
    const reg = createAssistantToolRegistry();
    const r = await reg.exec("search_experiments", {}, { ctx, sink: {}, now: ctx.now });

    expect(String(r.nextAction)).toContain("放宽");
  });

  it("非法参数（maxDurationMin 为负）被 Zod 挡住，返回 ok:false", async () => {
    const reg = createAssistantToolRegistry();
    const r = await reg.exec(
      "search_experiments",
      { maxDurationMin: -10 },
      { ctx, sink: {}, now: ctx.now },
    );

    expect(r.ok).toBe(false);
    expect(String(r.error)).toContain("参数不合法");
  });

  it("search 抛异常时不打断对话，转成 ok:false", async () => {
    const reg = createAssistantToolRegistry();
    const r = await reg.exec("search_experiments", {}, {
      ctx: { ...ctx, search: async () => { throw new Error("数据库炸了"); } },
      sink: {},
      now: ctx.now,
    });

    expect(r.ok).toBe(false);
    expect(String(r.error)).toContain("数据库炸了");
  });
});
