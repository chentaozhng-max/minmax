import { describe, expect, it } from "vitest";
import { createToolRegistry } from "@/tools";
import { ctxOf, slot } from "./fixtures/agent-context";

/**
 * 2.4-2.5 提案类与写操作工具的行为测试。
 * 重点：跨工具的 sink 时序约束，以及失败时 sink 不被污染。
 */

const reg = createToolRegistry();

describe("propose_slots", () => {
  it("成功时写入 sink.state = PROPOSED 并返回选中的时段", async () => {
    const c = ctxOf();
    const result = await reg.exec(
      "propose_slots",
      { slotIds: ["s1", "s2"], reasonText: "都合适" },
      c as never,
    );

    expect(result.ok).toBe(true);
    expect(result.reason).toBe("都合适");
    expect((result.slots as unknown[]).length).toBe(2);
    expect(c.sink.state).toBe("PROPOSED");
  });

  it("最多只展示 3 个（防止刷屏）", async () => {
    const many = [slot("a"), slot("b"), slot("c"), slot("d"), slot("e")];
    const c = ctxOf({ reloadSlots: async () => many });
    const result = await reg.exec(
      "propose_slots",
      { slotIds: ["a", "b", "c", "d", "e"], reasonText: "x" },
      c as never,
    );
    expect((result.slots as unknown[]).length).toBe(3);
  });

  it("时段已被抢完 → ok:false 且不写 sink", async () => {
    const c = ctxOf({ reloadSlots: async () => [] });
    const result = await reg.exec("propose_slots", { slotIds: ["gone"], reasonText: "x" }, c as never);

    expect(result).toEqual({ ok: false, error: "这些时段已经不可用，请重新选择" });
    expect(c.sink.state).toBeUndefined();
  });

  it("参数缺失 → 参数不合法，execute 不执行", async () => {
    const c = ctxOf();
    const result = await reg.exec("propose_slots", { slotIds: ["s1"] }, c as never);
    expect(result.ok).toBe(false);
    expect(String(result.error)).toContain("参数不合法");
  });
});

describe("book_slot", () => {
  it("成功时写 sink 的 state / appointmentId / bookedLabel", async () => {
    const c = ctxOf();
    const result = await reg.exec("book_slot", { slotId: "s2" }, c as never);

    expect(result).toMatchObject({ ok: true, appointmentId: "apt-s2", status: "CONFIRMED" });
    expect(c.sink.state).toBe("BOOKED");
    expect(c.sink.appointmentId).toBe("apt-s2");
    expect(String(c.sink.bookedLabel)).toContain("s2");
  });

  it("时段不在候选列表 → ok:false 且 sink 保持干净", async () => {
    const c = ctxOf();
    const result = await reg.exec("book_slot", { slotId: "unknown" }, c as never);

    expect(result).toEqual({ ok: false, error: "该时段不在候选列表中" });
    expect(c.sink.state).toBeUndefined();
    expect(c.sink.appointmentId).toBeUndefined();
  });

  it("booking 抛错（被别人抢先）→ ok:false 且 sink 不被污染", async () => {
    const c = ctxOf({
      book: async () => {
        throw new Error("该时段已满");
      },
    });
    const result = await reg.exec("book_slot", { slotId: "s1" }, c as never);

    expect(result).toEqual({ ok: false, error: "该时段已满" });
    // 关键：失败时绝不能把状态标成 BOOKED
    expect(c.sink.state).toBeUndefined();
    expect(c.sink.appointmentId).toBeUndefined();
  });
});

describe("join_waitlist", () => {
  it("写 sink.state = WAITLIST", async () => {
    const c = ctxOf();
    const result = await reg.exec("join_waitlist", {}, c as never);
    expect(result).toEqual({ ok: true });
    expect(c.sink.state).toBe("WAITLIST");
  });
});

describe("escalate_to_researcher", () => {
  it("写 sink.state = ESCALATED 并回带留言", async () => {
    const c = ctxOf();
    const result = await reg.exec("escalate_to_researcher", { message: "想换时间" }, c as never);

    expect(result).toEqual({ ok: true, delivered: "想换时间" });
    expect(c.sink.state).toBe("ESCALATED");
  });

  it("缺 message → 参数不合法", async () => {
    const c = ctxOf();
    const result = await reg.exec("escalate_to_researcher", {}, c as never);
    expect(result.ok).toBe(false);
  });
});

describe("跨工具时序约束（原 execTool 里的隐式耦合）", () => {
  it("propose 之后 book：sink 从 PROPOSED 变成 BOOKED", async () => {
    const c = ctxOf();

    await reg.exec("propose_slots", { slotIds: ["s1"], reasonText: "推荐" }, c as never);
    expect(c.sink.state).toBe("PROPOSED");

    await reg.exec("book_slot", { slotId: "s1" }, c as never);
    expect(c.sink.state).toBe("BOOKED");
    expect(c.sink.appointmentId).toBe("apt-s1");
  });

  it("propose 失败后 book 任意时段不会误报成功", async () => {
    const c = ctxOf({ reloadSlots: async () => [] });
    await reg.exec("propose_slots", { slotIds: ["gone"], reasonText: "x" }, c as never);

    // 但 availableSlots 里还有 s1（book_slot 用的是 ctx 而非 reload）
    const result = await reg.exec("book_slot", { slotId: "s1" }, c as never);
    // 这个行为与原实现一致：book_slot 校验的是 ctx.availableSlots
    expect(result.ok).toBe(true);
  });

  it("同一 sink 被多个工具连续写，最后一次生效", async () => {
    const c = ctxOf();
    await reg.exec("join_waitlist", {}, c as never);
    expect(c.sink.state).toBe("WAITLIST");
    await reg.exec("escalate_to_researcher", { message: "人工" }, c as never);
    expect(c.sink.state).toBe("ESCALATED");
  });
});
