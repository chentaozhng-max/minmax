/**
 * 发布实验用例 —— 应用层。
 *
 * 这个文件只做三件事：查发布者资格 → 让领域规则判定 → 在一个事务里落库。
 * 没有一句 SQL，没有 Prisma 类型，没有 HTTP 概念（除了用 ApiError 表达拒绝）。
 *
 * ⭐ 团体实验的关键在这里：容量在这一步被 `capacityForSlot` 强制改写。
 * 主试在表单里填的 capacity 对团体实验无效 —— 一个时段就是一场团体实验，
 * 人数由 groupSize 决定。这是「派生字段」而不是「输入字段」的典型落法。
 */

import { ApiError } from "@/lib/http";
import { ExperimentStatus } from "@/domain/constants";
import {
  assertExperimentDraft,
  capacityForSlot,
  MAX_GROUP_SIZE,
  publisherBanRejection,
} from "@/domain/experiment-rules";
import { prunePastSlots } from "@/domain/experiment-draft";
import type {
  ExperimentPublishRepository,
  PublishSlotInput,
  PublishedExperiment,
} from "@/domain/ports/experiment-repo";

export type PublishExperimentInput = {
  userId: string;
  title: string;
  description: string;
  location: string;
  durationMin: number;
  rewardText: string;
  type: "INDIVIDUAL" | "GROUP";
  /** ONLINE 不排时段；OFFLINE 必须有时段 */
  mode?: "ONLINE" | "OFFLINE";
  /** 是否需要先填问卷。线上恒为 true */
  needsQuestionnaire?: boolean;
  groupSize?: number | null;
  requirements?: string | null;
  minCreditScore: number;
  needsVerification: boolean;
  signupDeadline: string;
  slots: { startAt: string; endAt: string; capacity: number }[];
  publish?: boolean;
  now?: Date;
};

export type PublishExperimentDeps = {
  repo: ExperimentPublishRepository;
  /** 发布者资格：禁期中不能发 */
  loadPublisher(id: string): Promise<{ id: string; bannedUntil: Date | null }>;
};

export type PublishResult = PublishedExperiment & { message: string };

/**
 * 发布（或存草稿）一个实验。
 *
 * 错误一律用 ApiError 抛出，让路由层不需要再翻译状态码 ——
 * 领域规则返回的 Rejection 已经带了 status。
 */
export async function publishExperiment(
  input: PublishExperimentInput,
  deps: PublishExperimentDeps,
): Promise<PublishResult> {
  const now = input.now ?? new Date();
  const mode = input.mode ?? "OFFLINE";
  // 线上实验没有时段，问卷就是实验本身 —— 不允许关掉
  const needsQuestionnaire = mode === "ONLINE" ? true : Boolean(input.needsQuestionnaire);

  const publisher = await deps.loadPublisher(input.userId);
  const banned = publisherBanRejection(publisher.bannedUntil, now);
  if (banned) throw new ApiError(banned.status, banned.message);

  const deadline = new Date(input.signupDeadline);
  const groupSize = input.type === "GROUP" ? (input.groupSize ?? 2) : null;

  // 时段先按时间排序，让领域层拿到的顺序稳定（重叠判定自己也会再排一次）。
  // 已经开始的时段在这里丢掉：留着会让「截止时间晚于现在」和「早于最早时段」
  // 同时成立不了，实验就永远发不出去。丢完一个不剩说明主试该重排时段了。
  const rawSlots = prunePastSlots(
    [...input.slots]
      .map((s) => ({
        startAt: new Date(s.startAt),
        endAt: new Date(s.endAt),
        capacity: s.capacity,
      }))
      .sort((a, b) => a.startAt.getTime() - b.startAt.getTime()),
    now,
  );

  if (input.slots.length > 0 && rawSlots.length === 0) {
    throw new ApiError(400, "所有时段都已经开始了，请重新安排时段");
  }

  const rejection = assertExperimentDraft({
    title: input.title,
    type: input.type,
    groupSize,
    signupDeadline: deadline,
    slots: rawSlots,
    now,
    mode,
  });
  if (rejection) throw new ApiError(rejection.status, rejection.message);

  // ★ 团体实验：容量由 groupSize 派生，主试填的值一律作废
  const slots: PublishSlotInput[] = rawSlots.map((s) => ({
    startAt: s.startAt,
    endAt: s.endAt,
    capacity: capacityForSlot(input.type, groupSize, s.capacity),
  }));

  const status = input.publish ? ExperimentStatus.PUBLISHED : ExperimentStatus.DRAFT;

  const created = await deps.repo.createWithSlots({
    researcherId: input.userId,
    title: input.title,
    description: input.description,
    location: input.location,
    durationMin: input.durationMin,
    rewardText: input.rewardText,
    type: input.type,
    mode,
    needsQuestionnaire,
    groupSize,
    requirements: input.requirements ?? null,
    minCreditScore: input.minCreditScore,
    needsVerification: input.needsVerification,
    signupDeadline: deadline,
    status,
    slots,
  });

  return {
    ...created,
    message: input.publish ? "实验已发布" : "已保存为草稿",
  };
}

/** 团体人数上限导出，供前端表单复用同一数字（避免前后端各写一个 30） */
export const GROUP_SIZE_LIMIT = MAX_GROUP_SIZE;
