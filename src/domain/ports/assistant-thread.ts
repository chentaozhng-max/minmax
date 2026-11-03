/**
 * 助手跨实验会话 —— 领域层端口。
 *
 * ## 与 ChatSessionRepository 的边界
 *
 * ChatSession 有状态机（COLLECTING_AVAILABILITY → PROPOSED → …），因为它的任务是
 * 「在一门实验里把时间定下来」。门厅的任务只是「找实验」——找完就跳走了，
 * 没有可推进的状态。给它安一个状态机是为了对称而对称。
 *
 * 所以这里只有两个动作：读到 / 追加若干条。**没有 state**。
 *
 * ## 为什么按 subjectId 唯一而不是按 threadId
 *
 * 二二的需求是「一个被试一个门厅」。开多个 thread 只会让「我刚说了什么」变得要选。
 * 将来真要支持多话题，把 unique 拆掉、加 title 即可，是往前兼容的。
 */

/** 一条消息（形状与 ChatMessage 对齐，页面/模型可直接复用） */
export type AssistantThreadMessage = {
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  /**
   * 助手这一轮调了哪些工具、返回了什么。
   *
   * 为什么要存：卡片列表是 `search_experiments` 的返回值渲染出来的。
   * 不存的话刷新页面卡片就消失，只剩文字说"找到 3 门"——用户会以为坏了。
   * 形状与 ChatMessage.toolCalls 一致，`toLlmMessages` 那套逻辑可以直接复用。
   */
  toolCalls?: {
    id: string;
    name: string;
    args: Record<string, unknown>;
    result?: unknown;
  }[];
};

export type AssistantThreadRecord = {
  id: string;
  subjectId: string;
  /** 已解析好的消息数组（解析失败的条目已被丢弃） */
  messages: AssistantThreadMessage[];
};

export interface AssistantThreadRepository {
  findBySubject(subjectId: string): Promise<AssistantThreadRecord | null>;
  /** 用整份 messages 覆盖写（追加语义由应用层负责，避免仓储理解业务） */
  saveMessages(subjectId: string, messages: AssistantThreadMessage[]): Promise<AssistantThreadRecord>;
}
