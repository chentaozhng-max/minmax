/**
 * 跨实验搜索 —— 应用层用例。
 *
 * ## 它在这一层做什么
 *
 *   1. 把模型的原始条件交给领域层归一（语义词 → 时间窗），不让模型算日期
 *   2. 调端口取候选
 *   3. 用 `checkEligibility` 判资格，把「他报不了的」分出去，**但不悄悄扔掉**
 *   4. 算命中时段数 + 最近空位，交给 `rankExperiments` 排序
 *   5. 截断到 limit，并附上「有几门因为你报不了所以没列」的告知
 *
 * ## 为什么资格过滤要在这里而不是 SQL
 *
 * 资格规则（封禁 / 信誉分 / 学生认证）是领域规则，且需要被试快照。
 * 塞进 where 会让 SQL 认人，换个数据源就要重写规则，也没法单测。
 *
 * ## 为什么「被筛掉的」要单独返回
 *
 * 二二定的：默认只给能约的，但**必须告知有实验被过滤**。
 * 否则用户会觉得「系统里就这几个实验」，而实际上他想找的那门就在那儿，只是他报不了。
 * 悄悄消失比报错更糟——报错至少他知道发生了什么。
 */

import { checkEligibility } from "@/domain/credit";
import {
  normalizeCriteria,
  rankExperiments,
  type RankableExperiment,
  type SearchCriteria,
} from "@/domain/search-criteria";
import type {
  CandidateSlot,
  ExperimentCandidate,
  ExperimentSearchPort,
} from "@/domain/ports/experiment-search";

/** 用例需要的被试快照（只取资格判定用得到的字段） */
export type SearchSubject = {
  id: string;
  creditScore: number;
  studentVerified: boolean;
  bannedUntil: Date | null;
};

export type SearchExperimentsDeps = {
  search: ExperimentSearchPort;
  now?: Date;
  /**
   * 已经约了、不该再推荐的实验 id（进行中的那些）。
   *
   * 由应用层从「持久事实」传进来，而不是在 SQL 里判 —— 「什么算已经约了」
   * 是业务判断（`ACTIVE_APPOINTMENT_STATUSES`），换数据源不该重写。
   * 被排除的不进 `excluded`（那不是「你报不了」，是「你已经报了」）。
   */
  excludeExperimentIds?: string[];
};

/** 交给页面/模型的一条结果 */
export type ExperimentSearchHit = {
  id: string;
  title: string;
  location: string;
  durationMin: number;
  rewardText: string;
  researcherName: string;
  /** 命中条件的空位（时间升序）；不限时间时 = 全部空位 */
  matchedSlots: { startAt: string; endAt: string; remaining: number }[];
  /** 命中时段数，用于排序和挑文案 */
  matchedSlotCount: number;
  /** 最近的空位开始时间，供文案用 */
  nextSlotAt: string | null;
};

/** 因为资格不够而被排除的实验（要告诉用户，不能隐身） */
export type ExcludedExperiment = {
  title: string;
  /** 一句人话原因，直接来自 domain/credit.ts */
  reason: string;
};

export type ExperimentSearchResult = {
  /** 排序后、已按 limit 截断 */
  hits: ExperimentSearchHit[];
  /** 满足条件、也约得了的实验总数（截断前） */
  totalEligible: number;
  /** 被资格挡掉的（去重后，最多 3 条，其余只给数量） */
  excluded: ExcludedExperiment[];
  excludedCount: number;
  /** 一句话总结，模型可以直接拿来开场 */
  summary: string;
};

type MatchWindow = { start: Date; end: Date };

/** 内部：候选 + 排序所需的派生量 */
type RankedCandidate = ExperimentCandidate &
  RankableExperiment & {
    matchedOpenSlots: CandidateSlot[];
  };

export async function searchExperiments(
  deps: SearchExperimentsDeps,
  subject: SearchSubject,
  criteria: SearchCriteria,
): Promise<ExperimentSearchResult> {
  const now = deps.now ?? new Date();
  const query = normalizeCriteria(criteria, now);

  const candidates = await deps.search.searchCandidates(query, now);

  // 已经约过的实验直接不出现在候选里：用户不需要「你已经约了」这种推荐，
  // 也不需要看到它占着列表。这一步在资格判定之前，因为「已约」不是资格问题。
  const excludedIds = new Set(deps.excludeExperimentIds ?? []);
  const fresh = excludedIds.size > 0
    ? candidates.filter((c) => !excludedIds.has(c.id))
    : candidates;

  const eligible: ExperimentCandidate[] = [];
  const excluded: ExcludedExperiment[] = [];

  for (const c of fresh) {
    const verdict = checkEligibility(
      {
        bannedUntil: subject.bannedUntil,
        creditScore: subject.creditScore,
        studentVerified: subject.studentVerified,
        minCreditScore: c.minCreditScore,
        needsVerification: c.needsVerification,
      },
      now,
    );
    if (!verdict.ok) {
      excluded.push({ title: c.title, reason: verdict.message });
    } else {
      eligible.push(c);
    }
  }

  const ranked = rankExperiments(
    eligible.map((c) => toRankable(c, query.windows)),
    query.sortBy,
  );
  const hits = ranked.slice(0, query.limit).map(toHit);

  return {
    hits,
    totalEligible: ranked.length,
    excluded: dedupeExcluded(excluded).slice(0, 3),
    excludedCount: excluded.length,
    summary: buildSummary(hits, ranked.length, excluded.length, query.keyword !== null),
  };
}

/* ---------------- 内部：候选 → 可排序形状 ---------------- */

/** 空位是否落在任一窗口内（无窗口 = 全部算命中） */
function inWindows(slotStart: Date, windows: MatchWindow[]): boolean {
  if (windows.length === 0) return true;
  const t = slotStart.getTime();
  return windows.some((w) => t >= w.start.getTime() && t < w.end.getTime());
}

function toRankable(c: ExperimentCandidate, windows: MatchWindow[]): RankedCandidate {
  const matchedOpenSlots = c.openSlots.filter((s) => inWindows(s.startAt, windows));
  return {
    ...c,
    // 命中时段里最近的作为「最近能约」；命中为空则回落全部空位
    nextSlotAt: matchedOpenSlots[0]?.startAt ?? c.openSlots[0]?.startAt ?? null,
    matchedSlotCount: matchedOpenSlots.length,
    matchedOpenSlots,
  };
}

function toHit(c: RankedCandidate): ExperimentSearchHit {
  return {
    id: c.id,
    title: c.title,
    location: c.location,
    durationMin: c.durationMin,
    rewardText: c.rewardText,
    researcherName: c.researcherName,
    matchedSlotCount: c.matchedSlotCount,
    nextSlotAt: c.nextSlotAt ? c.nextSlotAt.toISOString() : null,
    matchedSlots: c.matchedOpenSlots.slice(0, 8).map((s) => ({
      startAt: s.startAt.toISOString(),
      endAt: s.endAt.toISOString(),
      remaining: Math.max(0, s.capacity - s.bookedCount),
    })),
  };
}

/* ---------------- 内部：排除项去重 ---------------- */

/** 同一个原因只讲一次（10 门都因为信誉分不够，说 10 遍没意义） */
function dedupeExcluded(list: ExcludedExperiment[]): ExcludedExperiment[] {
  const seen = new Set<string>();
  const out: ExcludedExperiment[] = [];
  for (const e of list) {
    if (seen.has(e.reason)) continue;
    seen.add(e.reason);
    out.push(e);
  }
  return out;
}

/* ---------------- 内部：一句话总结 ---------------- */

/**
 * 一句话总结。
 *
 * 刻意「先说找到没找到、再说被筛掉多少」——用户第一眼该知道结果。
 * 一条都没找到时给的是**怎么放宽**的建议，不是「没有结果」这种死话。
 */
function buildSummary(
  hits: ExperimentSearchHit[],
  total: number,
  excludedCount: number,
  hasKeyword: boolean,
): string {
  const tail =
    excludedCount > 0
      ? `另有 ${excludedCount} 门符合条件但你还报不了，原因我列在下面。`
      : "";

  if (hits.length === 0) {
    if (excludedCount > 0) return `没有你能报名的实验。${tail}`;
    return hasKeyword
      ? "没找到完全符合的实验。要不要放宽一下条件，比如换个时间或去掉关键词？"
      : "暂时没有可以报名的实验，晚点再来看看？";
  }

  const more =
    total > hits.length ? `（共 ${total} 门，先给你最合适的 ${hits.length} 门）` : "";
  return `找到 ${total} 门符合的实验${more}。${tail}`;
}

