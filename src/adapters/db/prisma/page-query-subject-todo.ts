/**
 * Prisma 实现：被试「我的」页的待办查询（目前只有「待填问卷」）。
 *
 * 职责边界：**只负责把候选捞全，不下判断**。
 * 「现在该填哪几份」由 `domain/questionnaire-todo.ts` 判 ——
 * 那条规则里有「填过昨天仍要填今天」「窗口没开不算待办」这类非 SQL 判断，
 * 一旦写进 where，就只能靠造库测，且下次改规则必然改两处。
 *
 * 因此这里的 where 刻意宽松：只要「实验在招募 + 问卷已发布」（候选全集），
 * 我这个账号交过哪些轮次单独查，两者交给纯函数去对。
 */

import type {
  SubjectQuestionnaireTodo,
  SubjectTodoQuery,
} from "@/domain/ports/page-queries";
import type { SubjectTodoClientLike } from "./types";

type RawCandidate = {
  id: string;
  title: string;
  experiment: {
    id: string;
    title: string;
    rewardText: string;
    durationMin: number;
    mode: string;
    scheduleMode: string;
    windowStart: Date | null;
    repeatCount: number;
    openAnytime: boolean;
    signupDeadline: Date;
    researcher: { name: string };
  };
};

export function makeSubjectTodoQuery(db: SubjectTodoClientLike): SubjectTodoQuery {
  return {
    async listQuestionnaireCandidatesForSubject() {
      const raw = (await db.questionnaire.findMany({
        where: {
          status: "PUBLISHED",
          experiment: { status: "PUBLISHED", needsQuestionnaire: true },
        },
        include: {
          experiment: { include: { researcher: true } },
        },
        orderBy: { experiment: { signupDeadline: "asc" } },
      })) as RawCandidate[];

      return raw.map(
        (q): SubjectQuestionnaireTodo => ({
          experimentId: q.experiment.id,
          experimentTitle: q.experiment.title,
          questionnaireId: q.id,
          questionnaireTitle: q.title,
          rewardText: q.experiment.rewardText,
          durationMin: q.experiment.durationMin,
          researcherName: q.experiment.researcher.name,
          // 线下实验恒为 SCHEDULED（schema 注释），ANYTIME 只对线上有意义
          scheduleMode:
            q.experiment.mode === "ONLINE" ? q.experiment.scheduleMode : "SCHEDULED",
          windowStart: q.experiment.windowStart,
          repeatCount: q.experiment.repeatCount,
          openAnytime: q.experiment.openAnytime,
          signupDeadline: q.experiment.signupDeadline,
        }),
      );
    },

    async listMyResponseRounds(subjectId) {
      const raw = (await db.questionnaireResponse.findMany({
        where: { subjectId },
        select: { questionnaireId: true, round: true },
      })) as Array<{ questionnaireId: string; round: number }>;
      return raw;
    },
  };
}
