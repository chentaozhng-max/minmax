/**
 * 助手总览 —— 应用层用例。
 *
 * 职责：**把「查到的数据」变成「一屏能看懂的话」**。
 *   · 查什么、怎么查 → 端口（domain/ports/assistant-query.ts）
 *   · 撞车怎么算    → 领域规则（domain/assistant-brief.ts）
 *   · 两者拼起来、排好序、挑出最该说的一句 → 本文件
 *
 * 为什么要在用例层做「挑一句话」，而不是丢给页面：
 * 页面上如果写 `if (overlaps.length > 0 && next) ...` 这类判断，它会越写越多，
 * 最后变成第二个业务层，而且没法单测（React 组件测试成本远高于纯函数）。
 */

import {
  findOverlaps,
  isUpcoming,
  sortByStart,
  type BusyInterval,
  type OverlapPair,
} from "@/domain/assistant-brief";
import type { AssistantAppointment, AssistantQuery } from "@/domain/ports/assistant-query";
import { formatDateTimeCN } from "@/lib/time";

/** 助手页渲染用的一屏数据 */
export type AssistantBrief = {
  /** 接下来还有效的预约，按时间升序 */
  upcoming: AssistantAppointment[];
  /** 撞车的一对一对 */
  overlaps: Array<{
    firstTitle: string;
    secondTitle: string;
    /** 例：11月5日 14:00-14:30 */
    overlapLabel: string;
  }>;
  /** 最该告诉他的那一句（没有安排时给引导语） */
  headline: string;
};

export type BuildBriefDeps = {
  query: AssistantQuery;
  now?: Date;
};

/** 「什么算占用时间」由调用方给（生产环境传 ACTIVE_APPOINTMENT_STATUSES） */
export async function buildAssistantBrief(
  deps: BuildBriefDeps,
  subjectId: string,
  statuses: string[],
): Promise<AssistantBrief> {
  const now = deps.now ?? new Date();
  const all = await deps.query.listMyUpcomingAppointments(subjectId, now, statuses);

  // 端口已按 startAt 升序过滤过一次，这里再过滤/排序是「不信任上游」的边界检查：
  // 换一个实现（比如加了缓存）时这一层仍然成立。
  const upcoming = sortByStart(all.filter((a) => isUpcoming(toInterval(a), now)));
  const overlaps = findOverlaps(upcoming.map(toInterval));

  return {
    upcoming,
    overlaps: overlaps.map(projectOverlap),
    headline: pickHeadline(upcoming, overlaps),
  };
}

function toInterval(a: AssistantAppointment): BusyInterval {
  return { id: a.id, title: a.experimentTitle, startAt: a.startAt, endAt: a.endAt };
}

function projectOverlap(pair: OverlapPair): AssistantBrief["overlaps"][number] {
  return {
    firstTitle: pair.first.title,
    secondTitle: pair.second.title,
    overlapLabel: `${formatDateTimeCN(pair.overlapStart)}-${formatDateTimeCN(pair.overlapEnd)}`,
  };
}

/**
 * 挑一句话。
 *
 * 优先级：撞车 > 有下一场 > 什么都没有。
 * 撞车排最前，因为这是「不处理就会爽约」的事；「下一场是什么」只是信息。
 * 空口引导语不写「你好，我是助手」——用户点进来是为了看安排，不是为了寒暄。
 */
function pickHeadline(upcoming: AssistantAppointment[], overlaps: OverlapPair[]): string {
  if (overlaps.length > 0) {
    const first = overlaps[0];
    return `你有 ${overlaps.length} 组时间撞车了，比如「${first.first.title}」和「${first.second.title}」——建议先处理这个。`;
  }
  if (upcoming.length === 0) {
    return "接下来没有安排。要不要我帮你找几个能约的实验？";
  }
  const next = upcoming[0];
  return `接下来还有 ${upcoming.length} 场实验，最近一场是 ${formatDateTimeCN(next.startAt)} 的「${next.experimentTitle}」。`;
}
