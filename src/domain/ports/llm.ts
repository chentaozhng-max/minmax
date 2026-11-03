/**
 * LLM 端口 —— 领域层对「模型」这件事的唯一认知。
 *
 * 这层只知道「可以拿一串消息和一组工具去问一次模型，模型回答一段文字 + 若干次工具调用」。
 * 至于背后是 DeepSeek、OpenAI、还是测试用的假实现，领域层一概不知道。
 *
 * 依赖方向：application/ → domain/ports/ ← adapters/llm/
 *                                          （实现方指向接口，反转了原来的反向依赖）
 */

/** 暴露给模型的工具描述（JSON Schema 形式，OpenAI function calling 约定） */
export type LlmToolSpec = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

/** 模型请求的一次工具调用，arguments 已解析成对象 */
export type LlmToolCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
};

/** 线上传输的原始 tool_call（arguments 是 JSON 字符串，仅供适配器内部使用） */
export type LlmRawToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

/** 送进模型的单条消息 */
export type LlmMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: LlmRawToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

/** 模型的一次回复：自然语言 + 工具调用列表（可能为空） */
export type LlmReply = { content: string; toolCalls: LlmToolCall[] };

/**
 * 模型端口。
 * 换 provider = 新写一个实现类，本文件与所有调用方都不动。
 */
export interface LlmPort {
  /**
   * 是否已配置好（无 key 时上层要降级成表单模式）。
   * 约定：每次调用都重新判断，不要在构造时缓存 —— 否则测试里改环境变量会失效。
   */
  configured(): boolean;

  /** 发起一次对话（非流式） */
  chat(params: {
    messages: LlmMessage[];
    tools: LlmToolSpec[];
    temperature?: number;
    /**
     * 本次回复的最大 token 数。
     *
     * 聊一轮只要几百 token，写一份实验草稿（标题 + 说明 + 要求 + 时段计划）
     * 要长得多 —— 用同一个上限会把 JSON 截断成半个对象。
     * 不传时由适配器决定默认值，上层不需要知道具体数字。
     */
    maxTokens?: number;
  }): Promise<LlmReply>;
}
