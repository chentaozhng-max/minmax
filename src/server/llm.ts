/**
 * 兼容转发层。
 *
 * 真正的实现已搬到 `@/adapters/llm/`（依赖倒置：适配器实现 `@/domain/ports/llm` 的 LlmPort）。
 * 这个文件保留原来的函数签名与导出名，让所有旧调用方（agent.ts 等）一行都不用改。
 *
 * 等 Phase 2 把 agent.ts 改成直接依赖端口的注册表后，本文件可以删掉。
 * 在此之前它保证「随时能回退」——想回到旧行为，只需要恢复本文件的历史版本。
 */
import { getLlm } from "@/adapters/llm";
import type { LlmMessage, LlmReply, LlmToolSpec } from "@/domain/ports/llm";

export type { LlmMessage, LlmReply, LlmToolSpec, LlmToolCall, LlmRawToolCall } from "@/domain/ports/llm";

export type LlmChatParams = {
  messages: LlmMessage[];
  tools: LlmToolSpec[];
  temperature?: number;
};

/** 是否已配置可用的模型（每次调用重新判断，不缓存） */
export function llmConfigured(): boolean {
  return getLlm().configured();
}

/** 发起一次带工具的对话 */
export function chatWithTools(params: LlmChatParams): Promise<LlmReply> {
  return getLlm().chat(params);
}

/** 供需要拿到端口本体的新代码使用 */
export { getLlm };
