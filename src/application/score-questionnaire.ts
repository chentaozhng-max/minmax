/**
 * 给答卷计分（应用层）。
 *
 * 打分本身是模型的事，但「给谁打、按什么顺序打、打完存哪」是业务流程。
 * 因此这里把打分函数作为依赖注入：真实环境用 server 里的 agent，
 * 测试里塞一个同步函数就能验完整链路，不需要联网。
 */

import { formatAnswer, passState } from "@/domain/questionnaire";
import type { QuestionnaireRepository, ResponseRecord } from "@/domain/ports/questionnaire";

export type ResponseScorer = (input: {
  questionnaire: { title: string; scoringRule: string | null; passScore: number | null };
  questions: { id: string; type: string; title: string; options: string[] }[];
  answers: Record<string, string | string[] | number>;
  rendered: { title: string; answer: string }[];
}) => Promise<{ score: number | null; reason: string }>;

export type ScoreRunResult = {
  total: number;
  scored: number;
  failed: number;
  average: number | null;
};

export async function scoreResponses(
  input: {
    experimentId: string;
    /** true = 只处理还没分的；false = 全部重算 */
    onlyUnscored: boolean;
    now?: Date;
  },
  deps: {
    repo: QuestionnaireRepository;
    scorer: ResponseScorer;
  },
): Promise<ScoreRunResult> {
  const questionnaire = await deps.repo.findByExperiment(input.experimentId);
  if (!questionnaire) return { total: 0, scored: 0, failed: 0, average: null };

  const list: ResponseRecord[] = input.onlyUnscored
    ? await deps.repo.listUnscored(questionnaire.id)
    : await deps.repo.listResponses(questionnaire.id);

  const now = input.now ?? new Date();
  let scored = 0;
  let failed = 0;
  const values: number[] = [];

  for (const response of list) {
    const rendered = questionnaire.questions.map((q) => ({
      title: q.title,
      answer: formatAnswer(
        { id: q.id, type: q.type, title: q.title, options: q.options },
        response.answers[q.id],
      ),
    }));

    const result = await deps.scorer({
      questionnaire: {
        title: questionnaire.title,
        scoringRule: questionnaire.scoringRule,
        passScore: questionnaire.passScore,
      },
      questions: questionnaire.questions.map((q) => ({
        id: q.id,
        type: q.type,
        title: q.title,
        options: q.options,
      })),
      answers: response.answers,
      rendered,
    });

    await deps.repo.saveScore(response.id, {
      score: result.score,
      reason: result.reason,
      // 有分数才判通过；没有分数保持未知，等人工
      passed: result.score === null ? null : passState(result.score, questionnaire.passScore) === "PASS",
      scoredAt: result.score === null ? null : now,
    });

    if (result.score === null) failed += 1;
    else {
      scored += 1;
      values.push(result.score);
    }
  }

  return {
    total: list.length,
    scored,
    failed,
    average: values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null,
  };
}
