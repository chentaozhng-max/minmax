import { describe, expect, it, vi } from "vitest";
import { normalizeToolCalls, OpenAiCompatibleLlm } from "@/adapters/llm/openai-compatible";

/**
 * 1.2 验证 OpenAI 兼容适配器：
 *   - 无 key / key 太短 → configured() false（上层据此降级表单模式）
 *   - 正常响应 → 正确解析 content 和 tool_calls
 *   - arguments 是非法 JSON 字符串 → 退化成 {}，不抛错
 *   - 非 2xx → 抛错且错误信息含状态码
 *   - 请求体字段与原实现逐项一致（这是「搬家不改行为」的证据）
 */

function makeLlm(fetchImpl: typeof fetch, apiKey = "sk-test-1234567890") {
  return new OpenAiCompatibleLlm({
    baseUrl: "https://api.example.com/",
    apiKey,
    model: "test-model",
    fetchImpl,
  });
}

describe("OpenAiCompatibleLlm 配置判断", () => {
  it("空 key → 未配置", () => {
    const llm = makeLlm(vi.fn() as unknown as typeof fetch, "");
    expect(llm.configured()).toBe(false);
  });

  it("key 长度 <= 8 → 视为未配置（防残值）", () => {
    const llm = makeLlm(vi.fn() as unknown as typeof fetch, "sk-123");
    expect(llm.configured()).toBe(false);
  });

  it("正常 key → 已配置", () => {
    const llm = makeLlm(vi.fn() as unknown as typeof fetch, "sk-test-1234567890");
    expect(llm.configured()).toBe(true);
  });

  it("未配置时 chat 直接抛错，不打网络", async () => {
    const fetchMock = vi.fn();
    const llm = makeLlm(fetchMock as unknown as typeof fetch, "");
    await expect(llm.chat({ messages: [], tools: [] })).rejects.toThrow("LLM 未配置");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("OpenAiCompatibleLlm 响应解析", () => {
  it("解析 content 与 tool_calls，并把 arguments 字符串转成对象", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "  我查到了两个时段  ",
                tool_calls: [
                  {
                    id: "call_abc",
                    type: "function",
                    function: { name: "get_available_slots", arguments: '{"experimentId":"exp1"}' },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const llm = makeLlm(fetchMock as unknown as typeof fetch);
    const reply = await llm.chat({ messages: [{ role: "user", content: "查时段" }], tools: [] });

    // content 被 trim
    expect(reply.content).toBe("我查到了两个时段");
    expect(reply.toolCalls).toEqual([
      { id: "call_abc", name: "get_available_slots", args: { experimentId: "exp1" } },
    ]);
  });

  it("arguments 是非法 JSON → 退化成 {} 而不抛出", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "",
                tool_calls: [
                  { id: "c1", type: "function", function: { name: "book_slot", arguments: "{not json" } },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const llm = makeLlm(fetchMock as unknown as typeof fetch);
    const reply = await llm.chat({ messages: [], tools: [] });

    expect(reply.toolCalls).toHaveLength(1);
    expect(reply.toolCalls[0].args).toEqual({});
  });

  it("没有 tool_calls 时返回空数组（纯文本回复）", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "你好" } }] }), { status: 200 }),
    );
    const llm = makeLlm(fetchMock as unknown as typeof fetch);
    const reply = await llm.chat({ messages: [], tools: [] });
    expect(reply.content).toBe("你好");
    expect(reply.toolCalls).toEqual([]);
  });

  it("非 2xx 抛错且包含状态码", async () => {
    const fetchMock = vi.fn(async () => new Response("upstream boom", { status: 429 }));
    const llm = makeLlm(fetchMock as unknown as typeof fetch);
    await expect(llm.chat({ messages: [], tools: [] })).rejects.toThrow(/LLM 429/);
  });

  it("响应缺少 choices 时抛「返回为空」", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
    const llm = makeLlm(fetchMock as unknown as typeof fetch);
    await expect(llm.chat({ messages: [], tools: [] })).rejects.toThrow("LLM 返回为空");
  });
});

describe("OpenAiCompatibleLlm 请求体（搬家不改行为的证据）", () => {
  it("发送的字段与旧实现逐项一致：model/tool_choice/temperature 默认 0.3/max_tokens 800", async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      captured = { url: String(url), init: init! };
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
    });

    const llm = makeLlm(fetchMock as unknown as typeof fetch);
    await llm.chat({ messages: [{ role: "user", content: "hi" }], tools: [] });

    expect(captured).not.toBeNull();
    // baseUrl 末尾斜杠被去掉，路径拼接正确
    expect(captured!.url).toBe("https://api.example.com/chat/completions");

    const body = JSON.parse(String(captured!.init.body));
    expect(body.model).toBe("test-model");
    expect(body.tool_choice).toBe("auto");
    expect(body.temperature).toBe(0.3);
    expect(body.max_tokens).toBe(800);
    expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
  });

  it("显式传 temperature 时覆盖默认值", async () => {
    let body: Record<string, unknown> = {};
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      body = JSON.parse(String(init!.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
    });

    const llm = makeLlm(fetchMock as unknown as typeof fetch);
    await llm.chat({ messages: [], tools: [], temperature: 0.9 });
    expect(body.temperature).toBe(0.9);
  });

  it("Authorization 头带 Bearer key", async () => {
    let headers: Record<string, string> = {};
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      headers = init!.headers as Record<string, string>;
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
    });

    const llm = makeLlm(fetchMock as unknown as typeof fetch);
    await llm.chat({ messages: [], tools: [] });
    expect(headers.Authorization).toBe("Bearer sk-test-1234567890");
  });
});

describe("normalizeToolCalls 独立函数", () => {
  it("undefined → 空数组", () => {
    expect(normalizeToolCalls(undefined)).toEqual([]);
  });

  it("arguments 为空字符串 → 当成 {} 处理", () => {
    const out = normalizeToolCalls([
      { id: "c1", type: "function", function: { name: "x", arguments: "" } },
    ]);
    expect(out[0].args).toEqual({});
  });
});
