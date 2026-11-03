import { describe, expect, it } from "vitest";
import { createToolRegistry } from "@/tools";

/**
 * 2.3-2.5 的关键护栏：**生成的工具描述必须与原来手写的 TOOLS 数组逐字段一致**。
 *
 * 原来的手写版本（重构前 agent.ts L92-168）在这里硬编码成基准，
 * 任何字段漂移（description 改字、required 漏项、properties 少了）都会立刻红。
 * 这是「拆分不改行为」的唯一硬证据。
 */

/** 重构前 agent.ts 里手写的 TOOLS 数组，原样抄录作为基准 */
const ORIGINAL_SPECS = [
  {
    type: "function",
    function: {
      name: "get_available_slots",
      description: "读取该实验当前还有空位的时段（系统事实，不要自己编时间）",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_my_busy_slots",
      description: "读取当前被试已有的预约，用于避让时间冲突",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_my_credit_status",
      description: "读取当前被试的信誉分与是否被禁报名",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_slots",
      description: "向被试展示 2-3 个候选时段供其选择。展示后等待用户挑选，不要继续调用 book_slot",
      parameters: {
        type: "object",
        properties: {
          slotIds: {
            type: "array",
            items: { type: "string" },
            description: "候选时段的 id，必须来自 get_available_slots 的结果",
          },
          reasonText: { type: "string", description: "一句话说明为什么推荐这几个" },
        },
        required: ["slotIds", "reasonText"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "book_slot",
      description: "锁定时段并创建预约。只有被试明确选定某个时段后才调用",
      parameters: {
        type: "object",
        properties: { slotId: { type: "string", description: "被选中的时段 id" } },
        required: ["slotId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "join_waitlist",
      description: "没有可用时段时，登记候补",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "escalate_to_researcher",
      description: "被试需要人工沟通时，给主试留言",
      parameters: {
        type: "object",
        properties: { message: { type: "string", description: "给主试的留言" } },
        required: ["message"],
      },
    },
  },
];

describe("生成的 specs 与重构前手写 TOOLS 逐字段一致", () => {
  const generated = createToolRegistry().specs();

  it("工具数量与顺序完全一致", () => {
    expect(generated.map((s) => s.function.name)).toEqual(
      ORIGINAL_SPECS.map((s) => s.function.name),
    );
  });

  it("每个工具的完整 spec 深度相等", () => {
    expect(generated).toEqual(ORIGINAL_SPECS);
  });

  it("逐个工具单独比对（失败时能立刻定位是哪个工具漂移）", () => {
    ORIGINAL_SPECS.forEach((original, index) => {
      expect(generated[index], `工具 ${original.function.name} 漂移了`).toEqual(original);
    });
  });
});

describe("注册表完整性", () => {
  it("7 个工具全部注册，无遗漏无多余", () => {
    const reg = createToolRegistry();
    expect(reg.names()).toEqual([
      "get_available_slots",
      "get_my_busy_slots",
      "get_my_credit_status",
      "propose_slots",
      "book_slot",
      "join_waitlist",
      "escalate_to_researcher",
    ]);
  });

  it("每次调用 createToolRegistry 都是独立实例（不共享可变状态）", () => {
    expect(createToolRegistry()).not.toBe(createToolRegistry());
  });
});
