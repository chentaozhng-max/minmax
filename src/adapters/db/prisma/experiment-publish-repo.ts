/**
 * Prisma 实现：ExperimentPublishRepository。
 *
 * 这里的嵌套 create（experiment + slots 一次写入）本身就是原子的：
 * Prisma 会把 `slots: { create: [...] }` 放进同一个事务，任一失败整体回滚，
 * 所以不需要额外的 $transaction 包裹。
 */
import { prisma } from "@/lib/prisma";
import type {
  ExperimentPublishRepository,
  PublishExperimentInput,
  PublishedExperiment,
} from "@/domain/ports/experiment-repo";

type ExperimentCreateDelegate = {
  create(args: unknown): Promise<unknown>;
};

export type PublishClientLike = {
  experiment: ExperimentCreateDelegate;
};

export function makeExperimentPublishRepository(
  db: PublishClientLike,
): ExperimentPublishRepository {
  return {
    async createWithSlots(input: PublishExperimentInput): Promise<PublishedExperiment> {
      const created = (await db.experiment.create({
        data: {
          researcherId: input.researcherId,
          title: input.title,
          description: input.description,
          location: input.location,
          durationMin: input.durationMin,
          rewardText: input.rewardText,
          type: input.type,
          mode: input.mode,
          needsQuestionnaire: input.needsQuestionnaire,
          // 一对一实验不写 groupSize（列可为 null），团体实验写人数
          groupSize: input.type === "GROUP" ? input.groupSize : null,
          requirements: input.requirements,
          minCreditScore: input.minCreditScore,
          needsVerification: input.needsVerification,
          signupDeadline: input.signupDeadline,
          status: input.status,
          slots: {
            create: input.slots.map((s) => ({
              startAt: s.startAt,
              endAt: s.endAt,
              capacity: s.capacity,
            })),
          },
        },
        select: { id: true, status: true },
      })) as { id: string; status: string };

      return { id: created.id, status: created.status as PublishedExperiment["status"] };
    },
  };
}

/** 生产装配入口 —— 与 direct-message-repo.ts 同一种写法 */
export function makeDefaultPublishRepository(): ExperimentPublishRepository {
  return makeExperimentPublishRepository(prisma as unknown as PublishClientLike);
}
