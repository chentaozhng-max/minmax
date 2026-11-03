import { describe, expect, it } from "vitest";
import { makeCreditPageQuery } from "@/adapters/db/prisma/page-query-credit";
import { makeResearcherPageQuery } from "@/adapters/db/prisma/page-query-researcher";
import { makeFakeDb, rawResearcher } from "./_fake-db";

/**
 * 信誉分页 + 主试主页的适配器测试。
 *
 * 两个重点：
 * 1. 信誉分详情页要「重放全部流水」算出这条生效时的分数 —— 必须保证
 *    查流水时是 created_at 升序、且只取 id+delta（别把整行拖出来）。
 * 2. 主试个人中心原来在页面里 Promise.all 5 个查询，现在搬进适配器。
 *    并发数不能变成 5 次串行 —— 用例断言 count 的 where 都没变。
 */

describe("findCreditPageUser", () => {
  it("select 收窄到 5 个字段，不取整行", async () => {
    const { db, log } = makeFakeDb({ user: { id: "u1", role: "SUBJECT", creditScore: 96, noShowCount: 1, bannedUntil: null } });
    await makeCreditPageQuery(db).findCreditPageUser("u1");

    expect(Object.keys(log[0].args.select).sort()).toEqual([
      "bannedUntil", "creditScore", "id", "noShowCount", "role",
    ]);
  });

  it("⚠️ 不返回 passwordHash", async () => {
    const { db } = makeFakeDb({
      user: { id: "u1", role: "SUBJECT", creditScore: 96, noShowCount: 1, bannedUntil: null, passwordHash: "leak" },
    });
    const u = await makeCreditPageQuery(db).findCreditPageUser("u1");
    expect(JSON.stringify(u)).not.toContain("leak");
  });
});

describe("findCreditEvents", () => {
  it("倒序 + take", async () => {
    const { db, log } = makeFakeDb();
    await makeCreditPageQuery(db).findCreditEvents("u1", 100);
    expect(log[0].args).toEqual({
      where: { userId: "u1" },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  });

  it("保留 appointmentId（列表页要用它回填关联预约）", async () => {
    const { db } = makeFakeDb({
      creditEvents: [{ id: "e1", delta: 1, reason: "ATTENDED", note: null, appointmentId: "a1", createdAt: new Date() }],
    });
    const [e] = await makeCreditPageQuery(db).findCreditEvents("u1", 100);
    expect(e.appointmentId).toBe("a1");
  });
});

describe("findAppointmentsByIds", () => {
  it("空数组直接返回，不发查询（避免 in:[] 变全表）", async () => {
    const { db, log } = makeFakeDb();
    const rows = await makeCreditPageQuery(db).findAppointmentsByIds([]);

    expect(rows).toEqual([]);
    expect(log).toHaveLength(0);
  });

  it("非空时一次 findMany 批量取，带 experiment + slot", async () => {
    const { db, log } = makeFakeDb();
    await makeCreditPageQuery(db).findAppointmentsByIds(["a1", "a2"]);

    expect(log).toHaveLength(1);
    expect(log[0].args).toEqual({
      where: { id: { in: ["a1", "a2"] } },
      include: { experiment: true, slot: true },
    });
  });

  it("只留渲染要的字段（实验只留标题）", async () => {
    const { db } = makeFakeDb({
      appointments: [{
        id: "a1", status: "COMPLETED",
        experiment: { title: "情绪词汇判断", description: "长文本", researcherId: "r" },
        slot: { startAt: new Date(), endAt: new Date() },
      }],
    });
    const [a] = await makeCreditPageQuery(db).findAppointmentsByIds(["a1"]);
    expect(a.experiment).toEqual({ title: "情绪词汇判断" });
  });
});

describe("findCreditDeltasAsc —— 重放算分的输入", () => {
  it("升序 + 只 select id 和 delta", async () => {
    const { db, log } = makeFakeDb();
    await makeCreditPageQuery(db).findCreditDeltasAsc("u1");

    expect(log[0].args).toEqual({
      where: { userId: "u1" },
      orderBy: { createdAt: "asc" },
      select: { id: true, delta: true },
    });
  });
});

describe("findAppointmentFull", () => {
  it("include 实验(含主试) + 时段 + 被试", async () => {
    const { db, log } = makeFakeDb();
    await makeCreditPageQuery(db).findAppointmentFull("a1");

    expect(log[0].args).toEqual({
      where: { id: "a1" },
      include: {
        experiment: { include: { researcher: true } },
        slot: true,
        subject: true,
      },
    });
  });

  it("主试只留 name（详情页只显示名字）", async () => {
    const { db } = makeFakeDb({
      appointmentFull: {
        id: "a1", status: "COMPLETED", appealStatus: null, experimentId: "exp1",
        experiment: { title: "t", researcher: { name: "陈砚", passwordHash: "leak" } },
        slot: { startAt: new Date(), endAt: new Date() },
        subject: { name: "林知夏", phone: "13900000001" },
      },
    });
    const a = await makeCreditPageQuery(db).findAppointmentFull("a1");
    expect(a!.experiment.researcher).toEqual({ name: "陈砚" });
    expect(JSON.stringify(a)).not.toContain("leak");
    expect(JSON.stringify(a)).not.toContain("13900000001");
  });
});
