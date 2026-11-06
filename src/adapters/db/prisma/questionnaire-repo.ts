/**
 * Prisma 实现：QuestionnaireRepository。
 *
 * 序列化只在这里发生：数据库里的 options / answers 是 JSON 字符串，
 * 出库即解析成数组/对象，领域层看不到字符串。
 */
import { prisma } from "@/lib/prisma";
import type {
  QuestionnaireRepository,
  QuestionRecord,
  QuestionnaireRecord,
  ResponseRecord,
  SaveQuestionnaireInput,
  UpsertResponseInput,
  ScoreUpdate,
} from "@/domain/ports/questionnaire";
import type { AnswerMap, QuestionnaireDraft, ScoreItem } from "@/domain/questionnaire";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Client = {
  questionnaire: any;
  question: any;
  questionnaireResponse: any;
  $transaction: any;
};

type RawQuestion = {
  id: string;
  order: number;
  round: number;
  type: string;
  title: string;
  required: boolean;
  options: string | null;
  scaleMin: number | null;
  scaleMax: number | null;
};

type RawQuestionnaire = {
  id: string;
  experimentId: string;
  title: string;
  intro: string | null;
  status: string;
  scoringRule: string | null;
  passScore: number | null;
  questions?: RawQuestion[];
};

type RawResponse = {
  id: string;
  questionnaireId: string;
  subjectId: string;
  answers: string;
  score: number | null;
  scoreReason: string | null;
  scoreBreakdown: string | null;
  passed: boolean | null;
  status: string;
  submittedAt: Date;
  invitedAt: Date | null;
  declinedAt: Date | null;
  round: number;
  subject?: { name: string; school: string | null; studentId: string | null; studentVerified: boolean; creditScore: number };
};

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function toQuestion(row: RawQuestion): QuestionRecord {
  return {
    id: row.id,
    order: row.order,
    round: row.round ?? 1,
    type: row.type,
    title: row.title,
    required: row.required,
    options: parseJson<string[]>(row.options, []),
    scaleMin: row.scaleMin,
    scaleMax: row.scaleMax,
  };
}

function toQuestionnaire(row: RawQuestionnaire): QuestionnaireRecord {
  return {
    id: row.id,
    experimentId: row.experimentId,
    title: row.title,
    intro: row.intro ?? "",
    status: row.status === "PUBLISHED" ? "PUBLISHED" : "DRAFT",
    scoringRule: row.scoringRule,
    passScore: row.passScore,
    questions: (row.questions ?? []).map(toQuestion),
  };
}

function toResponse(row: RawResponse): ResponseRecord {
  return {
    id: row.id,
    questionnaireId: row.questionnaireId,
    subjectId: row.subjectId,
    subjectName: row.subject?.name ?? "未知被试",
    subjectSchool: row.subject?.school ?? null,
    subjectStudentId: row.subject?.studentId ?? null,
    subjectVerified: row.subject?.studentVerified ?? false,
    subjectCredit: row.subject?.creditScore ?? 0,
    answers: parseJson<AnswerMap>(row.answers, {}),
    score: row.score,
    scoreReason: row.scoreReason,
    scoreBreakdown: parseJson<ScoreItem[] | null>(row.scoreBreakdown, null),
    passed: row.passed,
    status: (row.status as ResponseRecord["status"]) ?? "SUBMITTED",
    submittedAt: row.submittedAt,
    invitedAt: row.invitedAt,
    declinedAt: row.declinedAt,
    round: row.round,
  };
}

export function makeQuestionnaireRepository(db: Client): QuestionnaireRepository {
  return {
    async findByExperiment(experimentId) {
      const row = (await db.questionnaire.findUnique({
        where: { experimentId },
        include: { questions: { orderBy: [{ round: "asc" }, { order: "asc" }] } },
      })) as RawQuestionnaire | null;
      return row ? toQuestionnaire(row) : null;
    },

    async createForExperiment(experimentId, draft: QuestionnaireDraft) {
      const row = (await db.questionnaire.create({
        data: {
          experimentId,
          title: draft.title,
          intro: draft.intro,
          questions: {
            create: draft.questions.map((q, index) => ({
              order: index,
              round: q.round ?? 1,
              type: q.type,
              title: q.title,
              required: q.required,
              options: q.options.length ? JSON.stringify(q.options) : null,
              scaleMin: q.scaleMin,
              scaleMax: q.scaleMax,
            })),
          },
        },
        include: { questions: { orderBy: [{ round: "asc" }, { order: "asc" }] } },
      })) as RawQuestionnaire;
      return toQuestionnaire(row);
    },

    async save(input: SaveQuestionnaireInput) {
      await db.$transaction(async (tx: Client) => {
        await tx.question.deleteMany({ where: { questionnaireId: input.questionnaireId } });
        await tx.questionnaire.update({
          where: { id: input.questionnaireId },
          data: {
            title: input.title,
            intro: input.intro,
            scoringRule: input.scoringRule,
            passScore: input.passScore,
            sourceText: input.sourceText ?? undefined,
            questions: {
              create: input.questions.map((q, index) => ({
                order: index,
                round: q.round ?? 1,
                type: q.type,
                title: q.title,
                required: q.required,
                options: q.options.length ? JSON.stringify(q.options) : null,
                scaleMin: q.scaleMin,
                scaleMax: q.scaleMax,
              })),
            },
          },
        });
      });
    },

    async setStatus(questionnaireId, status) {
      await db.questionnaire.update({ where: { id: questionnaireId }, data: { status } });
    },

    async updateSettings(questionnaireId, input) {
      await db.questionnaire.update({
        where: { id: questionnaireId },
        data: { scoringRule: input.scoringRule, passScore: input.passScore },
      });
    },

    async listResponses(questionnaireId) {
      const rows = (await db.questionnaireResponse.findMany({
        where: { questionnaireId },
        orderBy: [{ round: "asc" }, { score: "desc" }, { submittedAt: "asc" }],
        include: {
          subject: {
            select: { name: true, school: true, studentId: true, studentVerified: true, creditScore: true },
          },
        },
      })) as RawResponse[];
      return rows.map(toResponse);
    },

    async countResponses(questionnaireId) {
      return db.questionnaireResponse.count({ where: { questionnaireId } });
    },

    async findResponse(questionnaireId, subjectId, round) {
      const include = {
        subject: {
          select: { name: true, school: true, studentId: true, studentVerified: true, creditScore: true },
        },
      };
      // 不传 round 时取最近一轮 —— 「我填过没有」这类判断只关心最新状态
      const row = (round === undefined
        ? await db.questionnaireResponse.findFirst({
            where: { questionnaireId, subjectId },
            orderBy: { round: "desc" },
            include,
          })
        : await db.questionnaireResponse.findUnique({
            where: { questionnaireId_subjectId_round: { questionnaireId, subjectId, round } },
            include,
          })) as RawResponse | null;
      return row ? toResponse(row) : null;
    },

    async listMyResponses(questionnaireId, subjectId) {
      const rows = (await db.questionnaireResponse.findMany({
        where: { questionnaireId, subjectId },
        orderBy: { round: "asc" },
        include: {
          subject: {
            select: { name: true, school: true, studentId: true, studentVerified: true, creditScore: true },
          },
        },
      })) as RawResponse[];
      return rows.map(toResponse);
    },

    async upsertResponse(input: UpsertResponseInput) {
      const row = (await db.questionnaireResponse.upsert({
        where: {
          questionnaireId_subjectId_round: {
            questionnaireId: input.questionnaireId,
            subjectId: input.subjectId,
            round: input.round,
          },
        },
        create: {
          questionnaireId: input.questionnaireId,
          subjectId: input.subjectId,
          round: input.round,
          answers: JSON.stringify(input.answers),
          submittedAt: input.submittedAt,
        },
        update: {
          answers: JSON.stringify(input.answers),
          submittedAt: input.submittedAt,
          // 重新提交等于换了答案，旧分数（含分项）整体作废
          score: null,
          scoreReason: null,
          scoreBreakdown: null,
          passed: null,
          scoredAt: null,
          status: "SUBMITTED",
        },
        include: {
          subject: {
            select: { name: true, school: true, studentId: true, studentVerified: true, creditScore: true },
          },
        },
      })) as RawResponse;
      return toResponse(row);
    },

    async listUnscored(questionnaireId) {
      const rows = (await db.questionnaireResponse.findMany({
        where: { questionnaireId, score: null },
        orderBy: { submittedAt: "asc" },
        include: {
          subject: {
            select: { name: true, school: true, studentId: true, studentVerified: true, creditScore: true },
          },
        },
      })) as RawResponse[];
      return rows.map(toResponse);
    },

    async saveScore(responseId, update: ScoreUpdate) {
      await db.questionnaireResponse.update({
        where: { id: responseId },
        data: {
          score: update.score,
          scoreReason: update.reason,
          // 序列化只在这里做，领域层只看到数组
          scoreBreakdown: update.breakdown ? JSON.stringify(update.breakdown) : null,
          passed: update.passed,
          scoredAt: update.scoredAt,
          status: update.score === null ? "SUBMITTED" : "SCORED",
        },
      });
    },

    async markInvited(responseIds, now) {
      if (responseIds.length === 0) return 0;
      const result = (await db.questionnaireResponse.updateMany({
        where: { id: { in: responseIds } },
        data: { invitedAt: now, status: "INVITED" },
      })) as { count: number };
      return result.count;
    },

    async markDeclined(responseIds, now) {
      if (responseIds.length === 0) return 0;
      // 不动 status：答卷本身还是「已算分」，只是多了一条「已告知」的记录。
      // 改 status 会让人以为被试做了别的动作。
      const result = (await db.questionnaireResponse.updateMany({
        where: { id: { in: responseIds } },
        data: { declinedAt: now },
      })) as { count: number };
      return result.count;
    },

    async hasPassed(experimentId, subjectId) {
      const questionnaire = (await db.questionnaire.findUnique({
        where: { experimentId },
        select: { id: true, passScore: true },
      })) as { id: string; passScore: number | null } | null;

      // 没建问卷就没有门槛 —— 不能因为主试没做问卷把所有人拦死
      if (!questionnaire) return true;

      /**
       * 只看第 1 轮（基线）。
       *
       * 长程重复测量里，入选与否是基线问卷定的事；后面几天的卷是数据，
       * 不该因为某天心情差、答得松就把人踢出去。
       */
      const response = (await db.questionnaireResponse.findFirst({
        where: {
          questionnaireId: questionnaire.id,
          subjectId,
          round: 1,
        },
        select: { passed: true, score: true },
      })) as { passed: boolean | null; score: number | null } | null;

      if (!response) return false;
      if (response.passed === true) return true;
      if (response.passed === false) return false;
      if (response.score !== null && questionnaire.passScore !== null) {
        return response.score >= questionnaire.passScore;
      }
      return false;
    },
  };
}

/** 生产装配入口 */
export function makeDefaultQuestionnaireRepository(): QuestionnaireRepository {
  return makeQuestionnaireRepository(prisma as unknown as Client);
}
