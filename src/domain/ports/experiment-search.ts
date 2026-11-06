/**
 * 跨实验搜索 —— 领域层端口。
 *
 * ## 与 queries.ts / page-queries.ts 的区别
 *
 * queries.ts 是「为了**一门**实验排期」，入参一定有 experimentId。
 * 这里的场景恰好相反：**还不知道是哪门实验**，先按条件找出候选。
 * 所以不能复用，也不能给它塞一个可选的 experimentId。
 *
 * ## 为什么端口返回的是「原始候选」而不是「已排好序的答案」
 *
 * 资格判定（信誉分/认证/禁期）与排序都是**领域规则**，不是数据访问细节。
 * 适配器只负责「把符合条件的行取出来」，判断留给 application 层调用领域函数做。
 * 这样换个数据源（缓存、外部 API）时规则不用重写，规则也能脱离数据库单测。
 */

import type { ExperimentType } from "@/domain/constants";

/** 候选实验里的一个还空着的时段（只保留未来、有余额的） */
export type CandidateSlot = {
  /**
   * 时段 id。
   *
   * 加它是因为门厅的卡片要能「点进房间并预选这一段」—— 只靠 startAt
   * 反查会在同一时刻有多个时段（不同实验/分组）时选错，而且要多打一次库。
   */
  id: string;
  startAt: Date;
  endAt: Date;
  capacity: number;
  bookedCount: number;
};

/** 搜索出来的一门候选实验 */
export type ExperimentCandidate = {
  id: string;
  title: string;
  location: string;
  /**
   * 线上 / 线下。
   *
   * 线上实验**没有「到场时间」这回事**：ANYTIME 随时可填、WINDOW 按天算。
   * 少了这个字段，上层会把「0 个时段」当成「还没出排期」讲给用户听（踩过）。
   */
  mode: "ONLINE" | "OFFLINE";
  /**
   * 线上实验的时间形态。`SCHEDULED` 也有场次可挑，只有 ANYTIME / WINDOW 才是
   * 「点进去就能做」—— 上层靠它决定是列时段还是写「随时可填」。
   */
  scheduleMode: "ANYTIME" | "WINDOW" | "SCHEDULED";
  durationMin: number;
  rewardText: string;
  type: ExperimentType;
  groupSize: number | null;
  minCreditScore: number;
  needsVerification: boolean;
  signupDeadline: Date;
  researcherName: string;
  /** 未来还有余额的时段，按 startAt 升序；空数组 = 这门实验暂时约不了，但仍会返回（由上层决定怎么讲） */
  openSlots: CandidateSlot[];
};

/** 送进数据层的查询条件（已由 domain/search-criteria 归一，这里不再做语义解析） */
export type ExperimentSearchQuery = {
  /** 关键词，null = 不限 */
  keyword: string | null;
  /** 时间窗（交集），空数组 = 不限时间 */
  windows: { start: Date; end: Date }[];
  /** 时长上限（分钟），null = 不限 */
  maxDurationMin: number | null;
};

export interface ExperimentSearchPort {
  /**
   * 取候选实验。
   *
   * 约定：
   *   1. 只返回 `status = PUBLISHED` 且报名未截止的
   *   2. `openSlots` 只含**开始时间晚于 now** 且 `bookedCount < capacity` 的时段
   *   3. 传了 `windows` 时按「至少有一个空位时段落在窗内」过滤（SQL 层用 slots.some），
   *      但返回的 `openSlots` 仍是**全部**未来空位——用户看到命中时段的同时也想看看这门实验别的时间
   */
  searchCandidates(query: ExperimentSearchQuery, now: Date): Promise<ExperimentCandidate[]>;
}
