import { describe, expect, it } from "vitest";
import {
  ADJACENT_HINT,
  OUT_OF_SCOPE_HARD_REPLY,
  OUT_OF_SCOPE_REPLY,
  CRISIS_KEYWORDS_ENABLED,
  nextStrike,
  normalizeVerdict,
  outOfScopeReply,
  ruleScreen,
  shouldBlock,
  strikeLevel,
  type StrikeCounter,
} from "@/domain/scope-guard";

/* SECTION_RULE_SCREEN */
describe("ruleScreen —— 只判明显的东西", () => {
  it("空串 → 直接 IN_SCOPE，不浪费一次模型调用", () => {
    expect(ruleScreen("")).toEqual({ kind: "IN_SCOPE", reason: "空输入" });
  });

  it("纯空白 / 纯标点 → 同上", () => {
    expect(ruleScreen("   ")?.kind).toBe("IN_SCOPE");
    expect(ruleScreen("。。。！？")?.kind).toBe("IN_SCOPE");
    expect(ruleScreen("\n\t")?.kind).toBe("IN_SCOPE");
  });

  it("有任何文字 → null（交给分类器，规则不猜）", () => {
    // 这是本文件最重要的一条：规则层的价值在于「高置信、可枚举」，
    // 凡是需要语义理解的都不该在这里用关键词硬猜。
    expect(ruleScreen("我想约个实验")).toBeNull();
    expect(ruleScreen("你好")).toBeNull();
    expect(ruleScreen("星穹铁道怎么打")).toBeNull();
  });

  it("只有 emoji / 数字 → null（有内容，可能要看上下文）", () => {
    expect(ruleScreen("123")).toBeNull();
    // emoji 单发也算「有东西」，但我们不会为它花一次模型调用 —— 见下一条
  });

  it("纯 emoji → IN_SCOPE 不调分类器（主模型自己处理得更好）", () => {
    // 取舍：emoji 单发没有语义可分类，交给主模型既省钱又更自然。
    // 注意 IN_SCOPE 的含义是「放行到主模型」，不是「被拒」。
    expect(ruleScreen("🙂")?.kind).toBe("IN_SCOPE");
  });

  it("危机词本期默认不拦（开关关闭）", () => {
    // 二二定的「危机暂时不处理」。这里断言的是「关着」这个事实，
    // 将来打开开关时这条测试会红 —— 那时应该同步更新它，而不是删掉。
    expect(CRISIS_KEYWORDS_ENABLED).toBe(false);
    expect(ruleScreen("我不想活了")?.kind ?? "IN_SCOPE").toBe("IN_SCOPE");
  });
});

/* SECTION_RULE_SCREEN_END */

/* SECTION_NORMALIZE */
describe("normalizeVerdict —— 分类器输出一律不可信", () => {
  it("正常输入原样通过", () => {
    expect(normalizeVerdict({ scope: "OUT_OF_SCOPE", reason: "问游戏攻略" })).toEqual({
      kind: "OUT_OF_SCOPE",
      reason: "问游戏攻略",
    });
  });

  it("四种合法取值都认", () => {
    for (const scope of ["IN_SCOPE", "ADJACENT", "OUT_OF_SCOPE", "CRISIS"] as const) {
      expect(normalizeVerdict({ scope }).kind).toBe(scope);
    }
  });

  it("非对象 → IN_SCOPE 放行", () => {
    expect(normalizeVerdict(null).kind).toBe("IN_SCOPE");
    expect(normalizeVerdict("OUT_OF_SCOPE").kind).toBe("IN_SCOPE");
    expect(normalizeVerdict(42).kind).toBe("IN_SCOPE");
  });

  it("未知枚举值 → IN_SCOPE 放行（不是猜最接近的那个）", () => {
    // 猜「out_of_scope」→ OUT_OF_SCOPE 看起来很聪明，但猜错就是把用户挡在门外。
    // 降级方向必须是放行。
    expect(normalizeVerdict({ scope: "out_of_scope" }).kind).toBe("IN_SCOPE");
    expect(normalizeVerdict({ scope: "MAYBE" }).kind).toBe("IN_SCOPE");
    expect(normalizeVerdict({}).kind).toBe("IN_SCOPE");
  });

  it("reason 不是字符串 → null，不崩", () => {
    expect(normalizeVerdict({ scope: "IN_SCOPE", reason: 123 }).reason).toBeNull();
    expect(normalizeVerdict({ scope: "IN_SCOPE" }).reason).toBeNull();
  });

  it("超长 reason 被截断（防止模型写一段小作文塞进日志）", () => {
    const long = "x".repeat(200);
    expect(normalizeVerdict({ scope: "IN_SCOPE", reason: long }).reason).toHaveLength(40);
  });
});

/* SECTION_NORMALIZE_END */

/* SECTION_STRIKE */
describe("越界计数只在本轮内", () => {
  it("第一次越界 → first", () => {
    const c = nextStrike({ outOfScope: 0 }, "OUT_OF_SCOPE");
    expect(c.outOfScope).toBe(1);
    expect(strikeLevel(c)).toBe("first");
  });

  it("连续第二次 → repeat（升硬话术）", () => {
    let c: StrikeCounter = { outOfScope: 0 };
    c = nextStrike(c, "OUT_OF_SCOPE");
    c = nextStrike(c, "OUT_OF_SCOPE");
    expect(strikeLevel(c)).toBe("repeat");
  });

  it("ADJACENT 不计数 —— 描述自己身体状态的人不该被当试探者", () => {
    const c = nextStrike({ outOfScope: 0 }, "ADJACENT");
    expect(c.outOfScope).toBe(0);
  });

  it("IN_SCOPE 不计数", () => {
    expect(nextStrike({ outOfScope: 1 }, "IN_SCOPE").outOfScope).toBe(1);
  });

  it("interleaved：越界 → 沾边 → 越界 仍升到 repeat", () => {
    let c: StrikeCounter = { outOfScope: 0 };
    c = nextStrike(c, "OUT_OF_SCOPE");
    c = nextStrike(c, "ADJACENT");
    c = nextStrike(c, "OUT_OF_SCOPE");
    expect(strikeLevel(c)).toBe("repeat");
  });
});

describe("shouldBlock", () => {
  it("OUT_OF_SCOPE 拦", () => {
    expect(shouldBlock({ kind: "OUT_OF_SCOPE" })).toBe(true);
  });

  it("CRISIS 拦（将来打开开关时行为明确）", () => {
    expect(shouldBlock({ kind: "CRISIS" })).toBe(true);
  });

  it("IN_SCOPE / ADJACENT 都放行 —— 沾边只是末尾引导一句", () => {
    expect(shouldBlock({ kind: "IN_SCOPE" })).toBe(false);
    expect(shouldBlock({ kind: "ADJACENT" })).toBe(false);
  });
});

/* SECTION_STRIKE_END */

/* SECTION_COPY */
describe("话术", () => {
  it("软硬两档不同文案", () => {
    expect(outOfScopeReply("first")).toBe(OUT_OF_SCOPE_REPLY);
    expect(outOfScopeReply("repeat")).toBe(OUT_OF_SCOPE_HARD_REPLY);
    expect(OUT_OF_SCOPE_REPLY).not.toBe(OUT_OF_SCOPE_HARD_REPLY);
  });

  it("软话术必须给出口（不能只说帮不上忙）", () => {
    // 门厅是拉新入口，第一次就干巴巴拒绝很可能直接流失
    expect(OUT_OF_SCOPE_REPLY).toContain("实验");
    expect(OUT_OF_SCOPE_REPLY.length).toBeGreaterThan(OUT_OF_SCOPE_HARD_REPLY.length);
  });

  it("两档都明确说清自己的范围", () => {
    for (const copy of [OUT_OF_SCOPE_REPLY, OUT_OF_SCOPE_HARD_REPLY]) {
      expect(copy).toContain("心理学实验");
    }
  });

  it("话术里不能有「理解你的感受」这类共情开场", () => {
    // 一旦共情，就变成情感咨询了 —— 正是要防的东西
    for (const copy of [OUT_OF_SCOPE_REPLY, OUT_OF_SCOPE_HARD_REPLY, ADJACENT_HINT]) {
      expect(copy).not.toMatch(/理解|感受|抱抱|心疼/);
    }
  });

  it("ADJACENT_HINT 是引导不是拒绝", () => {
    expect(ADJACENT_HINT).toContain("时间");
  });
});
/* SECTION_COPY_END */

