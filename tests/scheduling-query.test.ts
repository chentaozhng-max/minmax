import { describe, expect, it } from "vitest";
import { makeSchedulingQuery } from "@/adapters/db/prisma/scheduling-query";
import type { QueryClientLike } from "@/adapters/db/prisma/types";
import { ACTIVE_APPOINTMENT_STATUSES } from "@/domain/constants";

/**
 * SchedulingQueryPort 实现测试。
 *
 * 重点不是「能不能查出来」，而是**搬家前后查询形状没变**：
 * where / orderBy / take / include 都必须和 agent.ts 里原来那 4 处一模一样。
 * 因为这些 args 一改就是行为变了，而这个重构承诺的是"行为零变化"。
 */

type Log = { op: string; args: any }[];

function makeFakeDb(overrides: Record<string, unknown> = {}) {
  const log: Log = [];
  const db = {
    experiment: {
      findUnique: async (args: any) => {
        log.push({ op: "experiment.findUnique", args });
        return overrides.experiment ?? null;
      },
    },
    user: {
      findUnique: async (args: any) => {
        log.push({ op: "user.findUnique", args });
        return overrides.user ?? null;
      },
    },
    slot: {
      findUnique: async () => null,
      findMany: async (args: any) => {
        log.push({ op: "slot.findMany", args });
        return overrides.slots ?? [];
      },
      updateMany: async () => ({ count: 0 }),
    },
    appointment: {
      findUnique: async () => null,
      findMany: async (args: any) => {
        log.push({ op: "appointment.findMany", args });
        return overrides.appointments ?? [];
      },
      create: async () => ({}),
      update: async () => ({}),
    },
  } as unknown as QueryClientLike;
  return { db, log };
}

const rawExperiment = {
  id: "exp_1",
  title: "决策实验",
  researcherId: "r_1",
  status: "PUBLISHED",
  type: "GROUP",
  groupSize: 3,
  location: "心理楼 302",
  durationMin: 45,
  rewardText: "50 元",
  minCreditScore: 60,
  needsVerification: false,
  signupDeadline: new Date("2026-12-01T00:00:00Z"),
  researcher: { name: "王老师" },
  // 这个字段不该出现在端口类型里
  secretNote: "内部备注",
};

const rawUser = {
  id: "u_1",
  creditScore: 88,
  noShowCount: 2,
  bannedUntil: null,
  studentVerified: true,
  email: "a@b.c",
  passwordHash: "xxx",
};

describe("findExperimentDetail", () => {
  it("include researcher 以取到主试姓名", async () => {
    const { db, log } = makeFakeDb({ experiment: rawExperiment });
    await makeSchedulingQuery(db).findExperimentDetail("exp_1");
    expect(log[0].args).toEqual({ where: { id: "exp_1" }, include: { researcher: true } });
  });

  it("把 researcher.name 摊平成 researcherName 字段", async () => {
    const { db } = makeFakeDb({ experiment: rawExperiment });
    const d = await makeSchedulingQuery(db).findExperimentDetail("exp_1");
    expect(d!.researcherName).toBe("王老师");
    expect(d).not.toHaveProperty("researcher");
  });

  it("不把无关字段（内部备注）漏进端口类型", async () => {
    const { db } = makeFakeDb({ experiment: rawExperiment });
    const d = await makeSchedulingQuery(db).findExperimentDetail("exp_1");
    expect(d).not.toHaveProperty("secretNote");
  });

  it("不存在 → null，不抛错（转 ApiError 是应用层的事）", async () => {
    const { db } = makeFakeDb();
    expect(await makeSchedulingQuery(db).findExperimentDetail("nope")).toBeNull();
  });
});

describe("findSubjectProfile", () => {
  it("只取资格判定和提示词要用的 5 个字段", async () => {
    const { db } = makeFakeDb({ user: rawUser });
    const p = await makeSchedulingQuery(db).findSubjectProfile("u_1");
    expect(Object.keys(p!).sort()).toEqual(["bannedUntil", "creditScore", "id", "noShowCount", "studentVerified"]);
  });

  it("⚠️ 不把 passwordHash 带出适配层", async () => {
    const { db } = makeFakeDb({ user: rawUser });
    const p = await makeSchedulingQuery(db).findSubjectProfile("u_1");
    expect(p).not.toHaveProperty("passwordHash");
    expect(JSON.stringify(p)).not.toContain("xxx");
  });
});

describe("findUpcomingSlots", () => {
  it("查询形状与重构前一致：时间过滤 + 升序 + take", async () => {
    const { db, log } = makeFakeDb();
    const from = new Date("2026-11-02T00:00:00Z");
    await makeSchedulingQuery(db).findUpcomingSlots("exp_1", from, 60);

    expect(log[0].args).toEqual({
      where: { experimentId: "exp_1", startAt: { gt: from } },
      orderBy: { startAt: "asc" },
      take: 60,
    });
  });

  it("不在 SQL 里过滤「已满」—— 满的时段照样返回", async () => {
    const full = { id: "s1", startAt: new Date(), endAt: new Date(), capacity: 2, bookedCount: 2 };
    const { db, log } = makeFakeDb({ slots: [full] });
    const rows = await makeSchedulingQuery(db).findUpcomingSlots("exp_1", new Date(), 60);

    expect(rows).toHaveLength(1);
    expect(rows[0].bookedCount).toBe(2);
    // 查询条件里不该出现 bookedCount
    expect(JSON.stringify(log[0].args)).not.toContain("bookedCount");
  });
});

describe("findActiveAppointments", () => {
  it("只查有效状态、按创建时间倒序、带时段与实验名", async () => {
    const { db, log } = makeFakeDb();
    await makeSchedulingQuery(db).findActiveAppointments("u_1", ACTIVE_APPOINTMENT_STATUSES);

    expect(log[0].args).toEqual({
      where: { subjectId: "u_1", status: { in: ACTIVE_APPOINTMENT_STATUSES } },
      include: { slot: { include: { experiment: true } } },
      orderBy: { createdAt: "desc" },
    });
  });

  it("摊平成 busy 形状：只剩状态 + 时段 + 实验标题", async () => {
    const { db } = makeFakeDb({
      appointments: [
        {
          id: "a1",
          status: "CONFIRMED",
          slot: {
            startAt: new Date("2026-11-05T02:00:00Z"),
            endAt: new Date("2026-11-05T03:00:00Z"),
            experiment: { title: "记忆实验", location: "别处" },
          },
        },
      ],
    });
    const rows = await makeSchedulingQuery(db).findActiveAppointments("u_1", ACTIVE_APPOINTMENT_STATUSES);

    expect(rows[0].slot.experiment).toEqual({ title: "记忆实验" });
    expect(rows[0].slot.experiment).not.toHaveProperty("location");
  });
});
