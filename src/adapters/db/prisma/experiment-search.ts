/**
 * Prisma 实现：ExperimentSearchPort（跨实验搜索）。
 *
 * ## 为什么不用现成的 listExperimentCards
 *
 * 那个在 `server/experiments.ts`，服务于**首页浏览**：它直接依赖 prisma、把「排序」
 * 和「资格判定」都写在函数体里，还带 lowCreditResearcher 这类浏览型规则。
 * 对话搜索要的是「按条件筛 + 由应用层排序」，两者会越改越不像。
 *
 * 顺带说明一处历史遗留：`listExperimentCards` 的 `params.reward` 声明了、页面也传了，
 * 但函数体里从未读取——那段是死代码。本文件不复用它的同时，也没有继承这个洞。
 *
 * ## 只做一件事
 *
 * 把「哪个实验 + 哪些空位」取出来。过滤与排序的规则全在 application/domain，
 * 这一层不认识「什么是排序」「什么是资格」。
 */
import { prisma } from "@/lib/prisma";
import { ExperimentStatus } from "@/domain/constants";
import type {
  CandidateSlot,
  ExperimentCandidate,
  ExperimentSearchPort,
  ExperimentSearchQuery,
} from "@/domain/ports/experiment-search";

type RawSlot = {
  id: string;
  startAt: Date;
  endAt: Date;
  capacity: number;
  bookedCount: number;
};

type RawExperiment = {
  id: string;
  title: string;
  location: string;
  mode: string;
  scheduleMode: string;
  durationMin: number;
  rewardText: string;
  type: string;
  groupSize: number | null;
  minCreditScore: number;
  needsVerification: boolean;
  signupDeadline: Date;
  researcher: { name: string } | null;
  slots: RawSlot[];
};

type ExperimentFindMany = (args: unknown) => Promise<unknown[]>;

export type SearchClientLike = {
  experiment: { findMany: ExperimentFindMany };
};

/** 一次最多取多少门实验来排序（避免全表 + 内存排序）。真实数据量远小于此 */
const MAX_CANDIDATES = 100;

export function makeExperimentSearch(db: SearchClientLike): ExperimentSearchPort {
  return {
    async searchCandidates(
      query: ExperimentSearchQuery,
      now: Date,
    ): Promise<ExperimentCandidate[]> {
      const where: Record<string, unknown> = {
        status: ExperimentStatus.PUBLISHED,
        signupDeadline: { gt: now },
      };

      // 用 AND 数组组织：关键词是一组 OR，时间窗是另一组 OR。
      // 直接往 where.OR 上叠加会互相覆盖（前一个 OR 被后一个冲掉），是这类查询的老坑。
      const and: Record<string, unknown>[] = [];

      if (query.keyword) {
        and.push({
          OR: [
            { title: { contains: query.keyword } },
            { description: { contains: query.keyword } },
            { location: { contains: query.keyword } },
          ],
        });
      }
      if (query.maxDurationMin !== null) {
        where.durationMin = { lte: query.maxDurationMin };
      }
      const windows = query.windows;
      if (windows.length > 0) {
        // 线上实验不能被时间窗筛掉：它们没有「到场时间」这个概念，
        // 用 slots 去卡会让「周三下午有空」把所有线上实验全灭掉。
        and.push({
          OR: [
            { mode: "ONLINE" },
            {
              slots: {
                some: {
                  startAt: { gt: now },
                  OR: windows.map((w) => ({ startAt: { gte: w.start, lt: w.end } })),
                },
              },
            },
          ],
        });
      }
      if (and.length > 0) where.AND = and;

      const rows = (await db.experiment.findMany({
        where,
        take: MAX_CANDIDATES,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          title: true,
          location: true,
          mode: true,
          scheduleMode: true,
          durationMin: true,
          rewardText: true,
          type: true,
          groupSize: true,
          minCreditScore: true,
          needsVerification: true,
          signupDeadline: true,
          researcher: { select: { name: true } },
          // 只取未来的时段；余额判断放内存（SQLite 不支持字段间比较）
          slots: {
            where: { startAt: { gt: now } },
            orderBy: { startAt: "asc" },
            select: { id: true, startAt: true, endAt: true, capacity: true, bookedCount: true },
          },
        },
      })) as RawExperiment[];

      return rows.map((row) => ({
        id: row.id,
        title: row.title,
        location: row.location,
        mode: row.mode === "ONLINE" ? "ONLINE" : "OFFLINE",
        scheduleMode:
          row.scheduleMode === "WINDOW" || row.scheduleMode === "SCHEDULED"
            ? row.scheduleMode
            : "ANYTIME",
        durationMin: row.durationMin,
        rewardText: row.rewardText,
        type: row.type as ExperimentCandidate["type"],
        groupSize: row.groupSize,
        minCreditScore: row.minCreditScore,
        needsVerification: row.needsVerification,
        signupDeadline: row.signupDeadline,
        researcherName: row.researcher?.name ?? "",
        openSlots: row.slots
          .filter((s) => s.bookedCount < s.capacity)
          .map(
            (s): CandidateSlot => ({
              id: s.id,
              startAt: s.startAt,
              endAt: s.endAt,
              capacity: s.capacity,
              bookedCount: s.bookedCount,
            }),
          ),
      }));
    },
  };
}

/** 生产装配入口 */
export function makeDefaultExperimentSearch(): ExperimentSearchPort {
  return makeExperimentSearch(prisma as unknown as SearchClientLike);
}
