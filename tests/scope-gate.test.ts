import { describe, expect, it } from "vitest";
import { resetStrikeStore, strikeStoreSize, getStrike, setStrike, clearStrike } from "@/application/scope-strike-store";
import { checkScope } from "@/application/scope-gate";
import type { ScopeClassifier } from "@/domain/ports/scope-classifier";
import type { ScopeVerdict } from "@/domain/scope-guard";

/** 永远返回固定 verdict 的假分类器 */
function fixed(kind: ScopeVerdict["kind"]): ScopeClassifier {
  return {
    configured: () => true,
    classify: async () => ({ kind }),
  };
}

/** 记录调用次数，用来断言「规则能判的就没问模型」 */
function counting(kind: ScopeVerdict["kind"]) {
  let calls = 0;
  const classifier: ScopeClassifier = {
    configured: () => true,
    classify: async () => {
      calls += 1;
      return { kind };
    },
  };
  return { classifier, calls: () => calls };
}

/* SECTION_STORE */
describe("越界计数存储", () => {
  it("没有记录时从 0 开始", () => {
    resetStrikeStore();
    expect(getStrike("s1")).toEqual({ outOfScope: 0 });
  });

  it("写回后能读到", () => {
    resetStrikeStore();
    setStrike("s1", { outOfScope: 2 });
    expect(getStrike("s1").outOfScope).toBe(2);
  });

  it("不同会话互不影响（新开会话从 0 开始）", () => {
    resetStrikeStore();
    setStrike("s1", { outOfScope: 2 });
    expect(getStrike("s2").outOfScope).toBe(0);
  });

  it("clearStrike 清掉单个会话", () => {
    resetStrikeStore();
    setStrike("s1", { outOfScope: 2 });
    clearStrike("s1");
    expect(getStrike("s1").outOfScope).toBe(0);
  });

  it("超过上限时淘汰最旧的，不会无限增长", () => {
    resetStrikeStore();
    // MAX_ENTRIES = 500，写 600 个
    for (let i = 0; i < 600; i += 1) setStrike(`s${i}`, { outOfScope: 1 });
    expect(strikeStoreSize()).toBeLessThanOrEqual(500);
    // 最早的那些被淘汰，最近的还在
    expect(getStrike("s0").outOfScope).toBe(0);
    expect(getStrike("s599").outOfScope).toBe(1);
  });

  it("重写同一个会话会让它变成最新的（不被优先淘汰）", () => {
    resetStrikeStore();
    setStrike("hot", { outOfScope: 1 });
    for (let i = 0; i < 600; i += 1) {
      setStrike("hot", { outOfScope: 1 });
      setStrike(`s${i}`, { outOfScope: 1 });
    }
    expect(getStrike("hot").outOfScope).toBe(1);
  });
});

/* SECTION_STORE_END */

/* SECTION_GATE */
describe("checkScope", () => {
  it("IN_SCOPE → 放行，没有话术没有引导", async () => {
    const d = await checkScope({ text: "我想约个实验", classifier: fixed("IN_SCOPE"), counter: { outOfScope: 0 } });
    expect(d.blocked).toBe(false);
    expect(d.reply).toBeNull();
    expect(d.hint).toBeNull();
  });

  it("ADJACENT → 放行但带引导语（不拦，只把话头引回正事）", async () => {
    const d = await checkScope({ text: "我最近睡不好", classifier: fixed("ADJACENT"), counter: { outOfScope: 0 } });
    expect(d.blocked).toBe(false);
    expect(d.hint).toContain("时间");
  });

  it("ADJACENT 不累计越界计数", async () => {
    const d = await checkScope({ text: "我最近睡不好", classifier: fixed("ADJACENT"), counter: { outOfScope: 1 } });
    expect(d.counter.outOfScope).toBe(1);
  });

  it("第一次 OUT_OF_SCOPE → 拦，软话术", async () => {
    const d = await checkScope({ text: "星穹铁道怎么配队", classifier: fixed("OUT_OF_SCOPE"), counter: { outOfScope: 0 } });
    expect(d.blocked).toBe(true);
    expect(d.counter.outOfScope).toBe(1);
    // 软话术更长（拒 + 给出口）
    expect((d.reply ?? "").length).toBeGreaterThan(20);
  });

  it("连续第二次 OUT_OF_SCOPE → 硬话术（比第一次短）", async () => {
    const first = await checkScope({ text: "a", classifier: fixed("OUT_OF_SCOPE"), counter: { outOfScope: 0 } });
    const second = await checkScope({
      text: "b",
      classifier: fixed("OUT_OF_SCOPE"),
      counter: first.counter,
    });
    expect(second.blocked).toBe(true);
    expect(second.counter.outOfScope).toBe(2);
    expect((second.reply ?? "").length).toBeLessThan((first.reply ?? "").length);
  });

  it("被拦时没有 hint（hint 只给 ADJACENT）", async () => {
    const d = await checkScope({ text: "x", classifier: fixed("OUT_OF_SCOPE"), counter: { outOfScope: 0 } });
    expect(d.hint).toBeNull();
  });

  // 前端靠 strikeLevel 决定要不要给「开个新对话」的出口，所以它必须准确。
  // 只看 blocked 不够：第一次越界和第二次越界都是 blocked=true，
  // 但只有第二次才值得建议用户换窗口。
  it("第一次越界 strikeLevel = first，第二次 = repeat", async () => {
    const first = await checkScope({
      text: "a",
      classifier: fixed("OUT_OF_SCOPE"),
      counter: { outOfScope: 0 },
    });
    expect(first.strikeLevel).toBe("first");

    const second = await checkScope({
      text: "b",
      classifier: fixed("OUT_OF_SCOPE"),
      counter: first.counter,
    });
    expect(second.strikeLevel).toBe("repeat");
  });

  it("正常对话也带 strikeLevel（first），前端不用为它写空值分支", async () => {
    const d = await checkScope({
      text: "我想约个实验",
      classifier: fixed("IN_SCOPE"),
      counter: { outOfScope: 0 },
    });
    expect(d.strikeLevel).toBe("first");
  });

  it("空输入不调分类器（规则层直接放行）", async () => {
    const { classifier, calls } = counting("OUT_OF_SCOPE");
    const d = await checkScope({ text: "   ", classifier, counter: { outOfScope: 0 } });
    expect(calls()).toBe(0);
    expect(d.blocked).toBe(false);
  });

  it("分类器未配置 → 放行，且不调 classify", async () => {
    let calls = 0;
    const classifier: ScopeClassifier = {
      configured: () => false,
      classify: async () => {
        calls += 1;
        return { kind: "OUT_OF_SCOPE" };
      },
    };
    const d = await checkScope({ text: "星穹铁道", classifier, counter: { outOfScope: 0 } });
    expect(calls).toBe(0);
    expect(d.blocked).toBe(false);
  });

  it("分类器抛异常也不炸（端口契约要求它自己吞，但双保险）", async () => {
    const classifier: ScopeClassifier = {
      configured: () => true,
      classify: async () => {
        throw new Error("boom");
      },
    };
    // 端口约定不许抛；这里如果抛了，说明实现违约，我们不做二次兜底 ——
    // 上层 agent.ts 的 try/catch 会接管（降级成表单模式）。
    await expect(checkScope({ text: "x", classifier, counter: { outOfScope: 0 } })).rejects.toThrow();
  });
});

/* SECTION_GATE_END */

/* SECTION_ORDER */
describe("规则优先于分类器（省钱且可复现）", () => {
  it("规则能判的输入不问模型", async () => {
    // 空输入这类明显情况走规则，避免为一个空格花一次模型调用
    const { classifier, calls } = counting("OUT_OF_SCOPE");
    await checkScope({ text: "。。。", classifier, counter: { outOfScope: 0 } });
    expect(calls()).toBe(0);
  });

  it("规则判不了的才问模型", async () => {
    const { classifier, calls } = counting("OUT_OF_SCOPE");
    await checkScope({ text: "星穹铁道怎么配队", classifier, counter: { outOfScope: 0 } });
    expect(calls()).toBe(1);
  });
});
/* SECTION_ORDER_END */

