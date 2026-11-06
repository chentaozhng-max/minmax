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
  questionsForRound,
  summarizeScores,
  type AnswerMap,
  type QuestionDraft,
} from "@/domain/questionnaire";
import { makeDefaultQuestionnaireRepository } from "@/adapters/db/prisma/questionnaire-repo";
import { makeDefaultNoticeRepository } from "@/adapters/db/prisma/notice-repo";
import { canSubmitRound, currentRound } from "@/domain/online-schedule";
import { loadOwnedBrief, loadOwnedBriefOrNull, loadExperimentBrief } from "./experiment-state";
import { submitQuestionnaire } from "@/application/submit-questionnaire";
import { scoreResponses } from "@/application/score-questionnaire";
import { inviteQualified } from "@/application/invite-qualified";
import { notifyDeclined } from "@/application/notify-declined";
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

/**
 * 这个人是否在这门实验交过答卷。
 *
 * 主试发起私信前必须过这一关 —— 否则拿到一个 userId 就能给平台上任何人发消息。
 * 范围就限定在「参加过我这门实验的人」，比「所有被试」合理得多。
 */
export async function subjectHasResponse(experimentId: string, subjectId: string): Promise<boolean> {
  const questionnaire = await repo().findByExperiment(experimentId);
  if (!questionnaire) return false;
  const response = await repo().findResponse(questionnaire.id, subjectId);
  return Boolean(response);
}

/**
 * 导出答卷的取数：先确认这门实验是本人的，再取题目与全部答卷。
 * 没建问卷返回 null —— 空表和「没有问卷」是两件事，让 route 分开处理。
 */
export async function loadResponsesForExport(experimentId: string, researcherId: string) {
  const experiment = await loadOwnedExperiment(experimentId, researcherId);
  const questionnaire = await repo().findByExperiment(experimentId);
  if (!questionnaire) return null;

  const responses = await repo().listResponses(questionnaire.id);
  return { experiment, questionnaire, responses };
}

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

/**
 * 这一次提交算第几轮。
 *
 * ANYTIME / SCHEDULED 恒为 1（只有一份卷）；WINDOW 按上海时区自然日算，
 * 并挡住「今天已经填过」「还没到开始日」「窗口已结束」三种情况。
 * 前端也会拦，但接口是公开的 —— 这里必须自己判一次。
 */
async function resolveSubmitRound(
  experiment: { mode: string; scheduleMode: string; windowStart: Date | null; repeatCount: number },
  questionnaireId: string,
  subjectId: string,
): Promise<number> {
  if (experiment.mode !== "ONLINE" || experiment.scheduleMode !== "WINDOW") return 1;

  const mine = await repo().listMyResponses(questionnaireId, subjectId);
  const check = canSubmitRound({
    windowStart: experiment.windowStart,
    repeatCount: experiment.repeatCount,
    now: new Date(),
    submittedRounds: mine.map((r) => r.round),
  });
  if (!check.allowed || check.round === null) {
    throw new ApiError(400, check.reason ?? "现在还不能填写");
  }
  return check.round;
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

  const questionnaire = await repo().findByExperiment(input.experimentId);
  if (!questionnaire) throw new ApiError(404, "这门实验还没有问卷");

  const round = await resolveSubmitRound(experiment, questionnaire.id, input.subjectId);

  const saved = await submitQuestionnaire(
    {
      experimentId: input.experimentId,
      subjectId: input.subjectId,
      answers: input.answers,
      round,
    },
    { repo: repo() },
  );

  // 计分只看本轮题：长程研究第 3 天的卷不该拿第 1 天的必答题去凑「未作答」
  const roundQuestions = questionsForRound(questionnaire.questions, round);

  const rendered = roundQuestions.map((q) => ({
    title: q.title,
    answer: formatAnswer(q, saved.answers[q.id]),
  }));

  const result = await scoreQuestionnaireResponse({
    questionnaire: {
      title: questionnaire.title,
      scoringRule: questionnaire.scoringRule,
      passScore: questionnaire.passScore,
    },
    questions: roundQuestions,
    answers: saved.answers,
    rendered,
  });

  await repo().saveScore(saved.id, {
    score: result.score,
    reason: result.reason,
    breakdown: result.breakdown,
    passed: result.score === null ? null : passState(result.score, questionnaire.passScore) === "PASS",
    scoredAt: result.score === null ? null : new Date(),
  });

  return { response: saved, score: result.score, reason: result.reason, round };
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
  mode: "ONLINE" | "OFFLINE";
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
      mode: input.mode,
      passScore: input.passScore,
      message: input.message,
    },
    { repo: questionnaires, notices: makeDefaultNoticeRepository() },
  );
}

/** 告知未通过。和邀请同一套：先把分数线同步到库里，再按当前判定发消息 */
export async function notifyDeclinedByThreshold(input: {
  experimentId: string;
  researcherId: string;
  title: string;
  passScore: number | null;
  message?: string | null;
}) {
  const questionnaires = repo();
  const exists = await questionnaires.findByExperiment(input.experimentId);
  if (exists && input.passScore !== null && exists.passScore !== input.passScore) {
    await questionnaires.updateSettings(exists.id, {
      scoringRule: exists.scoringRule,
      passScore: input.passScore,
    });
  }
  return notifyDeclined(
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
  const experiment = await loadExperimentBrief(experimentId);

  const scheduleMode = experiment?.mode === "ONLINE" ? experiment.scheduleMode : "SCHEDULED";
  const isWindow = scheduleMode === "WINDOW";

  if (!questionnaire) {
    return {
      published: false,
      submitted: false,
      passed: false,
      declined: false,
      invited: false,
      title: "",
      scheduleMode,
      repeatCount: 1,
      currentRound: null as number | null,
      doneRounds: 0,
      submittedToday: false,
      windowStartsAt: null as Date | null,
    };
  }

  const response = subjectId ? await repo().findResponse(questionnaire.id, subjectId) : null;
  const passed = subjectId ? await repo().hasPassed(experimentId, subjectId) : false;

  const mine = subjectId && isWindow ? await repo().listMyResponses(questionnaire.id, subjectId) : [];
  const round = isWindow
    ? currentRound(experiment?.windowStart ?? null, experiment?.repeatCount ?? 1, new Date())
    : null;
  const doneRounds = mine.map((r) => r.round);

  return {
    published: questionnaire.status === "PUBLISHED",
    submitted: Boolean(response),
    passed,
    /**
     * 主试已经发消息告知「本轮不匹配」。
     * 这个状态必须单独拿出来 —— 否则详情页会继续写「等待主试筛选」，
     * 而被试刚收到的消息说的是「暂时不能安排后续环节」，两句话对不上。
     */
    declined: Boolean(response?.declinedAt),
    /** 主试已经发过「通过」的邀请消息；界面上只有这时才告诉被试「入选」 */
    invited: Boolean(response?.invitedAt),
    title: questionnaire.title,
    // 长程重复测量：今天第几天、总共几天、已经填了几天
    scheduleMode,
    repeatCount: isWindow ? (experiment?.repeatCount ?? 1) : 1,
    currentRound: round,
    doneRounds: doneRounds.length,
    submittedToday: round !== null && doneRounds.includes(round),
    windowStartsAt: isWindow ? (experiment?.windowStart ?? null) : null,
  };
}

/**
 * 填写页要的：本轮题目 + 我在本轮的答卷（有则只读回放）。
 *
 * 长程重复测量时**只给当前这一天的题** —— 把 7 天的题全渲染出来，
 * 被试会以为要一次填完。
 */
export async function loadQuestionnaireForSubject(experimentId: string, subjectId: string) {
  const questionnaire = await repo().findByExperiment(experimentId);
  if (!questionnaire) {
    return { questionnaire: null, mine: null, round: 1 as number | null, repeatCount: 1, doneRounds: 0 };
  }

  const experiment = await loadExperimentBrief(experimentId);
  const isWindow = experiment?.mode === "ONLINE" && experiment.scheduleMode === "WINDOW";

  let round: number | null = 1;
  let doneRounds = 0;
  if (isWindow) {
    const mineRows = await repo().listMyResponses(questionnaire.id, subjectId);
    doneRounds = mineRows.length;
    round = currentRound(experiment?.windowStart ?? null, experiment?.repeatCount ?? 1, new Date());
  }

  // 窗口外（round = null）不取题：页面会显示「现在不能填写」，别让人填一半被服务端拒
  const roundQuestions = round === null ? [] : questionsForRound(questionnaire.questions, round);
  const mine = round === null ? null : await repo().findResponse(questionnaire.id, subjectId, round);

  return {
    questionnaire: { ...questionnaire, questions: roundQuestions },
    mine,
    round,
    repeatCount: isWindow ? (experiment?.repeatCount ?? 1) : 1,
    doneRounds,
  };
}
