/**
 * 问卷编排层：把领域规则、Prisma 仓储、模型 agent 接起来。
 *
 * 页面与 route handler 只调这里的函数，不直接碰仓储 —— 与 server/experiments.ts 同一路数。
 * 所有「能不能做」的判断都往下压：归属校验在这里，业务规则在 domain。
 */
import { ApiError } from "@/lib/http";
import { extractDocumentText } from "@/adapters/files/document-text";
import {
  assertQuestionnaireReady,
  formatAnswer,
  passState,
  summarizeScores,
  type AnswerMap,
  type QuestionDraft,
} from "@/domain/questionnaire";
import { makeDefaultQuestionnaireRepository } from "@/adapters/db/prisma/questionnaire-repo";
import { makeDefaultNoticeRepository } from "@/adapters/db/prisma/notice-repo";
import { loadOwnedBrief, loadOwnedBriefOrNull, loadExperimentBrief } from "./experiment-state";
import { submitQuestionnaire } from "@/application/submit-questionnaire";
import { scoreResponses } from "@/application/score-questionnaire";
import { inviteQualified } from "@/application/invite-qualified";
import { generateQuestionnaireDraft, scoreQuestionnaireResponse, suggestPassScore } from "./questionnaire-agent";
import type { QuestionnaireRecord, ResponseRecord } from "@/domain/ports/questionnaire";

const repo = () => makeDefaultQuestionnaireRepository();

export type OwnedExperiment = {
  id: string;
  title: string;
  mode: "ONLINE" | "OFFLINE";
  needsQuestionnaire: boolean;
  status: string;
};

/** 取实验并确认是当前主试的 —— 问卷是实验的一部分，不能让别的账号改 */
export async function loadOwnedExperiment(
  experimentId: string,
  researcherId: string,
): Promise<OwnedExperiment> {
  const experiment = await loadOwnedBrief(experimentId, researcherId);
  return {
    id: experiment.id,
    title: experiment.title,
    mode: experiment.mode === "ONLINE" ? "ONLINE" : "OFFLINE",
    needsQuestionnaire: experiment.needsQuestionnaire,
    status: experiment.status,
  };
}

export async function getQuestionnaire(experimentId: string): Promise<QuestionnaireRecord | null> {
  return repo().findByExperiment(experimentId);
}

/** 没有就建一份空的（主试点进编辑器时不该看到 404） */
export async function ensureQuestionnaire(experimentId: string, title: string): Promise<QuestionnaireRecord> {
  const questionnaires = repo();
  const existing = await questionnaires.findByExperiment(experimentId);
  if (existing) return existing;
  return questionnaires.createForExperiment(experimentId, {
    title: `${title} · 参与问卷`,
    intro: "请按你的真实情况填写，结果只用于实验筛选。",
    questions: [],
  });
}

export type SaveQuestionnairePayload = {
  title: string;
  intro: string;
  questions: QuestionDraft[];
  scoringRule: string | null;
  passScore: number | null;
  sourceText?: string | null;
  /** true 时同时发布 */
  publish?: boolean;
};

export async function saveQuestionnaire(
  experimentId: string,
  title: string,
  payload: SaveQuestionnairePayload,
): Promise<QuestionnaireRecord> {
  const questionnaires = repo();
  const questionnaire = await ensureQuestionnaire(experimentId, title);

  if (payload.publish) {
    const rejection = assertQuestionnaireReady({
      title: payload.title,
      intro: payload.intro,
      questions: payload.questions,
    });
    if (rejection) throw new ApiError(rejection.status, rejection.message);
  }

  await questionnaires.save({
    questionnaireId: questionnaire.id,
    title: payload.title,
    intro: payload.intro,
    questions: payload.questions,
    scoringRule: payload.scoringRule,
    passScore: payload.passScore,
    sourceText: payload.sourceText ?? null,
  });

  if (payload.publish) await questionnaires.setStatus(questionnaire.id, "PUBLISHED");

  const updated = await questionnaires.findByExperiment(experimentId);
  if (!updated) throw new ApiError(500, "保存后读取失败");
  return updated;
}

export async function publishQuestionnaire(experimentId: string, publish: boolean) {
  const questionnaire = await repo().findByExperiment(experimentId);
  if (!questionnaire) throw new ApiError(404, "还没有问卷");
  if (publish) {
    const rejection = assertQuestionnaireReady(questionnaire);
    if (rejection) throw new ApiError(rejection.status, rejection.message);
  }
  await repo().setStatus(questionnaire.id, publish ? "PUBLISHED" : "DRAFT");
}

/* ---------------- 主试编辑器 ---------------- */

/**
 * 编辑器页要的一整包：实验（校验归属）+ 问卷（没有就建空的）+ 已有答卷数。
 *
 * 三者一次给齐，页面里就不用再查库 —— 也顺手把 prisma 挡在适配层里。
 */
export async function loadQuestionnaireEditor(experimentId: string, researcherId: string) {
  const experiment = await loadOwnedBriefOrNull(experimentId, researcherId);
  if (!experiment) return null;

  const questionnaire = await ensureQuestionnaire(experimentId, experiment.title);
  const responseCount = await repo().countResponses(questionnaire.id);
  return { experiment, questionnaire, responseCount };
}

/* ---------------- 生成 ---------------- */

export async function generateQuestionnaire(input: {
  experimentId: string;
  title: string;
  text?: string;
  brief?: string;
  previous?: { title: string; intro: string; questions: QuestionDraft[] } | null;
}) {
  return generateQuestionnaireDraft({
    text: input.text,
    brief: input.brief,
    title: `${input.title} · 参与问卷`,
    previous: input.previous ?? null,
  });
}

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * 上传文件 → 解析成文本 → 让模型出题。
 *
 * **不落库**：返回的是一份草稿，主试在编辑器里改完再保存。
 * 这样解析错、题目跑偏都不会污染已有问卷。
 */
export async function importQuestionnaireDocument(input: {
  experimentId: string;
  researcherId: string;
  form: FormData;
}) {
  const experiment = await loadOwnedExperiment(input.experimentId, input.researcherId);

  const rawBrief = input.form.get("brief");
  const brief = typeof rawBrief === "string" ? rawBrief.slice(0, 2000) : "";
  const file = input.form.get("file");

  let text = "";
  let fileName = "";

  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_UPLOAD_BYTES) throw new ApiError(413, "文件太大了，请控制在 10 MB 以内");
    fileName = file.name;
    const buffer = new Uint8Array(await file.arrayBuffer());
    try {
      const parsed = await extractDocumentText({ name: file.name, buffer });
      text = parsed.text;
    } catch (error) {
      throw new ApiError(400, error instanceof Error ? error.message : "文件解析失败");
    }
    if (!text.trim()) {
      throw new ApiError(400, "这个文件里没有读到文字，可能是扫描件，请换一份或直接把题目粘进来");
    }
  }

  if (!text && !brief) throw new ApiError(400, "请上传一份文件，或写一句你想问什么");

  const result = await generateQuestionnaire({
    experimentId: input.experimentId,
    title: experiment.title,
    text,
    brief,
  });

  return { ...result, sourceText: text, fileName, chars: text.length };
}

/* ---------------- 答卷 ---------------- */

export type ResearcherResponseView = ResponseRecord & {
  passState: "PASS" | "FAIL" | "UNKNOWN";
  answerRows: { title: string; answer: string }[];
};

export async function listResponses(experimentId: string): Promise<{
  questionnaire: QuestionnaireRecord | null;
  responses: ResearcherResponseView[];
  summary: ReturnType<typeof summarizeScores>;
}> {
  const questionnaire = await repo().findByExperiment(experimentId);
  if (!questionnaire) {
    return {
      questionnaire: null,
      responses: [],
      summary: summarizeScores([], null),
    };
  }
  const rows = await repo().listResponses(questionnaire.id);
  const responses = rows.map((row) => ({
    ...row,
    passState: passState(row.score, questionnaire.passScore),
    answerRows: questionnaire.questions.map((q) => ({
      title: q.title,
      answer: formatAnswer(q, row.answers[q.id]),
    })),
  }));
  return {
    questionnaire,
    responses,
    summary: summarizeScores(responses, questionnaire.passScore),
  };
}

export async function submitForSubject(input: {
  experimentId: string;
  subjectId: string;
  answers: AnswerMap;
}) {
  // 下线的实验不该再收新答卷：入口虽然会拦，但接口是公开的
  const experiment = await loadExperimentBrief(input.experimentId);
  if (!experiment) throw new ApiError(404, "实验不存在");
  if (experiment.status !== "PUBLISHED") throw new ApiError(400, "实验已下线");

  const saved = await submitQuestionnaire(
    {
      experimentId: input.experimentId,
      subjectId: input.subjectId,
      answers: input.answers,
    },
    { repo: repo() },
  );

  const questionnaire = await repo().findByExperiment(input.experimentId);
  if (!questionnaire) return { response: saved, score: null as number | null };

  const rendered = questionnaire.questions.map((q) => ({
    title: q.title,
    answer: formatAnswer(q, saved.answers[q.id]),
  }));

  const result = await scoreQuestionnaireResponse({
    questionnaire: {
      title: questionnaire.title,
      scoringRule: questionnaire.scoringRule,
      passScore: questionnaire.passScore,
    },
    questions: questionnaire.questions,
    answers: saved.answers,
    rendered,
  });

  await repo().saveScore(saved.id, {
    score: result.score,
    reason: result.reason,
    passed: result.score === null ? null : passState(result.score, questionnaire.passScore) === "PASS",
    scoredAt: result.score === null ? null : new Date(),
  });

  return { response: saved, score: result.score, reason: result.reason };
}

export async function rescoreAll(experimentId: string) {
  return scoreResponses(
    { experimentId, onlyUnscored: false },
    {
      repo: repo(),
      scorer: (input) => scoreQuestionnaireResponse(input),
    },
  );
}

export async function inviteByThreshold(input: {
  experimentId: string;
  researcherId: string;
  title: string;
  passScore: number | null;
  message?: string | null;
}) {
  const questionnaires = repo();
  const questionnaire = questionnaires.findByExperiment(input.experimentId);
  const exists = await questionnaire;
  if (exists && input.passScore !== null && exists.passScore !== input.passScore) {
    await questionnaires.updateSettings(exists.id, {
      scoringRule: exists.scoringRule,
      passScore: input.passScore,
    });
  }
  return inviteQualified(
    {
      experimentId: input.experimentId,
      researcherId: input.researcherId,
      experimentTitle: input.title,
      passScore: input.passScore,
      message: input.message,
    },
    { repo: questionnaires, notices: makeDefaultNoticeRepository() },
  );
}

export async function suggestThreshold(input: {
  experimentId: string;
  goal: string;
}) {
  const questionnaire = await repo().findByExperiment(input.experimentId);
  if (!questionnaire) throw new ApiError(404, "还没有问卷");
  const responses = await repo().listResponses(questionnaire.id);
  const scores = responses.map((r) => r.score).filter((s): s is number => typeof s === "number");
  return suggestPassScore({ goal: input.goal, scores, currentPassScore: questionnaire.passScore });
}

/** 报名门槛：需要问卷时，只有通过筛选的人能约 */
export async function hasPassedQuestionnaire(experimentId: string, subjectId: string): Promise<boolean> {
  return repo().hasPassed(experimentId, subjectId);
}

/**
 * 被试端详情页要的三个状态：问卷有没有发布、我填过没有、我过了没有。
 *
 * 分开返回而不是合成一个布尔：三种「不能预约」的原因，页面要显示不同的话。
 */
export async function getSubjectState(experimentId: string, subjectId: string | null) {
  const questionnaire = await repo().findByExperiment(experimentId);
  if (!questionnaire) return { published: false, submitted: false, passed: false, title: "" };

  const response = subjectId ? await repo().findResponse(questionnaire.id, subjectId) : null;
  const passed = subjectId ? await repo().hasPassed(experimentId, subjectId) : false;
  return {
    published: questionnaire.status === "PUBLISHED",
    submitted: Boolean(response),
    passed,
    title: questionnaire.title,
  };
}

/** 填写页要的：题目 + 我之前那份答卷（有则显示只读回放） */
export async function loadQuestionnaireForSubject(experimentId: string, subjectId: string) {
  const questionnaire = await repo().findByExperiment(experimentId);
  if (!questionnaire) return { questionnaire: null, mine: null };
  const mine = await repo().findResponse(questionnaire.id, subjectId);
  return { questionnaire, mine };
}
