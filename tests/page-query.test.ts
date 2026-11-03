import { describe, expect, it } from "vitest";
import { makePageQuery } from "@/adapters/db/prisma/page-query";
import type { PageQueryClientLike } from "@/adapters/db/prisma/types";

/**
 * PageQueryPort 实现测试。
 *
 * 关注点和 scheduling-query.test.ts 一样：**查询形状没变**。
 * 这些查询原来写在 app/**\/page.tsx 里，args 是页面功能的一部分，
 * 搬家的同时改 args 就等于偷偷改产品。
 *
 * 另一个重点：页面只该拿到它渲染需要的字段。
 * 原来 findUnique 拿整行，passwordHash / eduEmail 一路传到 JSX —— 现在收窄了。
 */

type Log = { op: string; args: any }[];

function makeFakeDb(overrides: Record<string, unknown> = {}) {
  const log: Log = [];
  const db = {
    user: {
      findUnique: async (args: any) => {
        log.push({ op: "user.findUnique", args });
        return overrides.user ?? null;
      },
    },
    creditEvent: {
      findMany: async (args: any) => {
        log.push({ op: "creditEvent.findMany", args });
        return overrides.creditEvents ?? [];
      },
    },
    appointment: {
      findUnique: async () => null,
      findMany: async () => [],
      create: async () => ({}),
      update: async () => ({}),
      groupBy: async (args: any) => {
        log.push({ op: "appointment.groupBy", args });
        return overrides.grouped ?? [];
      },
    },
    chatSession: {
      findUnique: async () => null,
      findMany: async (args: any) => {
        log.push({ op: "chatSession.findMany", args });
        return overrides.chatSessions ?? [];
      },
      create: async () => ({}),
      update: async () => ({}),
    },
    experiment: {
      findUnique: async (args: any) => {
        log.push({ op: "experiment.findUnique", args });
        return overrides.experiment ?? null;
      },
    },
  } as unknown as PageQueryClientLike;
  return { db, log };
}

const rawUserWithSecrets = {
  id: "u_1",
  name: "林知夏",
  school: "华东师范大学",
  department: "心理学",
  phone: "13900000001",
  studentVerified: true,
  creditScore: 96,
  noShowCount: 1,
  bannedUntil: null,
  // 下面这些都不该出现在端口返回值里
  passwordHash: "$2b$10$abcdefghijklmnop",
  eduEmail: "lin@stu.ecnu.edu.cn",
  studentId: "10215500001",
  refreshToken: "rt_secret",
};

describe("findMeProfile", () => {
  it("用 select 收窄字段，不取整行", async () => {
    const { db, log } = makeFakeDb({ user: rawUserWithSecrets });
    await makePageQuery(db).findMeProfile("u_1");

    expect(log[0].args.where).toEqual({ id: "u_1" });
    // 必须显式 select，而不是让 Prisma 返回整行
    expect(log[0].args.select).toBeDefined();
    expect(Object.keys(log[0].args.select).sort()).toEqual([
      "bannedUntil",
      "creditScore",
      "department",
      "id",
      "name",
      "noShowCount",
      "phone",
      "school",
      "studentVerified",
    ]);
  });

  it("⚠️ passwordHash / eduEmail / studentId 不出适配层", async () => {
    const { db } = makeFakeDb({ user: rawUserWithSecrets });
    const p = await makePageQuery(db).findMeProfile("u_1");

    const json = JSON.stringify(p);
    expect(json).not.toContain("passwordHash");
    expect(json).not.toContain("$2b$10$");
    expect(json).not.toContain("lin@stu.ecnu.edu.cn");
    expect(json).not.toContain("10215500001");
  });

  it("bannedUntil 保留为 Date 或 null（页面要比较时间）", async () => {
    const banned = new Date("2026-11-10T00:00:00Z");
    const { db } = makeFakeDb({ user: { ...rawUserWithSecrets, bannedUntil: banned } });
    const p = await makePageQuery(db).findMeProfile("u_1");
    expect(p!.bannedUntil).toBe(banned);
  });

  it("不存在 → null", async () => {
    const { db } = makeFakeDb();
    expect(await makePageQuery(db).findMeProfile("nope")).toBeNull();
  });
});

describe("findRecentCreditEvents", () => {
  it("按创建时间倒序 + take 条数不变", async () => {
    const { db, log } = makeFakeDb();
    await makePageQuery(db).findRecentCreditEvents("u_1", 20);

    expect(log[0].args).toEqual({
      where: { userId: "u_1" },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
  });

  it("原样保留 delta / reason / note / createdAt（页面直接渲染）", async () => {
    const createdAt = new Date("2026-10-28T08:00:00Z");
    const { db } = makeFakeDb({
      creditEvents: [
        { id: "e1", delta: 1, reason: "ATTENDED", note: "按时到场", createdAt, userId: "u_1" },
      ],
    });
    const [e] = await makePageQuery(db).findRecentCreditEvents("u_1", 20);

    expect(e).toEqual({ id: "e1", delta: 1, reason: "ATTENDED", note: "按时到场", createdAt });
  });
});

describe("countAppointmentsByStatus", () => {
  it("仍是一次 groupBy（不是按状态查 N 次）", async () => {
    const { db, log } = makeFakeDb();
    await makePageQuery(db).countAppointmentsByStatus(
      "u_1",
      ["COMPLETED"],
      ["CONFIRMED", "CHECKED_IN"],
    );

    expect(log).toHaveLength(1);
    expect(log[0].op).toBe("appointment.groupBy");
    expect(log[0].args).toEqual({
      by: ["status"],
      where: { subjectId: "u_1" },
      _count: { _all: true },
    });
  });

  it("把分组结果 reduce 成两个数字（reduce 从页面搬进适配器）", async () => {
    const { db } = makeFakeDb({
      grouped: [
        { status: "COMPLETED", _count: { _all: 3 } },
        { status: "CONFIRMED", _count: { _all: 2 } },
        { status: "CHECKED_IN", _count: { _all: 1 } },
        { status: "CANCELLED_BY_SUBJECT", _count: { _all: 9 } },
      ],
    });
    const counts = await makePageQuery(db).countAppointmentsByStatus(
      "u_1",
      ["COMPLETED"],
      ["PENDING_SUBJECT_CONFIRM", "AWAITING_RESEARCHER", "CONFIRMED", "CHECKED_IN"],
    );

    expect(counts).toEqual({ completed: 3, ongoing: 3 });
  });

  it("没有记录 → 两个 0（不是 undefined）", async () => {
    const { db } = makeFakeDb({ grouped: [] });
    const counts = await makePageQuery(db).countAppointmentsByStatus("u_1", ["COMPLETED"], [
      "CONFIRMED",
    ]);
    expect(counts).toEqual({ completed: 0, ongoing: 0 });
  });
});

describe("findChatSessionsForSubject", () => {
  it("按更新时间倒序 + 带上实验与主试", async () => {
    const { db, log } = makeFakeDb();
    await makePageQuery(db).findChatSessionsForSubject("u_1");

    expect(log[0].args).toEqual({
      where: { subjectId: "u_1" },
      include: { experiment: { include: { researcher: true } } },
      orderBy: { updatedAt: "desc" },
    });
  });

  it("把嵌套 researcher.name 摊平成 researcherName", async () => {
    const { db } = makeFakeDb({
      chatSessions: [
        {
          id: "cs1",
          experimentId: "exp1",
          state: "PROPOSED",
          messages: "[]",
          updatedAt: new Date("2026-11-02T09:23:00Z"),
          experiment: {
            title: "面孔吸引力判断实验",
            durationMin: 30,
            rewardText: "¥30",
            researcher: { name: "陈砚", email: "chen@x.edu" },
          },
        },
      ],
    });
    const [s] = await makePageQuery(db).findChatSessionsForSubject("u_1");

    expect(s.experiment.researcherName).toBe("陈砚");
    expect(s.experiment).not.toHaveProperty("researcher");
    expect(JSON.stringify(s)).not.toContain("chen@x.edu");
  });
});

describe("findChatHeaderExperiment", () => {
  it("include researcher", async () => {
    const { db, log } = makeFakeDb({
      experiment: {
        id: "e1",
        title: "t",
        durationMin: 30,
        location: "l",
        rewardText: "r",
        researcher: { name: "陈砚" },
      },
    });
    await makePageQuery(db).findChatHeaderExperiment("e1");
    expect(log[0].args).toEqual({ where: { id: "e1" }, include: { researcher: true } });
  });

  it("摊平成 researcherName，不带整个 researcher 对象", async () => {
    const { db } = makeFakeDb({
      experiment: {
        id: "e1",
        title: "面孔吸引力判断实验",
        durationMin: 30,
        location: "心理楼 302",
        rewardText: "¥30",
        researcher: { name: "陈砚", phone: "13800000001", passwordHash: "hash" },
      },
    });
    const e = await makePageQuery(db).findChatHeaderExperiment("e1");

    expect(e!.researcherName).toBe("陈砚");
    expect(JSON.stringify(e)).not.toContain("13800000001");
    expect(JSON.stringify(e)).not.toContain("hash");
  });

  it("不存在 → null（页面自己 notFound()）", async () => {
    const { db } = makeFakeDb();
    expect(await makePageQuery(db).findChatHeaderExperiment("nope")).toBeNull();
  });
});
