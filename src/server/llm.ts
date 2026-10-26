/**
 * 最小可用的 OpenAI 兼容客户端（DeepSeek 等），只实现我们需要的 chat + tool calling。
 * 不引入 SDK：一个 fetch 就够，也方便在无 key 时干净地降级。
 */

export type LlmToolCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
};

export type LlmMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: LlmRawToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

type LlmRawToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type LlmToolSpec = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type LlmReply = { content: string; toolCalls: LlmToolCall[] };

export function llmConfigured() {
  return Boolean(process.env.LLM_API_KEY && process.env.LLM_API_KEY.trim().length > 8);
}

const DEFAULT_TIMEOUT_MS = 25_000;

export async function chatWithTools(params: {
  messages: LlmMessage[];
  tools: LlmToolSpec[];
  temperature?: number;
}): Promise<LlmReply> {
  const baseUrl = (process.env.LLM_BASE_URL || "https://api.deepseek.com").replace(/\/$/, "");
  const apiKey = process.env.LLM_API_KEY || "";
  const model = process.env.LLM_MODEL || "deepseek-chat";
  if (!llmConfigured()) throw new Error("LLM 未配置");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: params.messages,
        tools: params.tools,
        tool_choice: "auto",
        temperature: params.temperature ?? 0.3,
        max_tokens: 800,
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

    const toolCalls: LlmToolCall[] = (message.tool_calls ?? []).map((tc) => {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>;
      } catch {
        args = {};
      }
      return { id: tc.id, name: tc.function.name, args };
    });

    return { content: (message.content ?? "").trim(), toolCalls };
  } finally {
    clearTimeout(timer);
  }
}
