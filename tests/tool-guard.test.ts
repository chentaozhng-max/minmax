import { describe, expect, it } from "vitest";
import {
  createGuardState,
  deniedResult,
  guardToolCall,
  noteToolCall,
  stableArgsKey,
} from "@/tools/guard";

/* SECTION_KEY */
describe("stableArgsKey", () => {
  it("字段顺序不同但内容一样 → 同一个键", () => {
    // 模型不保证字段顺序。不排序的话重复检测会漏掉一半。
    expect(stableArgsKey({ a: 1, b: 2 })).toBe(stableArgsKey({ b: 2, a: 1 }));
  });

  it("值不同 → 不同的键", () => {
    expect(stableArgsKey({ a: 1 })).not.toBe(stableArgsKey({ a: 2 }));
  });

  it("空对象稳定", () => {
    expect(stableArgsKey({})).toBe("{}");
  });

  it("嵌套对象值不参与排序（顶层排序够用，只求稳定）", () => {
    expect(stableArgsKey({ x: { p: 1, q: 2 } })).toBe(stableArgsKey({ x: { p: 1, q: 2 } }));
  });
});

/* SECTION_KEY_END */

/* SECTION_FLOW */
describe("guardToolCall + noteToolCall 配合", () => {
  it("第一次读工具放行", () => {
    const guard = createGuardState();
    expect(guardToolCall({ name: "get_available_slots", args: {}, guard }).allow).toBe(true);
  });

  it("记录之后，同样的调用被当重复", () => {
    const guard = createGuardState();
    noteToolCall({ name: "get_available_slots", args: {}, guard });
    const v = guardToolCall({ name: "get_available_slots", args: {}, guard });
    if (v.allow) throw new Error("应当被拒绝");
    expect(v.rule).toBe("DUPLICATE_CALL");
  });

  it("字段顺序不同的同一调用也能识别为重复", () => {
    const guard = createGuardState();
    noteToolCall({ name: "propose_slots", args: { slotIds: ["s1"], reasonText: "x" }, guard });
    const v = guardToolCall({
      name: "propose_slots",
      args: { reasonText: "x", slotIds: ["s1"] },
      guard,
    });
    if (v.allow) throw new Error("应当被拒绝");
    expect(v.rule).toBe("DUPLICATE_CALL");
  });

  it("book_slot 无条件被拦（不看风险声明）", () => {
    const guard = createGuardState();
    const v = guardToolCall({ name: "book_slot", args: { slotId: "s1" }, risk: "write", guard });
    if (v.allow) throw new Error("应当被拒绝");
    expect(v.rule).toBe("HUMAN_CONFIRMS_ORDER");
  });

  it("未声明 risk 时按 read 处理，不会误判成写", () => {
    const guard = createGuardState();
    expect(guardToolCall({ name: "some_tool", args: {}, guard }).allow).toBe(true);
  });

  it("noteToolCall 的 booked 会把后续写类拦下来", () => {
    const guard = createGuardState();
    noteToolCall({ name: "escalate_to_researcher", args: {}, guard, booked: true });
    const v = guardToolCall({ name: "another_write", args: {}, risk: "write", guard });
    if (v.allow) throw new Error("应当被拒绝");
    expect(v.rule).toBe("ALREADY_BOOKED");
  });

  it("availableSlotIds 通过 createGuardState 注入后生效", () => {
    const guard = createGuardState({ availableSlotIds: ["s1"] });
    const v = guardToolCall({
      name: "propose_slots",
      args: { slotIds: ["ghost"] },
      risk: "side-effect",
      guard,
    });
    if (v.allow) throw new Error("应当被拒绝");
    expect(v.rule).toBe("ARG_NOT_FROM_SOURCE");
  });
});

/* SECTION_FLOW_END */

/* SECTION_RESULT */
describe("deniedResult", () => {
  it("形状与 ToolResult 一致（ok:false + error）", () => {
    // 这个形状会被原样序列化成 role:"tool" 消息发给模型 ——
    // 换个形状模型就收到它不认识的返回体
    const r = deniedResult({
      allow: false,
      rule: "HUMAN_CONFIRMS_ORDER",
      denied: true,
      reason: "请改用 propose_slots",
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("请改用 propose_slots");
  });

  it("带 denied 与 rule 供审计区分「业务失败」和「被闸拦下」", () => {
    const r = deniedResult({
      allow: false,
      rule: "TURN_BUDGET",
      denied: true,
      reason: "x",
    });
    expect(r.denied).toBe(true);
    expect(r.rule).toBe("TURN_BUDGET");
  });
});
/* SECTION_RESULT_END */

