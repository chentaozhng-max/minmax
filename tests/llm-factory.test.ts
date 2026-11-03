import { beforeEach, describe, expect, it } from "vitest";
import {
  createLlm,
  getLlm,
  parseMockScriptForTest,
  resetLlmCache,
  resolveProvider,
} from "@/adapters/llm";
import { MockLlm } from "@/adapters/llm/mock";
import { OpenAiCompatibleLlm } from "@/adapters/llm/openai-compatible";

/**
 * 1.4 验证工厂：
 *   - 环境变量 → provider 解析（含未知值报错）
 *   - createLlm 返回正确类型的实例
 *   - getLlm 单例：同配置复用，配置变了重建
 *   - LLM_MOCK_SCRIPT 解析（合法 / 非法 / 空）
 */

describe("resolveProvider", () => {
  it("留空 → openai-compatible（保持旧行为）", () => {
    expect(resolveProvider({})).toBe("openai-compatible");
  });

  it("mock → mock", () => {
    expect(resolveProvider({ LLM_PROVIDER: "mock" })).toBe("mock");
  });

  it("大小写与空格不敏感", () => {
    expect(resolveProvider({ LLM_PROVIDER: "  MOCK  " })).toBe("mock");
  });

  it("openai / deepseek 别名都映射到 openai-compatible", () => {
    expect(resolveProvider({ LLM_PROVIDER: "openai" })).toBe("openai-compatible");
    expect(resolveProvider({ LLM_PROVIDER: "deepseek" })).toBe("openai-compatible");
  });

  it("未知值 → 抛错且提示可选值", () => {
    expect(() => resolveProvider({ LLM_PROVIDER: "claude" })).toThrow(
      /未知的 LLM_PROVIDER="claude"/,
    );
  });
});

describe("createLlm 实例类型", () => {
  it("LLM_PROVIDER=mock → MockLlm", () => {
    const llm = createLlm({ LLM_PROVIDER: "mock" });
    expect(llm).toBeInstanceOf(MockLlm);
    expect(llm.configured()).toBe(true);
  });

  it("不设 provider → OpenAiCompatibleLlm", () => {
    const llm = createLlm({});
    expect(llm).toBeInstanceOf(OpenAiCompatibleLlm);
  });

  it("有 key → configured() 为 true；无 key → false（降级）", () => {
    const withKey = createLlm({ LLM_API_KEY: "sk-abcdefghijklmn" });
    expect(withKey.configured()).toBe(true);

    const noKey = createLlm({});
    expect(noKey.configured()).toBe(false);
  });

  it("读取 LLM_BASE_URL / LLM_MODEL 并传给适配器", async () => {
    // 通过实际发请求的 URL 与 body 反查，确认配置透传
    let url = "";
    let body: Record<string, unknown> = {};
    const original = globalThis.fetch;
    globalThis.fetch = (async (u: string, init: RequestInit) => {
      url = String(u);
      body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
    }) as unknown as typeof fetch;

    try {
      const llm = createLlm({
        LLM_BASE_URL: "https://custom.example.com/api/",
        LLM_API_KEY: "sk-abcdefghijklmn",
        LLM_MODEL: "my-model",
      });
      await llm.chat({ messages: [], tools: [] });
      expect(url).toBe("https://custom.example.com/api/chat/completions");
      expect(body.model).toBe("my-model");
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("getLlm 单例", () => {
  beforeEach(() => resetLlmCache());

  it("同配置返回同一个实例", () => {
    const env = { LLM_PROVIDER: "mock" };
    expect(getLlm(env)).toBe(getLlm(env));
  });

  it("配置变化后重建实例", () => {
    const a = getLlm({ LLM_PROVIDER: "mock", LLM_MOCK_SCRIPT: "" });
    const b = getLlm({ LLM_PROVIDER: "mock", LLM_MOCK_SCRIPT: '[{"content":"x"}]' });
    expect(a).not.toBe(b);
  });

  it("resetLlmCache 后重新构造", () => {
    const env = { LLM_PROVIDER: "mock" };
    const a = getLlm(env);
    resetLlmCache();
    expect(getLlm(env)).not.toBe(a);
  });
});

describe("LLM_MOCK_SCRIPT 解析", () => {
  it("合法 JSON 数组被采用", () => {
    const script = parseMockScriptForTest('[{"content":"第一句"},{"content":"第二句"}]');
    expect(script).toHaveLength(2);
    expect(script[0].content).toBe("第一句");
  });

  it("非法 JSON → 退回默认脚本并 warn，不抛错", () => {
    const script = parseMockScriptForTest("{broken");
    expect(script).toHaveLength(1);
    expect(script[0].content).toContain("演示模式");
  });

  it("空数组 → 退回默认脚本", () => {
    const script = parseMockScriptForTest("[]");
    expect(script).toHaveLength(1);
  });

  it("未设置 → 默认脚本含引导话术", () => {
    const script = parseMockScriptForTest(undefined);
    expect(script[0].content).toContain("演示模式");
  });
});
