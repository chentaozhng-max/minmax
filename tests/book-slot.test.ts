import { describe, expect, it } from "vitest";
import { bookSlot, type BookDeps } from "@/application/book-slot";
import { AppointmentStatus, ExperimentStatus } from "@/domain/constants";
import type { AppointmentRecord, RepositoryBundle, SlotRecord, TransactionPort } from "@/domain/ports/repositories";

/**
 * bookSlot 用例测试 —— 纯内存，零数据库。
 *
 * 核心价值：**用假仓储精确控制「占位成功/失败」**，
 * 验证防超卖在应用层的接法是对的。真数据库很难测"占位失败后没建单"
 * —— 那需要把时间拧到两个请求之间。
 */

const NOW = new Date("2026-11-05T00:00:00Z");

const makeSlot = (over: Partial<SlotRecord> = {}): SlotRecord => ({
  id: "slot_1",
  experimentId: "exp_1",
  startAt: new Date("2026-11-10T10:00:00Z"),
  endAt: new Date("2026-11-10T11:00:00Z"),
  capacity: 1,
  bookedCount: 0,
  experiment: {
    id: "exp_1",
    title: "情绪诱发实验",
    researcherId: "res_1",
    status: ExperimentStatus.PUBLISHED,
    signupDeadline: new Date("2026-11-09T00:00:00Z"),
    minCreditScore: 60,
    needsVerification: false,
  },
  ...over,
});

const existingWith = (status: AppointmentStatus): AppointmentRecord => ({
  id: "appt_old",
  experimentId: "exp_1",
  slotId: "slot_1",
  subjectId: "sub_1",
  status,
  createdAt: NOW,
});

function makeDeps(opts: {
  slot?: SlotRecord | null;
  existing?: AppointmentRecord | null;
  conflicts?: unknown[];
  occupyOk?: boolean;
  journal?: string[];
}): BookDeps & { journal: string[] } {
  const journal = opts.journal ?? [];
  const slot = opts.slot === undefined ? makeSlot() : opts.slot;

  const readers = {
    slots: {
      async findById() {
        return slot;
      },
      async tryOccupy(): Promise<boolean> {
        throw new Error("事务外不该调用 tryOccupy");
      },
      async release() {},
    },
    appointments: {
      async findBySlotAndSubject() {
        return opts.existing ?? null;
      },
      async findConflicts() {
        return (opts.conflicts ?? []) as never;
      },
      async create(): Promise<AppointmentRecord> {
        throw new Error("事务外不该调用 create");
      },
      async reactivate(): Promise<AppointmentRecord> {
        throw new Error("事务外不该调用 reactivate");
      },
    },
  };

  const tx: RepositoryBundle = {
    slots: {
      async findById() {
        return slot;
      },
      async tryOccupy(id) {
        journal.push(`tryOccupy:${id}`);
        return opts.occupyOk ?? true;
      },
      async release() {
        journal.push("release");
      },
    },
    appointments: {
      async findBySlotAndSubject() {
        return null;
      },
      async findConflicts() {
        return [];
      },
      async create(input) {
        journal.push("create");
        return { id: "appt_new", ...input };
      },
      async reactivate(id, status, createdAt) {
        journal.push("reactivate");
        return { id, experimentId: "exp_1", slotId: "slot_1", subjectId: "sub_1", status, createdAt };
      },
    },
  };

  const uow: TransactionPort = {
    slots: tx.slots,
    appointments: tx.appointments,
    async runInTransaction(fn) {
      journal.push("BEGIN");
      const out = await fn(tx);
      journal.push("COMMIT");
      return out;
    },
  };

  return {
    readers,
    uow,
    async loadSubject() {
      return { id: "sub_1", bannedUntil: null, creditScore: 80, studentVerified: true };
    },
    journal,
  };
}

describe("bookSlot — 正常预约", () => {
  it("占位成功 → 建单，返回待确认状态", async () => {
    const deps = makeDeps({});
    const appt = await bookSlot({ userId: "sub_1", slotId: "slot_1", now: NOW }, deps);

    expect(appt.status).toBe(AppointmentStatus.PENDING_SUBJECT_CONFIRM);
    expect(appt.slotId).toBe("slot_1");
  });

  it("顺序：BEGIN → tryOccupy → create → COMMIT", async () => {
    const deps = makeDeps({});
    await bookSlot({ userId: "sub_1", slotId: "slot_1", now: NOW }, deps);
    expect(deps.journal).toEqual(["BEGIN", "tryOccupy:slot_1", "create", "COMMIT"]);
  });

  it("createdAt 用注入的 now（不是机器时钟）", async () => {
    const deps = makeDeps({});
    const appt = await bookSlot({ userId: "sub_1", slotId: "slot_1", now: NOW }, deps);
    expect(appt.createdAt).toEqual(NOW);
  });
});

describe("bookSlot — 防超卖", () => {
  it("占位失败 → 抛 409，且不建单", async () => {
    const deps = makeDeps({ occupyOk: false });
    await expect(bookSlot({ userId: "sub_1", slotId: "slot_1", now: NOW }, deps)).rejects.toThrow(
      "这个时段刚刚被约满了，换一个吧",
    );
    expect(deps.journal).not.toContain("create");
  });

  it("占位失败时走不到 COMMIT（异常穿透出去由事务回滚）", async () => {
    const deps = makeDeps({ occupyOk: false });
    await expect(bookSlot({ userId: "sub_1", slotId: "slot_1", now: NOW }, deps)).rejects.toThrow();
    expect(deps.journal).not.toContain("COMMIT");
  });

  it("占位一定发生在建单之前", async () => {
    const deps = makeDeps({});
    await bookSlot({ userId: "sub_1", slotId: "slot_1", now: NOW }, deps);
    expect(deps.journal.indexOf("tryOccupy:slot_1")).toBeLessThan(deps.journal.indexOf("create"));
  });
});

describe("bookSlot — 复活旧记录", () => {
  it("已有被取消记录 → 走 reactivate 不走 create", async () => {
    const deps = makeDeps({ existing: existingWith(AppointmentStatus.CANCELLED_BY_SUBJECT) });
    await bookSlot({ userId: "sub_1", slotId: "slot_1", now: NOW }, deps);

    expect(deps.journal).toContain("reactivate");
    expect(deps.journal).not.toContain("create");
  });

  it("复活也要占位（名额确实曾被释放）", async () => {
    const deps = makeDeps({ existing: existingWith(AppointmentStatus.NO_SHOW) });
    await bookSlot({ userId: "sub_1", slotId: "slot_1", now: NOW }, deps);
    expect(deps.journal).toContain("tryOccupy:slot_1");
  });

  it("复活时占位失败 → 409，不 reactivate", async () => {
    const deps = makeDeps({ occupyOk: false, existing: existingWith(AppointmentStatus.CANCELLED_BY_SUBJECT) });
    await expect(bookSlot({ userId: "sub_1", slotId: "slot_1", now: NOW }, deps)).rejects.toThrow();
    expect(deps.journal).not.toContain("reactivate");
  });
});

describe("bookSlot — 前置校验（全部不进事务）", () => {
  it("时段不存在 → 404", async () => {
    const deps = makeDeps({ slot: null });
    await expect(bookSlot({ userId: "sub_1", slotId: "slot_1", now: NOW }, deps)).rejects.toThrow("时段不存在");
    expect(deps.journal).toEqual([]);
  });

  it("信誉分不足 → 403", async () => {
    const deps = makeDeps({});
    deps.loadSubject = async () => ({ id: "sub_1", bannedUntil: null, creditScore: 10, studentVerified: true });

    await expect(bookSlot({ userId: "sub_1", slotId: "slot_1", now: NOW }, deps)).rejects.toThrow(/信誉分不足/);
    expect(deps.journal).toEqual([]);
  });

  it("时间冲突 → 409", async () => {
    const deps = makeDeps({
      conflicts: [
        {
          id: "a",
          experimentId: "e",
          slotId: "s",
          subjectId: "sub_1",
          status: AppointmentStatus.CONFIRMED,
          createdAt: NOW,
          slot: { id: "s", startAt: NOW, endAt: NOW, experiment: { title: "决策实验" } },
        },
      ],
    });

    await expect(bookSlot({ userId: "sub_1", slotId: "slot_1", now: NOW }, deps)).rejects.toThrow(/冲突/);
    expect(deps.journal).toEqual([]);
  });

  it("重复预约 → 409", async () => {
    const deps = makeDeps({ existing: existingWith(AppointmentStatus.PENDING_SUBJECT_CONFIRM) });
    await expect(bookSlot({ userId: "sub_1", slotId: "slot_1", now: NOW }, deps)).rejects.toThrow(
      "你已经预约了这个时段",
    );
    expect(deps.journal).toEqual([]);
  });
});

describe("bookSlot — 问卷门槛", () => {
  const needsQuestionnaire = () =>
    makeSlot({ experiment: { ...makeSlot().experiment, needsQuestionnaire: true } });

  it("没通过问卷 → 403，且不进入事务（不占位）", async () => {
    const deps = { ...makeDeps({ slot: needsQuestionnaire() }), questionnairePass: async () => false };

    await expect(bookSlot({ userId: "sub_1", slotId: "slot_1", now: NOW }, deps)).rejects.toThrow(/问卷筛选/);
    expect(deps.journal).toEqual([]);
  });

  it("通过了就正常建单", async () => {
    const deps = { ...makeDeps({ slot: needsQuestionnaire() }), questionnairePass: async () => true };

    const appt = await bookSlot({ userId: "sub_1", slotId: "slot_1", now: NOW }, deps);
    expect(appt.status).toBe(AppointmentStatus.PENDING_SUBJECT_CONFIRM);
    expect(deps.journal).toEqual(["BEGIN", "tryOccupy:slot_1", "create", "COMMIT"]);
  });

  it("不需要问卷的实验不调问卷查询（deps 不注入也能约）", async () => {
    const deps = makeDeps({});
    const appt = await bookSlot({ userId: "sub_1", slotId: "slot_1", now: NOW }, deps);
    expect(appt.id).toBe("appt_new");
  });
});
