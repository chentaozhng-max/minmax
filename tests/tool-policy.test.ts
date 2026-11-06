import { describe, expect, it } from "vitest";
import {
  evaluateToolCall,
  recordToolCall,
  MAX_CALLS_PER_TOOL,
  MAX_READ_CALLS_PER_TURN,
  type ToolCallState,
  type ToolRisk,
} from "@/domain/tool-policy";

/** 一个干净的 state */
function state(over: Partial<ToolCallState> = {}): ToolCallState {
  return { turnCalls: [], appointmentBooked: false, availableSlotIds: [], ...over };
}

function call(name: string, args: Record<string, unknown> = {}, risk: ToolRisk = "read") {
  return evaluateToolCall({ name, risk, args, argsKey: JSON.stringify(args), state: state() });
}

/** 六个读类调用 —— 正好用满读预算 */
function sixReads() {
  return [
    "get_available_slots",
    "get_my_busy_slots",
    "get_my_credit_status",
    "search_experiments",
    "get_available_slots",
    "get_my_busy_slots",
  ].map((name, i) => ({ name, args: `{"i":${i}}` }));
}

describe("book_slot 一律拒绝（下单只能由用户点组件）", () => {
  it("无条件 deny，哪怕用户已经确认过", () => {
    // 前端 SlotGrid 是「用户点卡片 → POST /api/appointments」，
    // 模型调 book_slot 只会绕过那一手。所以这里没有「确认了就放行」这条分支。
    const v = call("book_slot", { slotId: "s1" }, "write");
    expect(v.allow).toBe(false);
    if (v.allow) return;
    expect(v.rule).toBe("HUMAN_CONFIRMS_ORDER");
    expect(v.denied).toBe(true);
  });

  it("原因里必须点名 propose_slots —— 只说不允许模型会原样重试", () => {
    const v = call("book_slot", { slotId: "s1" }, "write");
    if (v.allow) throw new Error("应当被拒绝");
    expect(v.reason).toContain("propose_slots");
  });
});

describe("join_waitlist 拒绝（功能未真正实现，不能骗用户）", () => {
  it("deny 并指向 escalate_to_researcher", () => {
    const v = call("join_waitlist", {}, "write");
    if (v.allow) throw new Error("应当被拒绝");
    expect(v.rule).toBe("WAITLIST_UNSUPPORTED");
    expect(v.reason).toContain("escalate_to_researcher");
  });
});

/* SECTION_PROPOSE */
describe("propose_slots 的参数必须来自事实源", () => {
  it("全部 id 都在候选里 → 放行", () => {
    const v = evaluateToolCall({
      name: "propose_slots",
      risk: "side-effect",
      args: { slotIds: ["s1", "s2"] },
      argsKey: '{"slotIds":["s1","s2"]}',
      state: state({ availableSlotIds: ["s1", "s2", "s3"] }),
    });
    expect(v.allow).toBe(true);
  });

  it("有一个 id 是编的 → 拒绝", () => {
    const v = evaluateToolCall({
      name: "propose_slots",
      risk: "side-effect",
      args: { slotIds: ["s1", "ghost"] },
      argsKey: '{"slotIds":["s1","ghost"]}',
      state: state({ availableSlotIds: ["s1", "s2"] }),
    });
    if (v.allow) throw new Error("应当被拒绝");
    expect(v.rule).toBe("ARG_NOT_FROM_SOURCE");
    expect(v.reason).toContain("get_available_slots");
  });

  it("调用方没提供候选列表（空数组）→ 不校验，放行", () => {
    // 关键：空数组 = 「没提供」，不是「一个都没有，所以全都非法」。
    // 后者会在没有空位的实验里把合法调用也否掉。
    const v = evaluateToolCall({
      name: "propose_slots",
      risk: "side-effect",
      args: { slotIds: ["s1"] },
      argsKey: '{"slotIds":["s1"]}',
      state: state({ availableSlotIds: [] }),
    });
    expect(v.allow).toBe(true);
  });

  it("slotIds 不是数组（模型给了字符串）→ 不崩，按空处理放行", () => {
    const v = evaluateToolCall({
      name: "propose_slots",
      risk: "side-effect",
      args: { slotIds: "s1" },
      argsKey: '{"slotIds":"s1"}',
      state: state({ availableSlotIds: ["s1"] }),
    });
    expect(v.allow).toBe(true);
  });
});

/* SECTION_PROPOSE_END */


/* SECTION_REPEAT */
describe("同轮重复与刷次数", () => {
  it("同 name + 同 args 第二次 → DUPLICATE_CALL", () => {
    const v = evaluateToolCall({
      name: "get_available_slots",
      risk: "read",
      args: {},
      argsKey: "{}",
      state: state({ turnCalls: [{ name: "get_available_slots", args: "{}" }] }),
    });
    if (v.allow) throw new Error("应当被拒绝");
    expect(v.rule).toBe("DUPLICATE_CALL");
  });

  it(`同工具到第 ${MAX_CALLS_PER_TOOL + 1} 次 → REPEAT_TOOL`, () => {
    // 常量语义：允许用 MAX_CALLS_PER_TOOL 次，第 MAX+1 次拦下
    const v = evaluateToolCall({
      name: "search_experiments",
      risk: "read",
      args: { keyword: "d" },
      argsKey: '{"keyword":"d"}',
      state: state({
        turnCalls: Array.from({ length: MAX_CALLS_PER_TOOL }, (_, i) => ({
          name: "search_experiments",
          args: `{"keyword":"${i}"}`,
        })),
      }),
    });
    if (v.allow) throw new Error("应当被拒绝");
    expect(v.rule).toBe("REPEAT_TOOL");
  });

  it("不同工具不算重复", () => {
    const v = evaluateToolCall({
      name: "get_my_credit_status",
      risk: "read",
      args: {},
      argsKey: "{}",
      state: state({
        turnCalls: [
          { name: "get_available_slots", args: "{}" },
          { name: "get_my_busy_slots", args: "{}" },
        ],
      }),
    });
    expect(v.allow).toBe(true);
  });

  it(`读到第 ${MAX_READ_CALLS_PER_TURN + 1} 次 → TURN_BUDGET`, () => {
    const v = evaluateToolCall({
      name: "get_my_credit_status",
      risk: "read",
      args: {},
      argsKey: "{}",
      state: state({ turnCalls: sixReads() }),
    });
    if (v.allow) throw new Error("应当被拒绝");
    expect(v.rule).toBe("TURN_BUDGET");
  });

  it("写类调用不占读类预算", () => {
    // 否则「读了 6 次」会被一次下单顶掉 —— 下单不该给阅读额度充值
    const v = evaluateToolCall({
      name: "escalate_to_researcher",
      risk: "side-effect",
      args: { message: "hi" },
      argsKey: '{"message":"hi"}',
      state: state({ turnCalls: sixReads() }),
    });
    expect(v.allow).toBe(true);
  });

  it(`同工具到 ${MAX_CALLS_PER_TOOL} 次就拦，不必等到读预算耗尽`, () => {
    const v = evaluateToolCall({
      name: "get_available_slots",
      risk: "read",
      args: {},
      argsKey: "{}",
      state: state({
        turnCalls: Array.from({ length: MAX_CALLS_PER_TOOL }, () => ({
          name: "get_available_slots",
          args: "{}",
        })),
      }),
    });
    if (v.allow) throw new Error("应当被拒绝");
    expect(["REPEAT_TOOL", "DUPLICATE_CALL"]).toContain(v.rule);
  });
});

/* SECTION_REPEAT_END */

/* SECTION_BOOKED */
describe("已约成之后不许再写", () => {
  it("appointmentBooked + write → ALREADY_BOOKED", () => {
    const v = evaluateToolCall({
      name: "some_future_write_tool",
      risk: "write",
      args: {},
      argsKey: "{}",
      state: state({ appointmentBooked: true }),
    });
    if (v.allow) throw new Error("应当被拒绝");
    expect(v.rule).toBe("ALREADY_BOOKED");
  });

  it("已约成但读类照旧放行", () => {
    const v = evaluateToolCall({
      name: "get_my_busy_slots",
      risk: "read",
      args: {},
      argsKey: "{}",
      state: state({ appointmentBooked: true }),
    });
    expect(v.allow).toBe(true);
  });

  it("book_slot 在已约成时仍报 HUMAN_CONFIRMS_ORDER（先命中更根本的那条）", () => {
    const v = evaluateToolCall({
      name: "book_slot",
      risk: "write",
      args: { slotId: "s1" },
      argsKey: '{"slotId":"s1"}',
      state: state({ appointmentBooked: true }),
    });
    if (v.allow) throw new Error("应当被拒绝");
    expect(v.rule).toBe("HUMAN_CONFIRMS_ORDER");
  });
});

/* SECTION_BOOKED_END */

/* SECTION_RECORD */
describe("recordToolCall", () => {
  it("追加调用记录，不改原对象", () => {
    const before = state();
    const after = recordToolCall({ name: "get_available_slots", argsKey: "{}", state: before });
    expect(before.turnCalls).toHaveLength(0);
    expect(after.turnCalls).toHaveLength(1);
  });

  it("被拦下的调用也要记 —— 否则重试会永远得到第一次的判定", () => {
    // 这条是闸生效的前提：模型原样重试 book_slot 时，
    // 如果没有记录，每次都会被当成「第一次」放过去
    const after = recordToolCall({ name: "book_slot", argsKey: '{"slotId":"s1"}', state: state() });
    expect(after.turnCalls).toHaveLength(1);
    const again = evaluateToolCall({
      name: "book_slot",
      risk: "write",
      args: { slotId: "s1" },
      argsKey: '{"slotId":"s1"}',
      state: after,
    });
    expect(again.allow).toBe(false);
  });

  it("booked=true 会把状态带到下一轮判断", () => {
    const after = recordToolCall({ name: "x", argsKey: "{}", state: state(), booked: true });
    expect(after.appointmentBooked).toBe(true);
  });

  it("不传 booked 时保留原值", () => {
    const after = recordToolCall({
      name: "x",
      argsKey: "{}",
      state: state({ appointmentBooked: true }),
    });
    expect(after.appointmentBooked).toBe(true);
  });
});

/* SECTION_RECORD_END */

/* SECTION_NORMAL */
describe("正常路径不受影响", () => {
  it("第一次读时段放行", () => {
    expect(call("get_available_slots", {}, "read").allow).toBe(true);
  });

  it("第一次 propose_slots 放行", () => {
    expect(call("propose_slots", { slotIds: ["s1"] }, "side-effect").allow).toBe(true);
  });

  it("escalate_to_researcher 放行（语义是留言，不承诺排队）", () => {
    expect(call("escalate_to_researcher", { message: "hi" }, "side-effect").allow).toBe(true);
  });
});
/* SECTION_NORMAL_END */

