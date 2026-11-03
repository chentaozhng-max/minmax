import { describe, expect, it } from "vitest";
import {
  makeAccountPageQuery,
  makeExperimentPageQuery,
} from "@/adapters/db/prisma/page-query-experiment";
import type { PageQueryClientLike } from "@/adapters/db/prisma/types";
import { makeFakeDb, rawResearcher } from "./_fake-db";

/**
 * 实验详情页 + 账号表单页的适配器测试。
 *
 * 断言重点：**查询形状没变**（args 深比较）+ **字段收窄生效**。
 * 专门盯住「页面把手伸得太长」的点：
 *   - 实验详情页原来能摸到主试的 passwordHash / eduEmail / studentId
 *   - 认证 / 完善资料页把整个 user 传给客户端组件
 */

describe("findExperimentPageDetail", () => {
  it("include 主试 + 时段升序（与重构前一致）", async () => {
    const { db, log } = makeFakeDb();
    await makeExperimentPageQuery(db).findExperimentPageDetail("exp_1");

    expect(log[0].args).toEqual({
      where: { id: "exp_1" },
      include: { researcher: true, slots: { orderBy: { startAt: "asc" } } },
    });
  });

  it("⚠️ 主试的 passwordHash / eduEmail / 手机号不出适配层", async () => {
    const { db } = makeFakeDb({
      experiment: {
        id: "exp_1",
        title: "面孔吸引力判断实验",
        researcherId: "r_1",
        status: "PUBLISHED",
        type: "INDIVIDUAL",
        groupSize: null,
        location: "俊秀楼 305",
        durationMin: 30,
        rewardText: "¥30",
        description: "描述",
        requirements: null,
        minCreditScore: 0,
        needsVerification: false,
        signupDeadline: new Date("2026-11-08T15:59:00Z"),
        researcher: rawResearcher,
        slots: [],
      },
    });
    const d = await makeExperimentPageQuery(db).findExperimentPageDetail("exp_1");

    const json = JSON.stringify(d);
    for (const secret of ["$2b$10$leak", "chenyan@psy.ecnu.edu.cn", "13800000001", "rt_leak", "2019001"]) {
      expect(json).not.toContain(secret);
    }
    expect(Object.keys(d!.researcher).sort()).toEqual([
      "creditScore",
      "department",
      "id",
      "name",
      "school",
      "studentVerified",
    ]);
  });

  it("时段顺序原样保留（升序由 SQL 保证，适配器不重排）", async () => {
    const slots = [
      { id: "s1", startAt: new Date("2026-11-03T02:00:00Z"), endAt: new Date("2026-11-03T02:30:00Z"), capacity: 2, bookedCount: 2 },
      { id: "s2", startAt: new Date("2026-11-04T02:00:00Z"), endAt: new Date("2026-11-04T02:30:00Z"), capacity: 2, bookedCount: 0 },
    ];
    const { db } = makeFakeDb({
      experiment: {
        id: "exp_1", title: "t", researcherId: "r_1", status: "PUBLISHED", type: "INDIVIDUAL",
        groupSize: null, location: "l", durationMin: 30, rewardText: "r", description: "d",
        requirements: null, minCreditScore: 0, needsVerification: false, signupDeadline: new Date(),
        researcher: rawResearcher, slots,
      },
    });
    const d = await makeExperimentPageQuery(db).findExperimentPageDetail("exp_1");
    expect(d!.slots.map((s) => s.id)).toEqual(["s1", "s2"]);
  });

  it("不存在 → null", async () => {
    const { db } = makeFakeDb();
    expect(await makeExperimentPageQuery(db).findExperimentPageDetail("nope")).toBeNull();
  });
});

describe("findMyAppointment", () => {
  it("按实验 + 被试 + 有效状态查，带 slot", async () => {
    const { db, log } = makeFakeDb();
    const statuses = ["PENDING_SUBJECT_CONFIRM", "CONFIRMED"];
    await makeExperimentPageQuery(db).findMyAppointment("exp_1", "u_1", statuses);

    expect(log[0].op).toBe("appointment.findFirst");
    expect(log[0].args).toEqual({
      where: { experimentId: "exp_1", subjectId: "u_1", status: { in: statuses } },
      include: { slot: true },
    });
  });

  it("只返回 id / status / slot 起止（渲染「已约 xx」够用）", async () => {
    const { db } = makeFakeDb({
      myAppointment: {
        id: "a1",
        status: "CHECKED_IN",
        slot: {
          id: "s1",
          startAt: new Date("2026-11-01T07:00:00Z"),
          endAt: new Date("2026-11-01T07:30:00Z"),
          capacity: 2,
          bookedCount: 1,
        },
      },
    });
    const m = await makeExperimentPageQuery(db).findMyAppointment("exp_1", "u_1", ["CONFIRMED"]);
    expect(Object.keys(m!.slot).sort()).toEqual(["endAt", "startAt"]);
  });
});

describe("countPublishedExperiments", () => {
  it("只数 PUBLISHED", async () => {
    const { db, log } = makeFakeDb({ experimentCount: 3 });
    const n = await makeExperimentPageQuery(db).countPublishedExperiments("r_1");
    expect(log[0].args).toEqual({ where: { researcherId: "r_1", status: "PUBLISHED" } });
    expect(n).toBe(3);
  });
});

describe("findVerifyFormUser / findOnboardingUser", () => {
  it("认证表单用 select 收窄到 4 个字段", async () => {
    const { db, log } = makeFakeDb({ user: { studentVerified: true, school: "华东师大", studentId: "1021", eduEmail: "a@b.c" } });
    await makeAccountPageQuery(db).findVerifyFormUser("u_1");

    expect(log[0].args.select).toEqual({
      studentVerified: true,
      school: true,
      studentId: true,
      eduEmail: true,
    });
  });

  it("⚠️ 认证表单不会拿到 passwordHash（select 白名单制）", async () => {
    const { db } = makeFakeDb({
      user: { studentVerified: true, school: "华东师大", studentId: "1021", eduEmail: "a@b.c" },
    });
    const u = await makeAccountPageQuery(db).findVerifyFormUser("u_1");
    expect(Object.keys(u!).sort()).toEqual(["eduEmail", "school", "studentId", "studentVerified"]);
  });

  it("完善资料页 select 6 个字段", async () => {
    const { db, log } = makeFakeDb({ user: { role: "SUBJECT", school: "x", department: "y", grade: "大二", interests: "a,b", timePreference: "下午" } });
    await makeAccountPageQuery(db).findOnboardingUser("u_1");

    expect(Object.keys(log[0].args.select).sort()).toEqual([
      "department", "grade", "interests", "role", "school", "timePreference",
    ]);
  });

  it("不存在 → null", async () => {
    const { db } = makeFakeDb();
    expect(await makeAccountPageQuery(db).findVerifyFormUser("nope")).toBeNull();
  });
});
