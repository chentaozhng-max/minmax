import { describe, expect, it } from "vitest";
import { makeExperimentSearch } from "@/adapters/db/prisma/experiment-search";
import type { ExperimentSearchQuery } from "@/domain/ports/experiment-search";

/**
 * 跨实验搜索适配器测试。
 *
 * 断言重点不是「返回了什么」（那取决于假数据），而是 **where 的形状**：
 * 这类查询最危险的失效形态是「条件互相覆盖 → 静默不过滤 → 结果全绿但功能错」，
 * 只有把 args 摆出来逐字段看才抓得住。
 */

const NOW = new Date("2026-11-04T08:00:00+08:00");

function rawExperiment(over: Record<string, any> = {}) {
  return {
    id: "exp_1",
    title: "决策实验",
    location: "心理学楼 302",
    durationMin: 45,
    rewardText: "40 元",
    type: "INDIVIDUAL",
    groupSize: null,
    minCreditScore: 0,
    needsVerification: false,
    signupDeadline: new Date("2026-11-20T00:00:00+08:00"),
    researcher: { name: "张老师" },
    slots: [],
    ...over,
  };
}

function makeFake(rows: any[] = []) {
  const calls: any[] = [];
  const db = {
    experiment: {
      findMany: async (args: any) => {
        calls.push(args);
        return rows;
      },
    },
  };
  return { db, calls };
}

const emptyQuery: ExperimentSearchQuery = {
  keyword: null,
  windows: [],
  maxDurationMin: null,
};

describe("searchCandidates — 查询形状", () => {
  it("无条件时只筛「已发布 + 未截止」", async () => {
    const { db, calls } = makeFake();
    await makeExperimentSearch(db).searchCandidates(emptyQuery, NOW);

    expect(calls[0].where).toEqual({
      status: "PUBLISHED",
      signupDeadline: { gt: NOW },
    });
    expect(calls[0].where.AND).toBeUndefined();
  });

  it("关键词 → AND 里的一个 OR 组（标题/描述/地点）", async () => {
    const { db, calls } = makeFake();
    await makeExperimentSearch(db).searchCandidates(
      { ...emptyQuery, keyword: "心理学" },
      NOW,
    );

    expect(calls[0].where.AND).toEqual([
      {
        OR: [
          { title: { contains: "心理学" } },
          { description: { contains: "心理学" } },
          { location: { contains: "心理学" } },
        ],
      },
    ]);
  });

  it("时长上限 → durationMin.lte", async () => {
    const { db, calls } = makeFake();
    await makeExperimentSearch(db).searchCandidates(
      { ...emptyQuery, maxDurationMin: 60 },
      NOW,
    );

    expect(calls[0].where.durationMin).toEqual({ lte: 60 });
  });

  it("时间窗 → slots.some 且只认未来", async () => {
    const { db, calls } = makeFake();
    const w = {
      start: new Date("2026-11-04T13:00:00+08:00"),
      end: new Date("2026-11-04T18:00:00+08:00"),
    };
    await makeExperimentSearch(db).searchCandidates({ ...emptyQuery, windows: [w] }, NOW);

    expect(calls[0].where.AND).toEqual([
      {
        OR: [
          // 线上实验先放行：它们没有「到场时间」，用 slots 卡会把它们全灭
          { mode: "ONLINE" },
          {
            slots: {
              some: {
                startAt: { gt: NOW },
                OR: [{ startAt: { gte: w.start, lt: w.end } }],
              },
            },
          },
        ],
      },
    ]);
  });

  it("⚠️ 关键词 + 时间窗并存时两组都在，不互相覆盖", async () => {
    const { db, calls } = makeFake();
    const w = {
      start: new Date("2026-11-04T13:00:00+08:00"),
      end: new Date("2026-11-04T18:00:00+08:00"),
    };
    await makeExperimentSearch(db).searchCandidates(
      { keyword: "决策", windows: [w], maxDurationMin: 60 },
      NOW,
    );

    const and = calls[0].where.AND as any[];
    expect(and).toHaveLength(2);
    expect(and[0].OR[0].title.contains).toBe("决策");
    expect(and[1].OR[0]).toEqual({ mode: "ONLINE" });
    expect(and[1].OR[1].slots.some.OR).toHaveLength(1);
    expect(calls[0].where.durationMin).toEqual({ lte: 60 });
    // 顶层 OR 不该出现：一旦有，说明走回了互相覆盖的老写法
    expect(calls[0].where.OR).toBeUndefined();
  });

  it("多个时间窗 → 同一个 OR 里多个分支", async () => {
    const { db, calls } = makeFake();
    const w1 = {
      start: new Date("2026-11-04T13:00:00+08:00"),
      end: new Date("2026-11-04T18:00:00+08:00"),
    };
    const w2 = {
      start: new Date("2026-11-05T13:00:00+08:00"),
      end: new Date("2026-11-05T18:00:00+08:00"),
    };
    await makeExperimentSearch(db).searchCandidates(
      { ...emptyQuery, windows: [w1, w2] },
      NOW,
    );

    const or = (calls[0].where.AND as any[])[0].OR;
    expect(or[1].slots.some.OR).toHaveLength(2);
  });

  it("取数有上限（不整表拉）", async () => {
    const { db, calls } = makeFake();
    await makeExperimentSearch(db).searchCandidates(emptyQuery, NOW);

    expect(typeof calls[0].take).toBe("number");
    expect(calls[0].take).toBeLessThanOrEqual(100);
  });

  it("slots 只取未来且升序（余额判断放内存）", async () => {
    const { db, calls } = makeFake();
    await makeExperimentSearch(db).searchCandidates(emptyQuery, NOW);

    expect(calls[0].select.slots).toEqual({
      where: { startAt: { gt: NOW } },
      orderBy: { startAt: "asc" },
      select: { id: true, startAt: true, endAt: true, capacity: true, bookedCount: true },
    });
  });

  it("不取主试敏感字段（只取 name）", async () => {
    const { db, calls } = makeFake();
    await makeExperimentSearch(db).searchCandidates(emptyQuery, NOW);

    expect(calls[0].select.researcher).toEqual({ select: { name: true } });
    expect(calls[0].select.passwordHash).toBeUndefined();
  });
});
