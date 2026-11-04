import { describe, expect, it } from "vitest";
import { publishExperiment, type PublishExperimentInput } from "@/application/publish-experiment";
import { OPEN_ANYTIME_DEADLINE } from "@/domain/experiment-rules";
import type {
  ExperimentPublishRepository,
  PublishExperimentInput as RepoInput,
} from "@/domain/ports/experiment-repo";

const NOW = new Date("2026-03-01T10:00:00+08:00");
const day = (n: number) => new Date(NOW.getTime() + n * 24 * 3600 * 1000);

/** 手写假仓储：记录收到的入参，验证「容量被改写」这件事真的发生了 */
function makeRepo() {
  const calls: RepoInput[] = [];
  const repo: ExperimentPublishRepository = {
    async createWithSlots(input) {
      calls.push(input);
      return { id: "exp_1", status: input.status };
    },
  };
  return { repo, calls };
}

const deps = (repo: ExperimentPublishRepository, banned = false) => ({
  repo,
  loadPublisher: async (id: string) => ({ id, bannedUntil: banned ? day(7) : null }),
});

function input(over: Partial<PublishExperimentInput> = {}): PublishExperimentInput {
  return {
    userId: "u_researcher",
    title: "团体决策中的从众行为",
    description: "三人一组完成决策任务，全程约 60 分钟",
    location: "心理学系 305",
    durationMin: 60,
    rewardText: "¥50",
    type: "GROUP",
    groupSize: 3,
    requirements: null,
    minCreditScore: 0,
    needsVerification: true,
    signupDeadline: day(1).toISOString(),
    // 故意填 1 —— 团体实验应该被改成 3
    slots: [{ startAt: day(2).toISOString(), endAt: new Date(day(2).getTime() + 3600_000).toISOString(), capacity: 1 }],
    publish: true,
    now: NOW,
    ...over,
  };
}

describe("publishExperiment —— 团体容量强制", () => {
  it("团体实验：主试填的 capacity 1 被改成 groupSize 3", async () => {
    const { repo, calls } = makeRepo();
    await publishExperiment(input(), deps(repo));

    expect(calls).toHaveLength(1);
    expect(calls[0].slots).toHaveLength(1);
    expect(calls[0].slots[0].capacity).toBe(3);
    expect(calls[0].groupSize).toBe(3);
  });

  it("团体实验：多个时段全部按 groupSize 改写", async () => {
    const { repo, calls } = makeRepo();
    const s2 = new Date(day(3).getTime());
    await publishExperiment(
      input({
        groupSize: 5,
        slots: [
          { startAt: day(2).toISOString(), endAt: new Date(day(2).getTime() + 3600_000).toISOString(), capacity: 1 },
          { startAt: s2.toISOString(), endAt: new Date(s2.getTime() + 3600_000).toISOString(), capacity: 2 },
        ],
      }),
      deps(repo),
    );

    expect(calls[0].slots.map((s) => s.capacity)).toEqual([5, 5]);
  });

  it("一对一实验：capacity 原样保留", async () => {
    const { repo, calls } = makeRepo();
    await publishExperiment(
      input({ type: "INDIVIDUAL", groupSize: null, slots: [{ startAt: day(2).toISOString(), endAt: new Date(day(2).getTime() + 3600_000).toISOString(), capacity: 4 }] }),
      deps(repo),
    );

    expect(calls[0].slots[0].capacity).toBe(4);
    expect(calls[0].groupSize).toBeNull();
  });

  it("一对一实验即使传了 groupSize 也不落库", async () => {
    const { repo, calls } = makeRepo();
    await publishExperiment(input({ type: "INDIVIDUAL", groupSize: 5 }), deps(repo));
    expect(calls[0].groupSize).toBeNull();
  });
});

describe("publishExperiment —— 拒绝路径", () => {
  it("禁期中不能发布 → 403，且不落库", async () => {
    const { repo, calls } = makeRepo();
    await expect(publishExperiment(input(), deps(repo, true))).rejects.toThrow(/禁发布至/);
    expect(calls).toHaveLength(0);
  });

  it("团体人数 < 2 → 400，不落库", async () => {
    const { repo, calls } = makeRepo();
    await expect(publishExperiment(input({ groupSize: 1 }), deps(repo))).rejects.toThrow(/团体人数/);
    expect(calls).toHaveLength(0);
  });

  it("截止时间晚于最早时段 → 400", async () => {
    const { repo } = makeRepo();
    await expect(
      publishExperiment(input({ signupDeadline: day(5).toISOString() }), deps(repo)),
    ).rejects.toThrow(/早于最早时段/);
  });

  it("时段重叠 → 400", async () => {
    const { repo } = makeRepo();
    const a = day(2);
    await expect(
      publishExperiment(
        input({
          slots: [
            { startAt: a.toISOString(), endAt: new Date(a.getTime() + 7200_000).toISOString(), capacity: 3 },
            { startAt: new Date(a.getTime() + 3600_000).toISOString(), endAt: new Date(a.getTime() + 9000_000).toISOString(), capacity: 3 },
          ],
        }),
        deps(repo),
      ),
    ).rejects.toThrow(/重叠/);
  });
});

describe("publishExperiment —— 草稿与发布", () => {
  it("publish=true → PUBLISHED + 提示已发布", async () => {
    const { repo } = makeRepo();
    const r = await publishExperiment(input({ publish: true }), deps(repo));
    expect(r.status).toBe("PUBLISHED");
    expect(r.message).toBe("实验已发布");
  });

  it("publish 缺省 → DRAFT + 提示已保存草稿", async () => {
    const { repo } = makeRepo();
    const r = await publishExperiment(input({ publish: undefined }), deps(repo));
    expect(r.status).toBe("DRAFT");
    expect(r.message).toBe("已保存为草稿");
  });
});

describe("publishExperiment —— 已经开始的时段", () => {
  const past = (hoursAgo: number) => new Date(NOW.getTime() - hoursAgo * 3600_000);

  it("丢弃已开始的时段，只落未开始的（否则截止时间永远不合法）", async () => {
    const { repo, calls } = makeRepo();
    const p = past(24);
    await publishExperiment(
      input({
        type: "INDIVIDUAL",
        groupSize: null,
        signupDeadline: new Date(NOW.getTime() + 2 * 3600_000).toISOString(),
        slots: [
          { startAt: p.toISOString(), endAt: new Date(p.getTime() + 3600_000).toISOString(), capacity: 1 },
          { startAt: day(2).toISOString(), endAt: new Date(day(2).getTime() + 3600_000).toISOString(), capacity: 1 },
        ],
      }),
      deps(repo),
    );

    expect(calls[0].slots).toHaveLength(1);
    expect(calls[0].slots[0].startAt.toISOString()).toBe(day(2).toISOString());
  });

  it("全部时段都过去了就拒绝，而不是落一个谁都约不到的空实验", async () => {
    const { repo } = makeRepo();
    const p = past(2);
    await expect(
      publishExperiment(
        input({
          signupDeadline: new Date(NOW.getTime() + 60_000).toISOString(),
          slots: [
            { startAt: p.toISOString(), endAt: new Date(p.getTime() + 3600_000).toISOString(), capacity: 1 },
          ],
        }),
        deps(repo),
      ),
    ).rejects.toThrow("所有时段都已经开始了");
  });
});

describe("publishExperiment —— 线上实验「全时段可填写」", () => {
  it("勾了 openAnytime：截止时间写成远期哨兵，问卷标记为必需", async () => {
    const { repo, calls } = makeRepo();
    await publishExperiment(
      input({ mode: "ONLINE", openAnytime: true, slots: [], type: "INDIVIDUAL", groupSize: null }),
      deps(repo),
    );

    expect(calls[0].openAnytime).toBe(true);
    expect(calls[0].needsQuestionnaire).toBe(true);
    expect(calls[0].signupDeadline.getTime()).toBe(OPEN_ANYTIME_DEADLINE.getTime());
  });

  it("线上没勾：按传入的截止时间存，不写哨兵", async () => {
    const { repo, calls } = makeRepo();
    const deadline = day(3).toISOString();
    await publishExperiment(
      input({ mode: "ONLINE", openAnytime: false, signupDeadline: deadline, slots: [] }),
      deps(repo),
    );

    expect(calls[0].openAnytime).toBe(false);
    expect(calls[0].signupDeadline.toISOString()).toBe(new Date(deadline).toISOString());
  });

  it("线下勾了也不认：线下实验必须有真的截止时间", async () => {
    const { repo, calls } = makeRepo();
    await publishExperiment(input({ mode: "OFFLINE", openAnytime: true }), deps(repo));

    expect(calls[0].openAnytime).toBe(false);
    expect(calls[0].signupDeadline.getTime()).toBe(new Date(input().signupDeadline).getTime());
  });
});
