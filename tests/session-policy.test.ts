import { describe, expect, it } from "vitest";
import {
  COMPACT_THRESHOLD,
  HANDOFF_TURNS,
  KEEP_RECENT,
  MAX_STORED,
  SEAL_REVIVE_MS,
  canRevive,
  detectIntent,
  idleCutoff,
  planCompaction,
  shouldHandoff,
} from "@/domain/session-policy";

/**
 * 门厅会话策略（纯判断）。
 *
 * 每条测试都在守一个「看起来无害、改了就会出事」的默认值或边界。
 * 尤其 detectIntent：它是唯一会**替用户结束对话**的代码，误判的代价很高。
 */

describe("planCompaction", () => {
  it("阈值内不压（<=20）", () => {
    expect(planCompaction(20).compact).toBe(false);
    expect(planCompaction(1).compact).toBe(false);
    expect(planCompaction(0).compact).toBe(false);
  });

  it("超过阈值才压（21）", () => {
    expect(planCompaction(COMPACT_THRESHOLD + 1).compact).toBe(true);
  });

  it("压缩时保留 12 条原文", () => {
    expect(planCompaction(50).keepRecent).toBe(KEEP_RECENT);
  });

  it("★ 两层门槛不同：21 条就要降级，但要到 81 条才摘要", () => {
    // 第 1 层免费，门槛低；第 2 层要调模型，只在超存储上限时才做
    expect(planCompaction(21).compact).toBe(true);
    expect(planCompaction(21).summarizeCount).toBe(0);

    expect(planCompaction(MAX_STORED).summarizeCount).toBe(0);
    expect(planCompaction(MAX_STORED + 1).summarizeCount).toBe(1);
    expect(planCompaction(120).summarizeCount).toBe(120 - MAX_STORED);
  });

  it("★ summarizeCount 是「超出的条数」，保证摘要后回到上限内", () => {
    const count = 100;
    const plan = planCompaction(count);
    // 丢掉 summarizeCount 条之后必须 <= MAX_STORED
    expect(count - plan.summarizeCount).toBeLessThanOrEqual(MAX_STORED);
  });

  it("配置自洽：keepRecent < 阈值 < 硬上限", () => {
    expect(KEEP_RECENT).toBeLessThan(COMPACT_THRESHOLD);
    expect(COMPACT_THRESHOLD).toBeLessThan(MAX_STORED);
  });
});

describe("shouldHandoff", () => {
  it("★ 按 user 轮数算，40 轮才结转", () => {
    expect(shouldHandoff(39)).toBe(false);
    expect(shouldHandoff(HANDOFF_TURNS)).toBe(true);
    expect(shouldHandoff(41)).toBe(true);
  });
});

describe("detectIntent", () => {
  it("明确说够了 → USER_DONE", () => {
    for (const t of ["够了", "就这些吧", "不用了谢谢", "先这样", "我不找了"]) {
      expect(detectIntent(t)).toBe("USER_DONE");
    }
  });

  it("★ 说「再看看」→ SEALED（软结束，不是结束）", () => {
    for (const t of ["我再看看", "再想想", "先看看别的", "晚点再说"]) {
      expect(detectIntent(t)).toBe("SEALED");
    }
  });

  it("★ 闲聊不误判 —— 宁可不识别，也不要替用户结束对话", () => {
    for (const t of ["有没有周三的", "随便看看", "这个实验多久", "你好", "3 个人一起的"]) {
      expect(detectIntent(t)).toBeNull();
    }
  });

  it("★ 否定式不误判 —— 「时间不够了」不是「聊完了」", () => {
    // 「够了」和「不够了」只差一个字、意思相反。不管这个的话，用户抱怨一句
    // 条件太苛就被结束对话 —— 这是这条链路上代价最高的误判。
    for (const t of ["时间不够了", "时间不够", "还差一点", "抽不出时间", "没有空"]) {
      expect(detectIntent(t)).toBeNull();
    }
  });

  it("空串 / 空白 → null", () => {
    expect(detectIntent("")).toBeNull();
    expect(detectIntent("   ")).toBeNull();
  });
});

describe("canRevive", () => {
  const now = new Date("2026-11-05T12:00:00.000Z");

  it("★ 没软结束过 → false（不需要复活）", () => {
    expect(canRevive(null, now)).toBe(false);
  });

  it("1 小时内可复活", () => {
    expect(canRevive(new Date("2026-11-05T11:30:00.000Z"), now)).toBe(true);
    expect(canRevive(new Date("2026-11-05T11:00:00.000Z"), now)).toBe(true); // 正好 1h
  });

  it("超过 1 小时不可复活（该开新的了）", () => {
    expect(canRevive(new Date("2026-11-05T10:59:00.000Z"), now)).toBe(false);
  });

  it("SEAL_REVIVE_MS 是 1 小时（二二把 30min 改成的值）", () => {
    expect(SEAL_REVIVE_MS).toBe(60 * 60 * 1000);
  });
});

describe("idleCutoff", () => {
  it("★ 空闲阈值 30 分钟，且返回的是「往前推」的时间点", () => {
    const now = new Date("2026-11-05T12:00:00.000Z");
    expect(idleCutoff(now)).toEqual(new Date("2026-11-05T11:30:00.000Z"));
  });
});
