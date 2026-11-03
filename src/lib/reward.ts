/**
 * 兼容转发层。
 *
 * 奖励金额口径已搬到 `@/domain/reward.ts`（领域层，纯函数）。
 * 保留原路径导出，所有调用方一行都不用改。
 */
export * from "@/domain/reward";
