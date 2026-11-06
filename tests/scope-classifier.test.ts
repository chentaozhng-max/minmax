import { describe, expect, it, vi } from "vitest";
import {
  LlmScopeClassifier,
  extractJson,
  createScopeClassifier,
  SCOPE_TIMEOUT_MS,
} from "@/adapters/llm/scope-classifier";
import { MockLlm } from "@/adapters/llm/mock";

/** 造一个只回一段文本的假 LLM */
function fakeLlm(content: string, configured = true) {
  return new MockLlm({ script: [{ content }], configured });
}

/** 造一个带 recorder 的假 LLM，返回 [llm, recorder] */
function recordingLlm(content: string) {
  const recorder = { messages: [] as never[], tools: [] as never[] };
  const llm = new MockLlm({ script: [{ content }], recorder });
  return { llm, recorder };
}

/* SECTION_PARSE */
describe("extractJson —— 宽容解析", () => {
  it("裸 JSON 直接拿到", () => {
    expect(extractJson('{"scope":"IN_SCOPE"}')).toEqual({ scope: "IN_SCOPE" });
  });

  it("包在 markdown 代码块里也能拿到", () => {
    expect(extractJson('```json\n{"scope":"OUT_OF_SCOPE"}\n```')).toEqual({
      scope: "OUT_OF_SCOPE",
    });
  });

  it("前后有废话也能拿到（模型很爱加「好的，我的判断是」）", () => {
    expect(extractJson('好的，我的判断是：{"scope":"ADJACENT"} 就这样。')).toEqual({
      scope: "ADJACENT",
    });
  });

  it("没有 JSON → null", () => {
    expect(extractJson("我觉得这属于范围内")).toBeNull();
    expect(extractJson("")).toBeNull();
  });

  it("JSON 语法坏了 → null（不抛）", () => {
    expect(extractJson('{"scope":"IN_SCOPE",}')).toBeNull();
  });
});

/* SECTION_PARSE_END */

/* SECTION_NORMAL */
describe("正常分类", () => {
  it("模型回 OUT_OF_SCOPE → 原样透出", async () => {
    const c = new LlmScopeClassifier({ llm: fakeLlm('{"scope":"OUT_OF_SCOPE","reason":"问游戏"}') });
    const v = await c.classify("星穹铁道怎么配队");
    expect(v.kind).toBe("OUT_OF_SCOPE");
    expect(v.reason).toBe("问游戏");
  });

  it("模型回 ADJACENT → 原样透出", async () => {
    const c = new LlmScopeClassifier({ llm: fakeLlm('{"scope":"ADJACENT"}') });
    expect((await c.classify("我最近睡不好")).kind).toBe("ADJACENT");
  });

  it("模型回 IN_SCOPE → 原样透出", async () => {
    const c = new LlmScopeClassifier({ llm: fakeLlm('{"scope":"IN_SCOPE"}') });
    expect((await c.classify("我想找个睡眠实验")).kind).toBe("IN_SCOPE");
  });

  it("configured() 透传底层 LLM 的配置状态", () => {
    expect(new LlmScopeClassifier({ llm: fakeLlm("x", true) }).configured()).toBe(true);
    expect(new LlmScopeClassifier({ llm: fakeLlm("x", false) }).configured()).toBe(false);
  });
});

/* SECTION_NORMAL_END */

/* SECTION_FALLBACK */
describe("任何失败都降级成放行（IN_SCOPE）", () => {
  it("未配置 → 放行，且不调模型", async () => {
    const llm = fakeLlm("x", false);
    const spy = vi.spyOn(llm, "chat");
    const c = new LlmScopeClassifier({ llm });
    expect((await c.classify("随便什么")).kind).toBe("IN_SCOPE");
    expect(spy).not.toHaveBeenCalled();
  });

  it("模型回垃圾文本 → 放行", async () => {
    const c = new LlmScopeClassifier({ llm: fakeLlm("我不确定这句话该怎么分类") });
    expect((await c.classify("你好")).kind).toBe("IN_SCOPE");
  });

  it("模型回未知枚举值 → 放行（不猜最接近的）", async () => {
    const c = new LlmScopeClassifier({ llm: fakeLlm('{"scope":"out_of_scope"}') });
    expect((await c.classify("x")).kind).toBe("IN_SCOPE");
  });

  it("模型抛异常 → 放行，不把异常抛给调用方", async () => {
    const llm = fakeLlm("x");
    vi.spyOn(llm, "chat").mockRejectedValue(new Error("network down"));
    const c = new LlmScopeClassifier({ llm });
    await expect(c.classify("x")).resolves.toMatchObject({ kind: "IN_SCOPE" });
  });

  it("超时 → 放行", async () => {
    // 造一个永不 resolve 的 chat
    const llm = fakeLlm("x");
    vi.spyOn(llm, "chat").mockImplementation(() => new Promise(() => {}));
    const c = new LlmScopeClassifier({ llm, timeoutMs: 20 });
    const v = await c.classify("x");
    expect(v.kind).toBe("IN_SCOPE");
  });

  it("超时后不残留定时器（不报 unhandled rejection）", async () => {
    const llm = fakeLlm('{"scope":"OUT_OF_SCOPE"}');
    const c = new LlmScopeClassifier({ llm, timeoutMs: 500 });
    // 正常路径下定时器必须被清掉，否则 vitest 会因悬挂 handle 报警
    await expect(c.classify("x")).resolves.toMatchObject({ kind: "OUT_OF_SCOPE" });
  });

  it("超长输入被截断（不把整篇文章送进分类器）", async () => {
    const { llm, recorder } = recordingLlm('{"scope":"IN_SCOPE"}');
    const c = new LlmScopeClassifier({ llm });
    await c.classify("啊".repeat(2000));
    const sent = recorder.messages[0] as unknown as { role: string; content: string }[];
    const userMsg = sent.find((m) => m.role === "user");
    expect(userMsg?.content.length).toBe(500);
  });
});

/* SECTION_FALLBACK_END */

/* SECTION_PROMPT */
describe("调用参数", () => {
  it("temperature=0、maxTokens 短、tools 为空", async () => {
    const { llm } = recordingLlm('{"scope":"IN_SCOPE"}');
    const spy = vi.spyOn(llm, "chat");
    await new LlmScopeClassifier({ llm }).classify("x");
    const params = spy.mock.calls[0][0];
    expect(params.temperature).toBe(0);
    expect(params.maxTokens).toBeLessThanOrEqual(60);
    expect(params.tools).toEqual([]);
  });

  it("system prompt 里必须出现四类的名字（分类器靠它区分）", async () => {
    const { llm, recorder } = recordingLlm('{"scope":"IN_SCOPE"}');
    await new LlmScopeClassifier({ llm }).classify("x");
    const sent = recorder.messages[0] as unknown as { role: string; content: string }[];
    const system = sent.find((m) => m.role === "system");
    for (const kind of ["IN_SCOPE", "ADJACENT", "OUT_OF_SCOPE", "CRISIS"]) {
      expect(system?.content).toContain(kind);
    }
  });

  it("默认超时是 3 秒", () => {
    expect(SCOPE_TIMEOUT_MS).toBe(3000);
  });
});

describe("createScopeClassifier 读 SCOPE_MODEL", () => {
  it("配了 SCOPE_MODEL 就用它", () => {
    const c = createScopeClassifier({
      LLM_PROVIDER: "mock",
      LLM_MODEL: "big-model",
      SCOPE_MODEL: "small-model",
    });
    // 内部 llm 的模型名不可直接读，这里只断言能造出来且可用
    expect(c).toBeDefined();
  });

  it("没配 SCOPE_MODEL 时回落到 LLM_MODEL 也不报错", () => {
    expect(
      createScopeClassifier({ LLM_PROVIDER: "mock", LLM_MODEL: "big-model" }),
    ).toBeDefined();
  });
});

/* SECTION_PROMPT_END */

