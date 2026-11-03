/**
 * 兼容转发层。
 *
 * 撮合排序规则已搬到 `@/domain/matching.ts`（领域层，纯函数）。
 * 保留原路径导出，所有调用方一行都不用改。
 */
export * from "@/domain/matching";
