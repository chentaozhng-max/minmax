/**
 * 聊天会话消息的结构与序列化。
 *
 * ChatSession.messages 在库里是一个 JSON 字符串，这里是读写它的唯一出入口。
 * 解析失败时返回空数组而不是抛错 —— 一条坏数据不该让整个聊天页打不开。
 */

/** ChatSession.messages 的元素结构 */
export type ChatToolCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
};

export type ChatMessage = {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  toolCalls?: ChatToolCall[];
  createdAt: string;
};

export function parseMessages(raw: string): ChatMessage[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as ChatMessage[];
  } catch {
    return [];
  }
}

export function stringifyMessages(messages: ChatMessage[]): string {
  return JSON.stringify(messages);
}
