/**
 * 兼容转发层。
 *
 * 原来的 211 行已按职责拆成三份，都在 `@/domain/` 下：
 *   constants.ts  枚举 / 标签 / 状态集合
 *   messages.ts   ChatSession.messages 结构与读写
 *   schemas.ts    请求体 Zod 校验
 *
 * 保留原路径汇总导出，32 个调用方一行都不用改。
 */
export * from "@/domain/constants";
export * from "@/domain/messages";
export * from "@/domain/schemas";
