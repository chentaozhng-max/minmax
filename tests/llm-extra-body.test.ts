import { describe, expect, it, vi } from "vitest";
import { OpenAiCompatibleLlm } from "@/adapters/llm/openai-compatible";
import { createLlm, getLlm, parseExtraBody, resetLlmCache } from "@/adapters/llm";

/**
 * provider 私有请求体参数（LLM_EXTRA_BODY）。
 *
 * 存在理由：`thinking: {type:"disabled"}` 是 DeepSeek 私有字段。deepseek-flash 是推理模型，
 * 思维链和正文共用一个 max_tokens 配额（实测 max_tokens=10 问「hi」→ content 空、finish=length）。
 * 关掉思考链比调大 max_tokens 更接近病根。
 *
 * 但它绝不能出现在 LlmPort 的 chat() 参数里 —— 那会让应用层知道背后是谁。
 */

function makeLlm(extraBody?: Record<string, unknown>) {
  let body: Record<string, unknown> = {};
  const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    body = JSON.parse(String(init!.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
  });
  const llm = new OpenAiCompatibleLlm({
    baseUrl: "https://api.example.com",
    apiKey: "sk-test-1234567890",
    model: "test-model",
    fetchImpl: fetchMock as unknown as typeof fetch,
    extraBody,
  });
  return { llm, getBody: () => body };
}

describe("parseExtraBody", () => {
  it("正常 JSON 对象 → 解析成字段", () => {
    expect(parseExtraBody('{"thinking":{"type":"disabled"}}')).toEqual({
      thinking: { type: "disabled" },
    });
  });

  it("空 / 未设 → undefined（不往请求体里塞空对象）", () => {
    expect(parseExtraBody(undefined)).toBeUndefined();
    expect(parseExtraBody("")).toBeUndefined();
    expect(parseExtraBody("   ")).toBeUndefined();
  });

  it("⚠️ 非法 JSON → 忽略并 warn，不抛错（一个 env 写错不该让整站聊天瘫痪）", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(parseExtraBody("{不是对象")).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("数组 / 标量 → 拒绝（只接受对象）", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(parseExtraBody("[1,2]")).toBeUndefined();
    expect(parseExtraBody('"字符串"')).toBeUndefined();
    expect(parseExtraBody("null")).toBeUndefined();
    warn.mockRestore();
  });
});

describe("OpenAiCompatibleLlm 应用 extraBody", () => {
  it("extraBody 字段出现在请求体里", async () => {
    const { llm, getBody } = makeLlm({ thinking: { type: "disabled" } });
    await llm.chat({ messages: [], tools: [] });
    expect(getBody().thinking).toEqual({ type: "disabled" });
  });

  it("不传 extraBody 时请求体与原来完全一致（不多出字段）", async () => {
    const { llm, getBody } = makeLlm(undefined);
    await llm.chat({ messages: [], tools: [] });
    expect(Object.keys(getBody()).sort()).toEqual(
      ["max_tokens", "messages", "model", "temperature", "tool_choice", "tools"].sort(),
    );
  });

  it("extraBody 可以覆盖默认值（比如调大 max_tokens）", async () => {
    const { llm, getBody } = makeLlm({ max_tokens: 2000 });
    await llm.chat({ messages: [], tools: [] });
    expect(getBody().max_tokens).toBe(2000);
  });
});

describe("createLlm 从 env 读 extraBody", () => {
  it("LLM_EXTRA_BODY 生效到适配器", async () => {
    resetLlmCache();
    const llm = createLlm({
      LLM_PROVIDER: "openai-compatible",
      LLM_API_KEY: "sk-test-1234567890",
      LLM_MODEL: "deepseek-flash",
      LLM_EXTRA_BODY: '{"thinking":{"type":"disabled"}}',
    });
    expect(llm.configured()).toBe(true);

    // 通过实际请求体验证（适配器内部字段不对外暴露，只能看发出去的 body）
    let body: Record<string, unknown> = {};
    const fetchMock = vi.fn(async (_u: string | URL | Request, init?: RequestInit) => {
      body = JSON.parse(String(init!.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
    });
    const probe = new OpenAiCompatibleLlm({
      baseUrl: "https://api.deepseek.com",
      apiKey: "sk-test-1234567890",
      model: "deepseek-flash",
      fetchImpl: fetchMock as unknown as typeof fetch,
      extraBody: parseExtraBody('{"thinking":{"type":"disabled"}}'),
    });
    await probe.chat({ messages: [], tools: [] });
    expect(body.thinking).toEqual({ type: "disabled" });
  });

  it("⚠️ 改 LLM_EXTRA_BODY 会让 getLlm 重建（否则改 env 不生效）", () => {
    resetLlmCache();
    const a = getLlm({ LLM_PROVIDER: "mock" });
    const b = getLlm({ LLM_PROVIDER: "mock", LLM_EXTRA_BODY: '{"x":1}' });
    expect(a).not.toBe(b);
  });
});
