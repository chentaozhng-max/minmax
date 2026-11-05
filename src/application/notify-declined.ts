/**
 * 告知未通过（应用层）。
 *
 * 和 `inviteQualified` 是同一套骨架（取卷 → 逐条发 → 标记），差别有两处：
 *
 * 1. **只发给「已判定为未通过」且还没告知过的人。** 未算分的人不发 ——
 *    还没判定就告诉人家不合适，是错的。
 *
 * 2. **文案刻意不带分数、不用「未通过 / 不合格」这类判定词。** 这条消息是给被试看的，
 *    心理学实验的筛选不该让人觉得被否定；而且这些人以后还要招。
 *    主试可以附一句话，但默认文案本身就能独立成立。
 *
 * 发消息失败同样只计数不回滚 —— 主试看到「未通过 9 人，成功告知 8 人」比整个操作失败有用。
 */

import { ApiError } from "@/lib/http";
import { selectDeclined } from "@/domain/questionnaire";
import type { QuestionnaireRepository } from "@/domain/ports/questionnaire";
import type { NoticePort } from "@/domain/ports/notice";

export type NotifyDeclinedInput = {
  experimentId: string;
  researcherId: string;
  experimentTitle: string;
  /** 通过线；null 时只认主试手动判定的 `passed=false` */
  passScore: number | null;
  /** 附在默认文案后面的自定义一句话 */
  message?: string | null;
  now?: Date;
};

export type NotifyDeclinedDeps = {
  repo: QuestionnaireRepository;
  notices: NoticePort;
};

export type NotifyDeclinedResult = {
  /** 判定为未通过的总人数（含之前已告知的） */
  declined: number;
  /** 本次成功发出 */
  sent: number;
  /** 之前已经告知过，跳过 */
  alreadyNotified: number;
  /** 发送失败 */
  failed: number;
};

export async function notifyDeclined(
  input: NotifyDeclinedInput,
  deps: NotifyDeclinedDeps,
): Promise<NotifyDeclinedResult> {
  const questionnaire = await deps.repo.findByExperiment(input.experimentId);
  if (!questionnaire) throw new ApiError(404, "这门实验还没有问卷");

  const responses = await deps.repo.listResponses(questionnaire.id);
  const declined = selectDeclined(responses, input.passScore);
  const pending = declined.filter((r) => !r.declinedAt);

  const now = input.now ?? new Date();
  const notifiedIds: string[] = [];
  let failed = 0;

  for (const response of pending) {
    const content = buildDeclineMessage({
      title: input.experimentTitle,
      message: input.message,
    });
    const sent = await deps.notices.send({
      userId: response.subjectId,
      senderId: input.researcherId,
      experimentId: input.experimentId,
      kind: "REJECT",
      content,
      at: now,
    });
    if (sent) notifiedIds.push(response.id);
    else failed += 1;
  }

  if (notifiedIds.length > 0) await deps.repo.markDeclined(notifiedIds, now);

  return {
    declined: declined.length,
    sent: notifiedIds.length,
    alreadyNotified: declined.length - pending.length,
    failed,
  };
}

/**
 * 默认文案。
 *
 * 三句话的分工：谢谢参与 → 说明这轮不匹配（不是你的问题）→ 交代数据去向和后续可能。
 * **不写分数**：分数对没通过的人没有信息量，只会让人去比较。
 */
export function buildDeclineMessage(input: {
  title: string;
  message?: string | null;
}): string {
  const head = `【${input.title}】谢谢你的关注。这一轮的参与条件与你的情况不太匹配，暂时不能安排后续环节。`;
  const body = "你的回答已匿名保存，只用于本研究的整体分析。之后有合适的实验会再联系你。";
  const tail = input.message?.trim() ? `\n\n${input.message.trim()}` : "";
  return `${head}\n\n${body}${tail}`;
}
