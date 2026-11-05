/**
 * 实验状态的「最小查询」。
 *
 * 问卷链路（发布开关 / 需要问卷 / 报名门槛）只关心几个字段，
 * 不该为了一个 status 把整个实验连同报名者一起捞出来 ——
 * 那套大查询在 page-query-experiment.ts 里，别混着用。
 */
import { prisma } from "@/lib/prisma";

export type ExperimentBrief = {
  id: string;
  title: string;
  type: string;
  groupSize: number | null;
  signupDeadline: Date;
  mode: string;
  needsQuestionnaire: boolean;
  status: string;
  researcherId: string;
};

const BRIEF_SELECT = {
  id: true,
  title: true,
  type: true,
  groupSize: true,
  signupDeadline: true,
  mode: true,
  needsQuestionnaire: true,
  status: true,
  researcherId: true,
} as const;

export async function findExperimentBrief(id: string): Promise<ExperimentBrief | null> {
  return prisma.experiment.findUnique({ where: { id }, select: BRIEF_SELECT });
}

export type PublishCandidate = ExperimentBrief & {
  slots: { startAt: Date; endAt: Date; capacity: number }[];
  /** 没有问卷时是 null —— 与「有问卷但没发布」要区分开 */
  questionnaireStatus: string | null;
};

/** 上下架前要按库里的真实数据复算一次：时段可能过期、问卷可能还没发布 */
export async function findExperimentForPublish(id: string): Promise<PublishCandidate | null> {
  const row = await prisma.experiment.findUnique({
    where: { id },
    select: {
      ...BRIEF_SELECT,
      slots: { orderBy: { startAt: "asc" }, select: { startAt: true, endAt: true, capacity: true } },
      questionnaire: { select: { status: true } },
    },
  });
  if (!row) return null;
  const { questionnaire, ...rest } = row;
  return { ...rest, questionnaireStatus: questionnaire?.status ?? null };
}

export async function setExperimentStatus(id: string, status: string) {
  return prisma.experiment.update({
    where: { id },
    data: { status },
    select: { id: true, status: true },
  });
}

/**
 * 主试详情页要的三个数：收了多少份、算过分没有、通过几个。
 * 没建问卷时全 0 —— 与「有问卷但没人填」在页面上都是 0，不用区分。
 */
export async function countQuestionnaireResponses(experimentId: string) {
  const questionnaire = await prisma.questionnaire.findUnique({
    where: { experimentId },
    select: { id: true },
  });
  if (!questionnaire) return { responseTotal: 0, responseScored: 0, responsePassed: 0 };

  const questionnaireId = questionnaire.id;
  const [responseTotal, responseScored, responsePassed] = await Promise.all([
    prisma.questionnaireResponse.count({ where: { questionnaireId } }),
    prisma.questionnaireResponse.count({ where: { questionnaireId, score: { not: null } } }),
    prisma.questionnaireResponse.count({ where: { questionnaireId, passed: true } }),
  ]);
  return { responseTotal, responseScored, responsePassed };
}
