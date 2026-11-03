/**
 * 工具注册入口 —— 加 agent 能力只需在这里多加一行 register。
 */
import { ToolRegistry } from "@/tools/registry";
import type { AgentContext } from "@/tools/context";
import { getAvailableSlotsTool } from "@/tools/get-available-slots";
import { getMyBusySlotsTool } from "@/tools/get-my-busy-slots";
import { getMyCreditStatusTool } from "@/tools/get-my-credit-status";
import { proposeSlotsTool } from "@/tools/propose-slots";
import { bookSlotTool } from "@/tools/book-slot";
import { joinWaitlistTool } from "@/tools/join-waitlist";
import { escalateToResearcherTool } from "@/tools/escalate-to-researcher";
import { searchExperimentsTool } from "@/tools/search-experiments";
import type { AssistantContext } from "@/tools/assistant-context";
import { writeExperimentDraftTool } from "@/tools/write-experiment-draft";
import type { DraftContext } from "@/tools/draft-context";

/**
 * 构造注册表。
 * 顺序影响 specs() 的输出顺序（进而影响模型看到的工具顺序），
 * 这里保持与原 TOOLS 数组完全一致的顺序，避免行为变化。
 */
export function createToolRegistry(): ToolRegistry<AgentContext> {
  return new ToolRegistry<AgentContext>([
    getAvailableSlotsTool,
    getMyBusySlotsTool,
    getMyCreditStatusTool,
    proposeSlotsTool,
    bookSlotTool,
    joinWaitlistTool,
    escalateToResearcherTool,
  ]);
}

export type { AgentContext } from "@/tools/context";
export type { AssistantContext } from "@/tools/assistant-context";

/**
 * 助手（跨实验）注册表 —— 与上面**完全独立**。
 *
 * 这里是「门厅」：还不知道是哪门实验，只能搜。
 * 老 7 个工具（排期/预约）不在这里注册，模型在搜索场景下根本看不到它们 ——
 * 能力边界靠分层划出来，而不是靠提示词劝住它。
 *
 * 也正因为独立，`tests/tools-specs-parity.test.ts` 对老 7 名的断言**原封不动照样绿**。
 */
export function createAssistantToolRegistry(): ToolRegistry<AssistantContext> {
  return new ToolRegistry<AssistantContext>([searchExperimentsTool]);
}

/**
 * 发布助手注册表 —— 主试侧，只有一个「写草稿」工具。
 *
 * 它既没有 experiment 也没有 subject：这时候什么都还没建。
 * 也不能建实验 —— 建实验要过 publishExperiment（禁期、截止、容量、事务），
 * 让模型直接写库等于把这条校验链绕过去。
 */
export function createDraftToolRegistry(): ToolRegistry<DraftContext> {
  return new ToolRegistry<DraftContext>([writeExperimentDraftTool]);
}

export type { ToolSink, ToolResult, ToolContext, AgentTool } from "@/tools/registry";
export type { DraftContext } from "@/tools/draft-context";
