/**
 * 问卷仓储端口 —— 领域层对「问卷存在哪」的唯一认知。
 *
 * 题目选项与答案都是 JSON 字符串存库（SQLite 没有 Json 字段），
 * 但**领域层只看到数组和对象**：序列化在适配器里做，规则层不需要知道存储格式。
 */

import type {
  AnswerMap,
  QuestionDraft,
  QuestionnaireDraft,
  ScoreItem,
} from "@/domain/questionnaire";

export type QuestionRecord = {
  id: string;
  order: number;
  /** 属于第几轮（长程重复测量）。非重复测量恒为 1 */
  round: number;
  type: string;
  title: string;
  required: boolean;
  options: string[];
  scaleMin: number | null;
  scaleMax: number | null;
};

export type QuestionnaireRecord = {
  id: string;
  experimentId: string;
  title: string;
  intro: string;
  status: "DRAFT" | "PUBLISHED";
  scoringRule: string | null;
  passScore: number | null;
  questions: QuestionRecord[];
};

export type ResponseRecord = {
  id: string;
  questionnaireId: string;
  subjectId: string;
  subjectName: string;
  subjectSchool: string | null;
  /** 导出答卷时和日程表口径一致：给学号，不给手机号（问卷承诺匿名） */
  subjectStudentId: string | null;
  subjectVerified: boolean;
  subjectCredit: number;
  answers: AnswerMap;
  score: number | null;
  scoreReason: string | null;
  /** 分项计分；null = 规则版兜底或还没算分 */
  scoreBreakdown: ScoreItem[] | null;
  passed: boolean | null;
  status: "SUBMITTED" | "SCORED" | "INVITED";
  submittedAt: Date;
  invitedAt: Date | null;
  /** 已告知「本轮不匹配」的时间；和 invitedAt 互斥 */
  declinedAt: Date | null;
  /** 这是第几次填（长程重复测量）。非重复测量恒为 1 */
  round: number;
};

export type SaveQuestionnaireInput = {
  questionnaireId: string;
  title: string;
  intro: string;
  questions: QuestionDraft[];
  scoringRule: string | null;
  passScore: number | null;
  /** 上传文件的原文，保留下来供「重新生成」用 */
  sourceText?: string | null;
};

export type UpsertResponseInput = {
  questionnaireId: string;
  subjectId: string;
  answers: AnswerMap;
  submittedAt: Date;
  /** 第几轮。非重复测量恒为 1 */
  round: number;
};

export type ScoreUpdate = {
  score: number | null;
  reason: string | null;
  /** 分项计分；null 表示这次没算出来（比如规则版兜底） */
  breakdown: ScoreItem[] | null;
  passed: boolean | null;
  scoredAt: Date | null;
};

export interface QuestionnaireRepository {
  /** 按实验取问卷（含题目，按 order 升序）；没有返回 null */
  findByExperiment(experimentId: string): Promise<QuestionnaireRecord | null>;

  /** 不存在就建一份空问卷 */
  createForExperiment(experimentId: string, draft: QuestionnaireDraft): Promise<QuestionnaireRecord>;

  /** 覆盖式保存：标题、说明、题目（整体替换）、评分要求、通过线 */
  save(input: SaveQuestionnaireInput): Promise<void>;

  setStatus(questionnaireId: string, status: "DRAFT" | "PUBLISHED"): Promise<void>;

  /** 只改评分要求 / 分数线，不动题目（后台调阈值时用） */
  updateSettings(
    questionnaireId: string,
    input: { scoringRule: string | null; passScore: number | null },
  ): Promise<void>;

  /** 主试后台：全部答卷，含被试基本信息 */
  listResponses(questionnaireId: string): Promise<ResponseRecord[]>;

  /** 只数个数：编辑器顶部显示「已有 N 份答卷」，不需要把答卷本身读出来 */
  countResponses(questionnaireId: string): Promise<number>;

  /** 被试端：我自己某一份答卷。不传 round 时取最近一轮 */
  findResponse(questionnaireId: string, subjectId: string, round?: number): Promise<ResponseRecord | null>;

  /** 被试端：我在这个问卷里填过的全部轮次（按 round 升序），用来算「填了几天」 */
  listMyResponses(questionnaireId: string, subjectId: string): Promise<ResponseRecord[]>;

  /** 提交/覆盖答卷。重复提交时把分数清空，等重新计分 */
  upsertResponse(input: UpsertResponseInput): Promise<ResponseRecord>;

  /** 还没算分的答卷（重算时也用它） */
  listUnscored(questionnaireId: string): Promise<ResponseRecord[]>;

  saveScore(responseId: string, update: ScoreUpdate): Promise<void>;

  /** 标记已发邀请，返回受影响条数 */
  markInvited(responseIds: string[], now: Date): Promise<number>;

  /** 标记已告知「本轮不匹配」，返回受影响条数 */
  markDeclined(responseIds: string[], now: Date): Promise<number>;

  /**
   * 这个被试是否通过了这门实验的问卷筛选。
   *
   * 报名用例在「是否需要问卷」为真时调用它 —— 语义是「有资格预约」，
   * 而不是「填过问卷」。两者差别正是本功能的重点。
   */
  hasPassed(experimentId: string, subjectId: string): Promise<boolean>;
}
