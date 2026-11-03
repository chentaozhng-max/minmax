import { describe, expect, it } from "vitest";
import type { LlmMessage, LlmPort, LlmReply, LlmToolSpec } from "@/domain/ports/llm";

/**
 * 1.1 只验证「端口契约」本身站得住：
 *   - 手写一个假实现能 satisfies LlmPort（说明接口是可用实现的，不是空想）
 *   - 消息/工具/回复的形状能被 TS 接受
 * 这里不测任何真实网络逻辑（那是 1.2 的事）。
 */

const fakeTool: LlmToolSpec = {
  type: "function",
  function: {
    name: "get_available_slots",
    description: "查可约时段",
    parameters: { type: "object", properties: {} },
  },
};

class FakeLlm implements LlmPort {
  calls: LlmMessage[][] = [];
  constructor(private readonly configuredValue: boolean) {}
  configured() {
    return this.configuredValue;
  }
  async chat(params: { messages: LlmMessage[]; tools: LlmToolSpec[]; temperature?: number }): Promise<LlmReply> {
    this.calls.push(params.messages);
    return {
      content: "我帮你查了三个时段",
      toolCalls: [{ id: "call_1", name: "get_available_slots", args: { experimentId: "e1" } }],
    };
  }
}

describe("LlmPort 端口契约", () => {
  it("假实现能满足接口并返回结构化回复", async () => {
    const llm: LlmPort = new FakeLlm(true);

    expect(llm.configured()).toBe(true);

    const reply = await llm.chat({
      messages: [{ role: "user", content: "帮我约个时间" }],
      tools: [fakeTool],
    });

    expect(reply.content).toContain("三个时段");
    expect(reply.toolCalls).toHaveLength(1);
    expect(reply.toolCalls[0].name).toBe("get_available_slots");
    expect(reply.toolCalls[0].args).toEqual({ experimentId: "e1" });
  });

  it("未配置时 configured() 返回 false，上层据此降级", () => {
    const llm: LlmPort = new FakeLlm(false);
    expect(llm.configured()).toBe(false);
  });

  it("三种消息角色都能被类型接受", () => {
    const messages: LlmMessage[] = [
      { role: "system", content: "你是排期助手" },
      { role: "user", content: "帮我约时间" },
      { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "x", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "c1", content: '{"ok":true}' },
    ];

    expect(messages).toHaveLength(4);
    expect(messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "tool"]);
  });

  it("temperature 是可选参数，不传也能通过类型检查", async () => {
    const llm: LlmPort = new FakeLlm(true);
    const reply = await llm.chat({ messages: [{ role: "user", content: "hi" }], tools: [] });
    expect(reply).toBeTruthy();
  });
});
