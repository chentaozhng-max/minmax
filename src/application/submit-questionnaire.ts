/**
 * 提交问卷用例。
 *
 * 只做三件事：确认问卷存在且已发布 → 让领域层校验答案 → 落库。
 * 计分不在这里：它是模型调用，属于编排层（server/questionnaire-service）。
 * 用例保持纯编排，测试时不需要起模型。
 */

import { ApiError } from "@/lib/http";
import { questionsForRound, validateAnswers } from "@/domain/questionnaire";
import type { QuestionnaireRepository } from "@/domain/ports/questionnaire";

export type SubmitQuestionnaireInput = {
  experimentId: string;
  subjectId: string;
  answers: Record<string, string | string[] | number>;
  /**
   * 第几轮。非重复测量传 1。
   * 由调用方算好再传进来 —— 算轮次要看实验的窗口配置，
   * 而这里只认得问卷，不认得实验。
   */
  round: number;
  now?: Date;
};

export type SubmitQuestionnaireDeps = {
  repo: QuestionnaireRepository;
};

export async function submitQuestionnaire(
  input: SubmitQuestionnaireInput,
  deps: SubmitQuestionnaireDeps,
) {
  const questionnaire = await deps.repo.findByExperiment(input.experimentId);
  if (!questionnaire) throw new ApiError(404, "这门实验还没有问卷");
  if (questionnaire.status !== "PUBLISHED") throw new ApiError(403, "问卷还没有发布");

  // 只校验本轮的题：长程研究里第 3 天不该因为第 1 天的必答题没填而被拦。
  // 这一轮没单独设题时沿用第 1 天的题（见 questionsForRound）。
  const roundQuestions = questionsForRound(questionnaire.questions, input.round);
  if (roundQuestions.length === 0) {
    throw new ApiError(400, `第 ${input.round} 天还没有题目，请联系主试`);
  }

  const rejection = validateAnswers(
    roundQuestions.map((q) => ({
      id: q.id,
      type: q.type,
      title: q.title,
      options: q.options,
      required: q.required,
      scaleMin: q.scaleMin,
      scaleMax: q.scaleMax,
    })),
    input.answers,
  );
  if (rejection) throw new ApiError(rejection.status, rejection.message);

  return deps.repo.upsertResponse({
    questionnaireId: questionnaire.id,
    subjectId: input.subjectId,
    answers: input.answers,
    submittedAt: input.now ?? new Date(),
    round: input.round,
  });
}
