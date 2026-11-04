/**
 * 提交问卷用例。
 *
 * 只做三件事：确认问卷存在且已发布 → 让领域层校验答案 → 落库。
 * 计分不在这里：它是模型调用，属于编排层（server/questionnaire-service）。
 * 用例保持纯编排，测试时不需要起模型。
 */

import { ApiError } from "@/lib/http";
import { validateAnswers } from "@/domain/questionnaire";
import type { QuestionnaireRepository } from "@/domain/ports/questionnaire";

export type SubmitQuestionnaireInput = {
  experimentId: string;
  subjectId: string;
  answers: Record<string, string | string[] | number>;
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

  const rejection = validateAnswers(
    questionnaire.questions.map((q) => ({
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
  });
}
