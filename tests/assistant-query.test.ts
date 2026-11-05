import { describe, expect, it } from "vitest";
import { makeAssistantQuery } from "@/adapters/db/prisma/assistant-query";

const FROM = new Date("2026-11-05T00:00:00.000Z");

/** 假 Prisma：只实现 appointment.findMany，记录 args 以便断言查询形状 */
function makeFakeDb(rows: unknown[] = []) {
  const calls: unknown[] = [];
  return {
    db: {
      appointment: {
        findMany: async (args: unknown) => {
          calls.push(args);
          return rows;
        },
      },
    },
    calls,
  };
}

function rawRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "a1",
    status: "CONFIRMED",
    experimentId: "e1",
    slot: {
      startAt: new Date("2026-11-05T06:00:00.000Z"),
      endAt: new Date("2026-11-05T06:30:00.000Z"),
    },
    experiment: {
      title: "面孔识别实验",
      location: "心理学楼 302",
      researcher: { name: "张老师" },
    },
    ...overrides,
  };
}

describe("makeAssistantQuery", () => {
  it("★ 状态过滤进 where，不查完再筛", async () => {
    const { db, calls } = makeFakeDb();
    await makeAssistantQuery(db as never).listMyUpcomingAppointments("u1", FROM, [
      "CONFIRMED",
      "CHECKED_IN",
    ]);
    expect((calls[0] as { where: unknown }).where).toEqual({
      subjectId: "u1",
      status: { in: ["CONFIRMED", "CHECKED_IN"] },
      slot: { startAt: { gte: FROM } },
    });
  });

  it("★ 空状态列表 → 不打库，直接返回空", async () => {
    // 「什么都不算占用」是合法输入，不该白白吃一次查询
    const { db, calls } = makeFakeDb([rawRow()]);
    const rows = await makeAssistantQuery(db as never).listMyUpcomingAppointments("u1", FROM, []);
    expect(rows).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("按开始时间升序，同一时刻按 id 兜底（顺序稳定）", async () => {
    const { db, calls } = makeFakeDb();
    await makeAssistantQuery(db as never).listMyUpcomingAppointments("u1", FROM, ["CONFIRMED"]);
    expect((calls[0] as { orderBy: unknown }).orderBy).toEqual([
      { slot: { startAt: "asc" } },
      { id: "asc" },
    ]);
  });

  it("把嵌套的 slot / experiment 摊平成助手要的扁形状", async () => {
    const { db } = makeFakeDb([rawRow()]);
    const [row] = await makeAssistantQuery(db as never).listMyUpcomingAppointments("u1", FROM, [
      "CONFIRMED",
    ]);
    expect(row.experimentTitle).toBe("面孔识别实验");
    expect(row.location).toBe("心理学楼 302");
    expect(row.researcherName).toBe("张老师");
    expect(row.startAt).toEqual(new Date("2026-11-05T06:00:00.000Z"));
  });

  it("主试被删（researcher 为 null）→ 名字兜底成空串，不炸", async () => {
    const { db } = makeFakeDb([rawRow({ experiment: { title: "x", location: "y", researcher: null } })]);
    const [row] = await makeAssistantQuery(db as never).listMyUpcomingAppointments("u1", FROM, [
      "CONFIRMED",
    ]);
    expect(row.researcherName).toBe("");
  });

  it("只 select 需要的字段（不把实验描述、申诉备注一起捞回来）", async () => {
    const { db, calls } = makeFakeDb();
    await makeAssistantQuery(db as never).listMyUpcomingAppointments("u1", FROM, ["CONFIRMED"]);
    const select = (calls[0] as { select: Record<string, unknown> }).select;
    expect(Object.keys(select).sort()).toEqual(["experiment", "experimentId", "id", "slot", "status"]);
  });
});

/* ---------------- 做过的实验（会话的持久事实之一）---------------- */

describe("makeAssistantQuery.listMyPastExperiments", () => {
  function pastRow(overrides: Record<string, unknown> = {}) {
    return {
      id: "a1",
      status: "COMPLETED",
      experimentId: "e1",
      slot: { endAt: new Date("2026-10-01T06:30:00.000Z") },
      experiment: { title: "面孔识别实验" },
      ...overrides,
    };
  }

  it("★ 时间窗进 where（slot.endAt < before），不在内存里筛", async () => {
    const { db, calls } = makeFakeDb([]);
    await makeAssistantQuery(db as never).listMyPastExperiments("u1", FROM, ["COMPLETED"]);
    expect((calls[0] as { where: unknown }).where).toEqual({
      subjectId: "u1",
      status: { in: ["COMPLETED"] },
      slot: { endAt: { lt: FROM } },
    });
  });

  it("★ 按完成时间倒序（最近做的排前面）", async () => {
    const { db, calls } = makeFakeDb([]);
    await makeAssistantQuery(db as never).listMyPastExperiments("u1", FROM, ["COMPLETED"]);
    expect((calls[0] as { orderBy: unknown }).orderBy).toEqual([
      { slot: { endAt: "desc" } },
      { id: "desc" },
    ]);
  });

  it("空状态列表 → 不打库", async () => {
    const { db, calls } = makeFakeDb([pastRow()]);
    expect(await makeAssistantQuery(db as never).listMyPastExperiments("u1", FROM, [])).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("摊平成 PastExperiment（appointmentId / finishedAt 都要有）", async () => {
    const { db } = makeFakeDb([pastRow()]);
    const [row] = await makeAssistantQuery(db as never).listMyPastExperiments("u1", FROM, [
      "COMPLETED",
    ]);
    expect(row).toEqual({
      appointmentId: "a1",
      experimentId: "e1",
      experimentTitle: "面孔识别实验",
      finishedAt: new Date("2026-10-01T06:30:00.000Z"),
      status: "COMPLETED",
    });
  });
});
