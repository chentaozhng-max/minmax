/**
 * 按问卷分数邀请被试进入预约（应用层）。
 *
 * 判定「谁达标」是领域层的 selectQualified；这里只负责：
 *   1. 取问卷与答卷
 *   2. 给达标且没邀请过的人逐条发消息
 *   3. 把成功的标记成 INVITED
 *
 * 发消息失败（比如没有私信线程权限）不算整体失败 —— 单条失败跳过并计数，
 * 主试能看到「达标 8 人，成功通知 7 人」，而不是整个操作回滚。
 */

import { ApiError } from "@/lib/http";
import { selectQualified, thresholdText } from "@/domain/questionnaire";
import type { QuestionnaireRepository } from "@/domain/ports/questionnaire";
import type { NoticePort } from "@/domain/ports/notice";

export type InviteQualifiedInput = {
  experimentId: string;
  researcherId: string;
  experimentTitle: string;
  /** 线上没有时段可选，文案不能让人「去选一个时段」 */
  mode: "ONLINE" | "OFFLINE";
  /** 达标线，0–100。null 视为「不筛选」，直接拒绝 */
  passScore: number | null;
  /** 附在邀请后面的自定义一句话 */
  message?: string | null;
  now?: Date;
};

export type InviteQualifiedDeps = {
  repo: QuestionnaireRepository;
  notices: NoticePort;
};

export type InviteQualifiedResult = {
  /** 达标总人数（含之前已邀请的） */
  qualified: number;
  /** 本次成功发出 */
  sent: number;
  /** 之前已经邀请过，跳过 */
  alreadyInvited: number;
  /** 发送失败 */
  failed: number;
};

export async function inviteQualified(
  input: InviteQualifiedInput,
  deps: InviteQualifiedDeps,
): Promise<InviteQualifiedResult> {
  const questionnaire = await deps.repo.findByExperiment(input.experimentId);
  if (!questionnaire) throw new ApiError(404, "这门实验还没有问卷");
  if (input.passScore === null) throw new ApiError(400, "请先设置一个分数线");

  const responses = await deps.repo.listResponses(questionnaire.id);
  const qualified = selectQualified(responses, input.passScore);
  const pending = qualified.filter((r) => !r.invitedAt);

  const now = input.now ?? new Date();
  const invitedIds: string[] = [];
  let failed = 0;

  for (const response of pending) {
    const content = buildInviteMessage({
      title: input.experimentTitle,
      mode: input.mode,
      score: response.score,
      threshold: input.passScore,
      message: input.message,
    });
    const sent = await deps.notices.send({
      userId: response.subjectId,
      senderId: input.researcherId,
      experimentId: input.experimentId,
      kind: "INVITE",
      content,
      at: now,
    });
    if (sent) invitedIds.push(response.id);
    else failed += 1;
  }

  if (invitedIds.length > 0) await deps.repo.markInvited(invitedIds, now);

  return {
    qualified: qualified.length,
    sent: invitedIds.length,
    alreadyInvited: qualified.length - pending.length,
    failed,
  };
}

/**
 * 邀请文案。
 *
 * **线上实验没有时段可选**，所以不能让人「去选一个时段」——
 * 那样被试点进去只会看到一个没有排期的页面，以为系统坏了。
 * 线上只说「达到标准」，后续由主试发消息安排。
 */
export function buildInviteMessage(input: {
  title: string;
  mode: "ONLINE" | "OFFLINE";
  score: number | null;
  threshold: number;
  message?: string | null;
}): string {
  const scoreText = input.score === null ? "" : `你的问卷得分 ${input.score} 分，`;
  const next =
    input.mode === "ONLINE"
      ? "已达到本轮的筛选标准。主试会通过消息和你安排后续，请留意。"
      : `达到了 ${thresholdText(input.threshold)} 的筛选标准，可以进入预约了。去实验详情页选一个时段吧。`;
  const tail = input.message?.trim() ? `\n${input.message.trim()}` : "";
  return `【${input.title}】${scoreText}${next}${tail}`;
}
