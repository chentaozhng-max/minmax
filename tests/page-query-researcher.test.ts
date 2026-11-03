import { describe, expect, it } from "vitest";
import { makeResearcherPageQuery } from "@/adapters/db/prisma/page-query-researcher";
import { makeFakeDb, rawResearcher } from "./_fake-db";

/**
 * 主试公开主页 + 主试个人中心的适配器测试。
 *
 * 个人中心那块最值得盯：原来页面里是一个 Promise.all 套 5 个查询，
 * 搬家时最容易把「并发」变成「串行」或者把某个 where 条件写丢。
 * 用例逐条比对 5 个 where。
 */

describe("findResearcherPublicPage", () => {
  it("只取 PUBLISHED 的实验，按创建时间倒序，带全部时段", async () => {
    const { db, log } = makeFakeDb();
    await makeResearcherPageQuery(db).findResearcherPublicPage("r_1");

    expect(log[0].args).toEqual({
      where: { id: "r_1" },
      include: {
        experiments: {
          where: { status: "PUBLISHED" },
          include: { slots: true },
          orderBy: { createdAt: "desc" },
        },
      },
    });
  });

  it("「按时主持」= reason=ATTENDED 的流水条数", async () => {
    const { db, log } = makeFakeDb({ user: { ...rawResearcher, role: "RESEARCHER", experiments: [] }, creditEventCount: 7 });
    await makeResearcherPageQuery(db).findResearcherPublicPage("r_1");

    const countCall = log.find((l) => l.op === "creditEvent.count");
    expect(countCall!.args).toEqual({ where: { userId: "r_1", reason: "ATTENDED" } });
  });

  it("非 RESEARCHER 角色 → null（页面自己 notFound）", async () => {
    const { db } = makeFakeDb({ user: { ...rawResearcher, role: "SUBJECT", experiments: [] } });
    expect(await makeResearcherPageQuery(db).findResearcherPublicPage("u_1")).toBeNull();
  });

  it("时段只留 startAt/capacity/bookedCount（页面只用来算余位和最近场次）", async () => {
    const { db } = makeFakeDb({
      user: {
        ...rawResearcher,
        role: "RESEARCHER",
        experiments: [{
          id: "e1", title: "t", rewardText: "¥30", durationMin: 30, location: "l",
          slots: [{ id: "s1", startAt: new Date(), endAt: new Date(), capacity: 2, bookedCount: 1 }],
        }],
      },
    });
    const p = await makeResearcherPageQuery(db).findResearcherPublicPage("r_1");
    expect(Object.keys(p!.experiments[0].slots[0]).sort()).toEqual([
      "bookedCount", "capacity", "startAt",
    ]);
  });

  it("⚠️ 主试的 passwordHash / 手机号不出适配层", async () => {
    const { db } = makeFakeDb({ user: { ...rawResearcher, role: "RESEARCHER", experiments: [] } });
    const p = await makeResearcherPageQuery(db).findResearcherPublicPage("r_1");
    const json = JSON.stringify(p);
    expect(json).not.toContain("$2b$10$leak");
    expect(json).not.toContain("13800000001");
  });
});

describe("findResearcherDashboard —— 5 个查询的 where 逐条核对", () => {
  it("最近流水：倒序 + take", async () => {
    const { db, log } = makeFakeDb();
    await makeResearcherPageQuery(db).findResearcherDashboard("r_1", 20);

    const events = log.find((l) => l.op === "creditEvent.findMany");
    expect(events!.args).toEqual({
      where: { userId: "r_1" },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
  });

  it("三个 count 的 where 与重构前一致", async () => {
    const { db, log } = makeFakeDb();
    await makeResearcherPageQuery(db).findResearcherDashboard("r_1", 20);

    const counts = log.filter((l) => l.op === "experiment.count" || l.op === "appointment.count");
    expect(counts).toHaveLength(4);

    const expWhere = counts.filter((c) => c.op === "experiment.count").map((c) => c.args.where);
    expect(expWhere).toEqual([
      { researcherId: "r_1" },
      { researcherId: "r_1", status: "PUBLISHED" },
    ]);

    const apptWhere = counts.filter((c) => c.op === "appointment.count").map((c) => c.args.where);
    expect(apptWhere).toEqual([
      { experiment: { researcherId: "r_1" }, status: { in: ["AWAITING_RESEARCHER", "CHECKED_IN"] } },
      { experiment: { researcherId: "r_1" }, appealStatus: "PENDING" },
    ]);
  });

  it("并发发出（不是串行）：5 个查询在 await 之前就全部 push 进 log", async () => {
    const { db, log } = makeFakeDb();
    const p = makeResearcherPageQuery(db).findResearcherDashboard("r_1", 20);
    // 还没 await，5 个查询就都发出去了 —— 证明保留的是 Promise.all 而非顺序 await
    expect(log).toHaveLength(5);
    await p;
  });

  it("组装成一个对象返回，页面不再关心有几个查询", async () => {
    const { db } = makeFakeDb({
      creditEvents: [{ id: "e1", delta: -2, reason: "NO_SHOW", note: "未到场", createdAt: new Date() }],
      experimentCount: 3,
      appointmentCount: 1,
    });
    const d = await makeResearcherPageQuery(db).findResearcherDashboard("r_1", 20);

    expect(d).toEqual({
      events: [{ id: "e1", delta: -2, reason: "NO_SHOW", note: "未到场", createdAt: expect.any(Date) }],
      experimentCount: 3,
      publishedCount: 3,
      awaitingCount: 1,
      appealCount: 1,
    });
  });
});
