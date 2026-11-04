/**
 * 实验状态的编排：归属校验 + 上下架复算。
 *
 * 页面与 route handler 调这里，不直接碰 prisma —— 与 server/experiments.ts 同一路数，
 * 区别是这里只管「状态」这一件事，不做详情映射。
 */
import { ApiError } from "@/lib/http";
import { assertExperimentDraft } from "@/domain/experiment-rules";
import type { ExperimentType } from "@/domain/constants";
import {
  findExperimentBrief,
  findExperimentForPublish,
  setExperimentStatus,
  type ExperimentBrief,
} from "@/adapters/db/prisma/experiment-brief-repo";

export type { ExperimentBrief };

/** 被试端也用它 —— 读的是公开字段，不含 researcherId 之外的隐私 */
export async function loadExperimentBrief(id: string): Promise<ExperimentBrief | null> {
  return findExperimentBrief(id);
}

export async function loadOwnedBrief(experimentId: string, researcherId: string): Promise<ExperimentBrief> {
  const experiment = await findExperimentBrief(experimentId);
  if (!experiment) throw new ApiError(404, "实验不存在");
  if (experiment.researcherId !== researcherId) throw new ApiError(403, "这不是你的实验");
  return experiment;
}

/** 页面用：不是自己的实验就返回 null，交给调用方 notFound() */
export async function loadOwnedBriefOrNull(
  experimentId: string,
  researcherId: string,
): Promise<ExperimentBrief | null> {
  const experiment = await findExperimentBrief(experimentId);
  if (!experiment || experiment.researcherId !== researcherId) return null;
  return experiment;
}

/**
 * 上架 / 下架。
 *
 * 与发布表单不同：这里是「实验已经存在，只改状态」，所以要按库里的真实数据
 * 再跑一遍领域校验 —— 时段可能已经过期、问卷可能还没发布。
 */
export async function setExperimentPublished(input: {
  experimentId: string;
  researcherId: string;
  publish: boolean;
}) {
  const experiment = await findExperimentForPublish(input.experimentId);
  if (!experiment) throw new ApiError(404, "实验不存在");
  if (experiment.researcherId !== input.researcherId) throw new ApiError(403, "这不是你的实验");

  if (input.publish) {
    if (experiment.needsQuestionnaire && experiment.questionnaireStatus !== "PUBLISHED") {
      throw new ApiError(400, "问卷还没发布，先保存并发布问卷");
    }

    const rejection = assertExperimentDraft({
      title: experiment.title,
      type: experiment.type as ExperimentType,
      groupSize: experiment.groupSize,
      signupDeadline: experiment.signupDeadline,
      slots: experiment.slots,
      now: new Date(),
      mode: experiment.mode === "ONLINE" ? "ONLINE" : "OFFLINE",
    });
    if (rejection) throw new ApiError(rejection.status, rejection.message);
  }

  return setExperimentStatus(input.experimentId, input.publish ? "PUBLISHED" : "DRAFT");
}
