import { describe, expect, it } from "vitest";
import { searchExperiments, type SearchSubject } from "@/application/search-experiments";
import type {
  ExperimentCandidate,
  ExperimentSearchPort,
  ExperimentSearchQuery,
} from "@/domain/ports/experiment-search";

/**
 * 应用层用例测试。
 *
 * 关注三件代码里容易写错、而且出错后**不会报错只会静默错误**的事：
 *   1. 资格不够的必须被排除，但必须出现在 excluded 里（不能凭空消失）
 *   2. 排序真的调用了领域层（不是适配器自己排了一遍）
 *   3. limit 截断后 totalEligible 仍是截断前的总数
 */

const NOW = new Date("2026-11-04T08:00:00+08:00"); // 周三早上

function cand(over: Partial<ExperimentCandidate> = {}): ExperimentCandidate {
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
    researcherName: "张老师",
    openSlots: [],
    ...over,
  };
}

function slot(iso: string, capacity = 5, bookedCount = 0) {
  const start = new Date(iso);
  return {
    id: `slot-${iso}`,
    startAt: start,
    endAt: new Date(start.getTime() + 45 * 60 * 1000),
    capacity,
    bookedCount,
  };
}

function makePort(rows: ExperimentCandidate[]) {
  const calls: ExperimentSearchQuery[] = [];
  const port: ExperimentSearchPort = {
    async searchCandidates(q) {
      calls.push(q);
      return rows;
    },
  };
  return { port, calls };
}

const goodSubject: SearchSubject = {
  id: "sub_1",
  creditScore: 100,
  studentVerified: true,
  bannedUntil: null,
};

describe("searchExperiments — 资格过滤", () => {
  it("信誉分不够 → 不进 hits，但进 excluded 并给原因", async () => {
    const { port } = makePort([
      cand({ id: "a", title: "高门槛实验", minCreditScore: 200 }),
      cand({ id: "b", title: "低门槛实验", minCreditScore: 0 }),
    ]);
    const r = await searchExperiments({ search: port, now: NOW }, goodSubject, {});

    expect(r.hits.map((h) => h.id)).toEqual(["b"]);
    expect(r.excludedCount).toBe(1);
    expect(r.excluded[0].title).toBe("高门槛实验");
    expect(r.excluded[0].reason).toContain("信誉分不足");
  });

  it("⚠️ 被禁期 → 全部排除，但仍要报告数量（不能静默空列表）", async () => {
    const { port } = makePort([cand({ id: "a" }), cand({ id: "b" })]);
    const r = await searchExperiments({ search: port, now: NOW }, {
      ...goodSubject,
      bannedUntil: new Date("2026-11-10T00:00:00+08:00"),
    }, {});

    expect(r.hits).toEqual([]);
    expect(r.excludedCount).toBe(2);
    expect(r.excluded[0].reason).toContain("限制报名");
    expect(r.summary).toContain("没有你能报名");
  });

  it("同原因只讲一条（10 门都因信誉分被挡，不重复 10 次）", async () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      cand({ id: `e${i}`, minCreditScore: 999 }),
    );
    const { port } = makePort(rows);
    const r = await searchExperiments({ search: port, now: NOW }, goodSubject, {});

    expect(r.excludedCount).toBe(10);
    expect(r.excluded).toHaveLength(1);
    expect(r.summary).toContain("另有 10 门");
  });

  it("需要认证但没认证 → 排除", async () => {
    const { port } = makePort([cand({ needsVerification: true })]);
    const r = await searchExperiments({ search: port, now: NOW }, {
      ...goodSubject,
      studentVerified: false,
    }, {});

    expect(r.hits).toEqual([]);
    expect(r.excluded[0].reason).toContain("学生认证");
  });
});

describe("searchExperiments — 时间窗与命中", () => {
  it("只说「周三下午」→ 只把下午的时段算命中", async () => {
    const { port, calls } = makePort([
      cand({
        openSlots: [
          slot("2026-11-11T09:00:00+08:00"),
          slot("2026-11-11T14:00:00+08:00"),
          slot("2026-11-11T16:00:00+08:00"),
        ],
      }),
    ]);
    const r = await searchExperiments({ search: port, now: NOW }, goodSubject, {
      weekday: "周三",
      timeOfDay: "下午",
    });

    expect(calls[0].windows).toHaveLength(1);
    expect(r.hits[0].matchedSlotCount).toBe(2);
    expect(r.hits[0].matchedSlots).toHaveLength(2);
  });

  it("不限时间 → 全部空位都算命中", async () => {
    const { port } = makePort([
      cand({ openSlots: [slot("2026-11-05T09:00:00+08:00"), slot("2026-11-06T09:00:00+08:00")] }),
    ]);
    const r = await searchExperiments({ search: port, now: NOW }, goodSubject, {});

    expect(r.hits[0].matchedSlotCount).toBe(2);
  });

  it("命中时段为空但仍有其他空位 → 也算候选（至少还有约得到的时间）", async () => {
    const { port } = makePort([
      cand({ openSlots: [slot("2026-11-05T09:00:00+08:00")] }),
    ]);
    const r = await searchExperiments({ search: port, now: NOW }, goodSubject, {
      weekday: "周三",
      timeOfDay: "下午",
    });

    expect(r.hits).toHaveLength(1);
    expect(r.hits[0].matchedSlotCount).toBe(0);
    expect(r.hits[0].nextSlotAt).toBe(new Date("2026-11-05T09:00:00+08:00").toISOString());
  });
});

describe("searchExperiments — 排序与截断", () => {
  it("sortBy=reward → 金额高的在前", async () => {
    const { port } = makePort([
      cand({ id: "low", rewardText: "20 元" }),
      cand({ id: "high", rewardText: "120 元" }),
    ]);
    const r = await searchExperiments({ search: port, now: NOW }, goodSubject, {
      sortBy: "reward",
    });

    expect(r.hits.map((h) => h.id)).toEqual(["high", "low"]);
  });

  it("limit 截断但 totalEligible 保总数", async () => {
    const rows = Array.from({ length: 7 }, (_, i) => cand({ id: `e${i}`, rewardText: `${i} 元` }));
    const { port } = makePort(rows);
    const r = await searchExperiments({ search: port, now: NOW }, goodSubject, { limit: 3 });

    expect(r.hits).toHaveLength(3);
    expect(r.totalEligible).toBe(7);
    expect(r.summary).toContain("共 7 门");
  });

  it("空结果 + 有关键词 → 提示放宽条件", async () => {
    const { port } = makePort([]);
    const r = await searchExperiments({ search: port, now: NOW }, goodSubject, {
      keyword: "不存在的实验",
    });

    expect(r.hits).toEqual([]);
    expect(r.summary).toContain("放宽");
  });
});
