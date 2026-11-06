/**
 * 助手（跨实验）工具上下文。
 *
 * ## 为什么另开一份，而不是扩展 AgentContext
 *
 * `AgentContext` 里 `experiment` 是**必填**的 —— 那套工具服务于「一门实验里排期」。
 * 跨实验搜索的上下文里根本没有"当前实验"，硬塞一个假 experiment 进去，
 * 会让 7 个老工具在错误的语义下可被调用（模型可能真的去 book 一个它以为是当前的实验）。
 *
 * 两份上下文 = 两个注册表 = 两种能力边界，编译期就把界限划清：
 * 搜索场景下模型**根本看不到** book_slot。
 */

import type { SearchCriteria } from "@/domain/search-criteria";
import type { DurableFacts } from "@/domain/ports/assistant-query";

/** 助手眼里的一门候选实验（渲染卡片用） */
export type AssistantExperimentCard = {
  id: string;
  title: string;
  location: string;
  /** 线上 / 线下：线上实验没有「时段」，卡片的说法完全不同 */
  mode: "ONLINE" | "OFFLINE";
  /** ANYTIME / WINDOW 点进去就能做；SCHEDULED 要挑场次 */
  scheduleMode: "ANYTIME" | "WINDOW" | "SCHEDULED";
  durationMin: number;
  rewardText: string;
  researcherName: string;
  matchedSlotCount: number;
  nextSlotAt: string | null;
  matchedSlots: { id: string; startAt: string; endAt: string; remaining: number }[];
};

/** 跨实验搜索的结果摘要（工具返回值 & 页面渲染共用） */
export type AssistantSearchPayload = {
  summary: string;
  experiments: AssistantExperimentCard[];
  totalEligible: number;
  excluded: { title: string; reason: string }[];
  excludedCount: number;
};

export type AssistantContext = {
  subject: {
    id: string;
    creditScore: number;
    studentVerified: boolean;
    bannedUntil: Date | null;
  };
  now: Date;
  /**
   * 每轮现查的持久事实（做过 / 正在做的实验）。
   *
   * 放在上下文里而不是让工具自己去查：工具只负责「按条件搜索」，
   * 不该知道「这个人参加过什么」。而且事实要进提示词（`formatDurableFacts`），
   * 那是编排的事。
   */
  facts: DurableFacts;
  /**
   * 执行搜索。注入成回调，工具层不直接 import prisma：
   * 这样工具测试可以塞假实现，也不必知道适配器叫什么名字。
   */
  search(criteria: SearchCriteria): Promise<AssistantSearchPayload>;
};
