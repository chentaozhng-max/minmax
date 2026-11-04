/**
 * 实验发布相关的仓储端口。
 *
 * 只有「发布一个实验（含它的时段）」这一件事需要的能力：
 * 一次性把 Experiment 和它的 Slot[] 落库。
 *
 * 注意：这里没有「查实验」「改实验」——那些用途的形状不一样，
 * 按需再加，不预先设计（见 layered-arch-verify-and-extend 的铁律）。
 */

import type { ExperimentStatus, ExperimentType } from "@/domain/constants";

export type PublishSlotInput = {
  startAt: Date;
  endAt: Date;
  /** 团体实验下这个值必须已经由 capacityForSlot 算好，适配器不再判断 */
  capacity: number;
};

export type PublishExperimentInput = {
  researcherId: string;
  title: string;
  description: string;
  location: string;
  durationMin: number;
  rewardText: string;
  type: ExperimentType;
  /** ONLINE 的实验没有时段 */
  mode: "ONLINE" | "OFFLINE";
  needsQuestionnaire: boolean;
  /** 线上实验：不设截止时间，signupDeadline 存的是远期哨兵值 */
  openAnytime: boolean;
  /** 一对一固定 null */
  groupSize: number | null;
  requirements: string | null;
  minCreditScore: number;
  needsVerification: boolean;
  signupDeadline: Date;
  status: ExperimentStatus;
  slots: PublishSlotInput[];
};

export type PublishedExperiment = {
  id: string;
  status: ExperimentStatus;
};

export interface ExperimentPublishRepository {
  /**
   * 建实验 + 批量建时段，必须在**同一个事务**里。
   *
   * 否则实验建成功、时段失败会留下一个「没有任何时段」的实验 —— 被试点进去
   * 只能看到空列表，而主试以为发布成功了。
   */
  createWithSlots(input: PublishExperimentInput): Promise<PublishedExperiment>;
}
