/**
 * 「我还欠哪几份问卷」—— 纯函数，不碰 IO。
 *
 * 为什么单独拿出来：「待填问卷」这个数字有四个容易搞错的地方，
 * 而它们都不是一句 SQL 能顺手表达的：
 *   1. 长程重复测量（WINDOW）**填过昨天不等于今天不用填** —— 判据是「这一轮填了没有」，
 *      用 `exists(我的答卷)` 会把第 2 天该填的漏掉
 *   2. 窗口没开 / 已过期时不算待办 —— 被试点进去只会看到「还没开始」
 *   3. 报名已截止的不算待办 —— 交上去主试也不收了
 *   4. 一次性问卷交过一次就永远消失（哪怕被拒）
 *
 * 适配层只把候选和「我交过哪些轮次」捞出来，判据全在这里，
 * 于是这四条可以毫秒级单测，不必造库、不必起服务。
 */

import { currentRound, OnlineScheduleMode } from "./online-schedule";

/** 适配层捞出来的候选（已过滤：实验已发布、问卷已发布、确实需要问卷） */
export type QuestionnaireTodoCandidate = {
  experimentId: string;
  experimentTitle: string;
  questionnaireId: string;
  questionnaireTitle: string;
  rewardText: string;
  durationMin: number;
  researcherName: string;
  /** ANYTIME | WINDOW | SCHEDULED */
  scheduleMode: string;
  windowStart: Date | null;
  repeatCount: number;
  /** 线上「全时段可填写」为 true：signupDeadline 是远期哨兵值，不参与判断 */
  openAnytime: boolean;
  signupDeadline: Date;
};

/** 我对某份问卷已经交过的轮次 */
export type MyResponseBrief = {
  questionnaireId: string;
  round: number;
};

/**
 * 从候选里挑出「现在就能填、且还没填」的那些。
 *
 * 顺序原样保留（适配层按截止时间升序取），不在这里重排 ——
 * 领域层排序会被「适配层换了 orderBy」悄悄改掉，反过来也一样。
 */
export function pickPendingQuestionnaires(
  candidates: QuestionnaireTodoCandidate[],
  myResponses: MyResponseBrief[],
  now: Date,
): QuestionnaireTodoCandidate[] {
  const filledRound = new Set(myResponses.map((r) => `${r.questionnaireId}#${r.round}`));
  const everSubmitted = new Set(myResponses.map((r) => r.questionnaireId));

  return candidates.filter((c) => {
    // 截止时间先挡：过期的交了也白交
    if (!c.openAnytime && c.signupDeadline.getTime() <= now.getTime()) return false;

    if (c.scheduleMode !== OnlineScheduleMode.WINDOW) {
      // 一次性问卷：交过一次就永远不用再交（哪怕没通过筛选）
      return !everSubmitted.has(c.questionnaireId);
    }
    const round = currentRound(c.windowStart, c.repeatCount, now);
    // 不在窗口内（没开始 / 已结束）：点了也填不了，不算待办
    if (round === null) return false;
    return !filledRound.has(`${c.questionnaireId}#${round}`);
  });
}

/** 这份问卷「现在」该填第几轮；非 WINDOW 恒为 1（页面文案用） */
export function roundToFill(c: QuestionnaireTodoCandidate, now: Date): number {
  if (c.scheduleMode !== OnlineScheduleMode.WINDOW) return 1;
  return currentRound(c.windowStart, c.repeatCount, now) ?? 1;
}
