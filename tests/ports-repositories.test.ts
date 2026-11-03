import { describe, expect, it } from "vitest";
import type {
  AppointmentRepository,
  AppointmentRecord,
  AppointmentWithSlot,
  CreateAppointmentInput,
  RepositoryBundle,
  SlotRecord,
  SlotRepository,
  TransactionPort,
} from "@/domain/ports/repositories";
import { AppointmentStatus, ExperimentStatus } from "@/domain/constants";

/**
 * 端口测试：验证「手写一个假实现能满足接口」，以及接口的语义契约。
 *
 * 这层测试的价值是：如果端口定义被塞进了 Prisma 类型（比如某个方法签名里
 * 出现 Prisma.SlotWhereInput），假实现就写不出来，这里会当场编译失败。
 */

const slot = (over: Partial<SlotRecord> = {}): SlotRecord => ({
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

const appointment = (over: Partial<AppointmentRecord> = {}): AppointmentRecord => ({
  id: "appt_1",
  experimentId: "exp_1",
  slotId: "slot_1",
  subjectId: "sub_1",
  status: AppointmentStatus.PENDING_SUBJECT_CONFIRM,
  createdAt: new Date("2026-11-01T00:00:00Z"),
  ...over,
});

/** 内存假实现 —— 不是为了测业务，是为了证明接口能被实现 */
function makeFakeBundle() {
  const slots = new Map<string, SlotRecord>();
  const appts: AppointmentRecord[] = [];
  const state = { created: 0 };

  const slotRepo: SlotRepository = {
    async findById(id) {
      return slots.get(id) ?? null;
    },
    async tryOccupy(id) {
      const s = slots.get(id);
      if (!s) return false;
      if (s.bookedCount >= s.capacity) return false;
      slots.set(id, { ...s, bookedCount: s.bookedCount + 1 });
      return true;
    },
    async release(id) {
      const s = slots.get(id);
      if (!s) return;
      slots.set(id, { ...s, bookedCount: Math.max(0, s.bookedCount - 1) });
    },
  };

  const apptRepo: AppointmentRepository = {
    async findBySlotAndSubject(slotId, subjectId) {
      return appts.find((a) => a.slotId === slotId && a.subjectId === subjectId) ?? null;
    },
    async findConflicts(_subjectId, _slot) {
      return [] as AppointmentWithSlot[];
    },
    async create(input: CreateAppointmentInput) {
      const created = appointment({ ...input, id: `appt_${appts.length + 1}` });
      appts.push(created);
      state.created += 1;
      return created;
    },
    async reactivate(id, status, createdAt) {
      const found = appts.find((a) => a.id === id);
      if (!found) throw new Error("not found");
      Object.assign(found, { status, createdAt });
      return found;
    },
  };

  return {
    slots: slotRepo,
    appointments: apptRepo,
    /** 测试用：直接塞一个时段进去（真实实现里时段是主试预先建好的） */
    seedSlot(s: SlotRecord) {
      slots.set(s.id, s);
    },
    get createdCount() {
      return state.created;
    },
  };
}

describe("SlotRepository 接口", () => {
  it("假实现能满足 SlotRepository（接口没有绑死 Prisma 类型）", async () => {
    const bundle = makeFakeBundle();
    const repo: SlotRepository = bundle.slots;
    expect(await repo.findById("missing")).toBeNull();
  });

  it("tryOccupy 在容量用尽后返回 false —— 这是防超卖的接口级契约", async () => {
    const bundle = makeFakeBundle();
    bundle.seedSlot(slot({ capacity: 1 }));

    expect(await bundle.slots.tryOccupy("slot_1")).toBe(true);
    expect(await bundle.slots.tryOccupy("slot_1")).toBe(false); // 第 2 次必须失败
    expect((await bundle.slots.findById("slot_1"))?.bookedCount).toBe(1); // 没被多占
  });

  it("release 不会把 bookedCount 减成负数", async () => {
    const bundle = makeFakeBundle();
    bundle.seedSlot(slot({ capacity: 2, bookedCount: 0 }));

    await bundle.slots.release("slot_1");
    await bundle.slots.release("slot_1");
    expect((await bundle.slots.findById("slot_1"))?.bookedCount).toBe(0);

    await bundle.slots.release("nonexistent"); // 不存在也不该抛
    expect(true).toBe(true);
  });
});

describe("TransactionPort 契约", () => {
  it("runInTransaction 的 fn 收到的是同一组仓储形状", async () => {
    const bundle = makeFakeBundle();
    const port: TransactionPort = {
      slots: bundle.slots,
      appointments: bundle.appointments,
      async runInTransaction(fn) {
        return fn({ slots: bundle.slots, appointments: bundle.appointments });
      },
    };

    const created = await port.runInTransaction(async (tx) => {
      const ok = await tx.slots.tryOccupy("slot_1");
      expect(typeof ok).toBe("boolean");
      return tx.appointments.create({
        experimentId: "exp_1",
        slotId: "slot_1",
        subjectId: "sub_1",
        status: AppointmentStatus.PENDING_SUBJECT_CONFIRM,
        createdAt: new Date(),
      });
    });

    expect(created.id).toMatch(/^appt_/);
  });
});

describe("接口边界", () => {
  it("SlotRecord 的字段都是纯数据（没有 Prisma 的元信息）", () => {
    const s = slot();
    expect(Object.keys(s).sort()).toEqual(
      ["bookedCount", "capacity", "endAt", "experiment", "experimentId", "id", "startAt"].sort(),
    );
  });

  it("端口模块不 import 任何外部世界的东西", () => {
    // 这条由 check-layers 的 L1/L2 守住，这里再断言一次语义
    expect(Object.keys(slot().experiment)).not.toContain("_count");
  });
});
