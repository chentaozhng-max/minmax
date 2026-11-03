/**
 * OpenAI 兼容协议的 LLM 适配器（DeepSeek / OpenAI / 任何兼容 /chat/completions 的服务）。
 *
 * 这是 LlmPort 的一个实现。除本文件外，没有人知道背后是哪个 provider。
 * 不引入 SDK：一个 fetch 就够，也方便在无 key 时干净地降级。
 */
import type {
  LlmMessage,
  LlmPort,
  LlmRawToolCall,
  LlmReply,
  LlmToolSpec,
} from "@/domain/ports/llm";

const DEFAULT_TIMEOUT_MS = 25_000;

export type OpenAiCompatibleOptions = {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  /** 便于测试注入；默认用全局 fetch */
  fetchImpl?: typeof fetch;
  /**
   * 额外塞进请求体的字段（provider 私有参数）。
   *
   * 为什么放在适配器而不是 LlmPort 的 chat() 参数里：
   * `thinking: {type:"disabled"}`、`reasoning_effort`、`top_k` 这些都是**某个 provider 私有**的，
   * 一旦进 LlmPort，应用层就得知道「当前背后是 DeepSeek 还是 OpenAI」——
   * 那正是适配层要挡掉的东西。所以它只能从 env 流到适配器构造函数，止步于此。
   *
   * 由 `LLM_EXTRA_BODY`（JSON 字符串）提供，见 adapters/llm/index.ts。
   */
  extraBody?: Record<string, unknown>;
};

export class OpenAiCompatibleLlm implements LlmPort {
  constructor(private readonly opts: OpenAiCompatibleOptions) {}

  /**
   * 每次调用都重新读配置，不在构造时缓存 —— 测试里改 options/env 才能立即生效。
   * key 长度 > 8 才算配好（防止把 "sk-" 这种残值当有效）。
   */
  configured(): boolean {
    return Boolean(this.opts.apiKey && this.opts.apiKey.trim().length > 8);
  }

  async chat(params: {
    messages: LlmMessage[];
    tools: LlmToolSpec[];
    temperature?: number;
    maxTokens?: number;
  }): Promise<LlmReply> {
    if (!this.configured()) throw new Error("LLM 未配置");

    const doFetch = this.opts.fetchImpl ?? fetch;
    const baseUrl = this.opts.baseUrl.replace(/\/$/, "");
    const timeoutMs = this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await doFetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.opts.apiKey}`,
        },
        body: JSON.stringify({
          model: this.opts.model,
          messages: params.messages,
          tools: params.tools,
          tool_choice: "auto",
          temperature: params.temperature ?? 0.3,
          max_tokens: params.maxTokens ?? 800,
          // 放在最后：provider 私有参数可以覆盖上面任何一项（比如调大 max_tokens）
          ...this.opts.extraBody,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`LLM ${res.status}: ${text.slice(0, 300)}`);
      }

      const json = (await res.json()) as {
        choices?: {
          message?: { content?: string | null; tool_calls?: LlmRawToolCall[] };
        }[];
      };
      const message = json.choices?.[0]?.message;
      if (!message) throw new Error("LLM 返回为空");

      return {
        content: (message.content ?? "").trim(),
        toolCalls: normalizeToolCalls(message.tool_calls),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * 把线上格式的 tool_calls 转成领域层的 LlmToolCall。
 * 模型返回的 arguments 是 JSON 字符串，可能非法 —— 解析失败时退化成空对象而不是整轮报错，
 * 让上层（工具执行器）去处理「参数不全」这种情况。
 */
export function normalizeToolCalls(raw: LlmRawToolCall[] | undefined): LlmReply["toolCalls"] {
  return (raw ?? []).map((tc) => {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>;
    } catch {
      args = {};
    }
    return { id: tc.id, name: tc.function.name, args };
  });
}
