import { describe, expect, it } from "vitest";
import { MockLlm } from "@/adapters/llm/mock";

/**
 * 1.3 验证脚本化假 LLM：
 *   - 按顺序消费脚本，不多不少
 *   - 用尽后抛错（防止测试假绿）
 *   - recorder 能抓到实际送进去的 messages（后续验 prompt 用）
 */

describe("MockLlm 脚本消费", () => {
  it("按顺序返回脚本里的每一条", async () => {
    const llm = new MockLlm({
      script: [
        { content: "第一轮" },
        { content: "第二轮", toolCalls: [{ id: "c1", name: "get_available_slots", args: {} }] },
      ],
    });

    const r1 = await llm.chat({ messages: [], tools: [] });
    expect(r1.content).toBe("第一轮");
    expect(r1.toolCalls).toEqual([]);

    const r2 = await llm.chat({ messages: [], tools: [] });
    expect(r2.content).toBe("第二轮");
    expect(r2.toolCalls).toEqual([{ id: "c1", name: "get_available_slots", args: {} }]);
  });

  it("脚本用尽后抛错，错误信息说明调了几次", async () => {
    const llm = new MockLlm({ script: [{ content: "only" }] });
    await llm.chat({ messages: [], tools: [] });
    await expect(llm.chat({ messages: [], tools: [] })).rejects.toThrow(/脚本已用尽（第 2 次调用，脚本只有 1 条）/);
  });

  it("remaining() 随消费递减，用于断言调用次数", async () => {
    const llm = new MockLlm({ script: [{ content: "a" }, { content: "b" }, { content: "c" }] });
    expect(llm.remaining()).toBe(3);
    await llm.chat({ messages: [], tools: [] });
    expect(llm.remaining()).toBe(2);
    await llm.chat({ messages: [], tools: [] });
    expect(llm.remaining()).toBe(1);
  });
});

describe("MockLlm 配置开关", () => {
  it("默认 configured() 为 true（上层走 LLM 分支）", () => {
    const llm = new MockLlm({ script: [] });
    expect(llm.configured()).toBe(true);
  });

  it("configured:false 可模拟「没配 key」的降级路径", () => {
    const llm = new MockLlm({ script: [], configured: false });
    expect(llm.configured()).toBe(false);
  });
});

describe("MockLlm recorder", () => {
  it("记录每次请求的 messages 和 tools，可断言 prompt 内容", async () => {
    const recorder = { messages: [] as never[], tools: [] as never[] } as {
      messages: import("@/domain/ports/llm").LlmMessage[][];
      tools: import("@/domain/ports/llm").LlmToolSpec[][];
    };
    const llm = new MockLlm({ script: [{ content: "ok" }], recorder });

    await llm.chat({
      messages: [{ role: "system", content: "你是排期助手" }],
      tools: [{ type: "function", function: { name: "t", description: "d", parameters: {} } }],
    });

    expect(recorder.messages).toHaveLength(1);
    expect(recorder.messages[0][0]).toEqual({ role: "system", content: "你是排期助手" });
    expect(recorder.tools[0][0].function.name).toBe("t");
  });
});
