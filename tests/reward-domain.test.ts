import { describe, expect, it } from "vitest";
import { rewardAmountText, rewardLabel, rewardYuan, toRewardText } from "@/domain/reward";

/**
 * 3.3 搬运时补的测试 —— reward.ts 原来没有专属测试。
 * 金额口径是业务规则（卡片、详情、预约列表都调它），值得锁住。
 * 重点：旧数据里的「1 学分」不能被当成金额。
 */

describe("rewardYuan 从文本取金额", () => {
  it("¥30 → 30", () => {
    expect(rewardYuan("¥30")).toBe(30);
  });

  it("带小数 ¥30.50 → 30.5", () => {
    expect(rewardYuan("¥30.50")).toBe(30.5);
  });

  it("旧数据「1 学分」不算金额 → null", () => {
    expect(rewardYuan("1 学分")).toBeNull();
  });

  it("空串 / 无数字 → null", () => {
    expect(rewardYuan("")).toBeNull();
    expect(rewardYuan("面议")).toBeNull();
  });
});

describe("rewardAmountText 展示口径", () => {
  it("整数不带小数点：¥30", () => {
    expect(rewardAmountText("¥30")).toBe("¥30");
  });

  it("小数保留两位：¥30.50", () => {
    expect(rewardAmountText("¥30.5")).toBe("¥30.50");
  });

  it("没有金额时老老实实说「面议」", () => {
    expect(rewardAmountText("1 学分")).toBe("面议");
  });
});

describe("rewardLabel 整句", () => {
  it("拼成「奖励 ¥30」", () => {
    expect(rewardLabel("¥30")).toBe("奖励 ¥30");
  });

  it("无金额时「奖励 面议」（口径统一，不特殊处理）", () => {
    expect(rewardLabel("x")).toBe("奖励 面议");
  });
});

describe("toRewardText 表单输入 → 存库文本", () => {
  it("纯数字 → ¥前缀", () => {
    expect(toRewardText("30")).toBe("¥30");
  });

  it("带符号/空格也能提取", () => {
    expect(toRewardText("¥ 30")).toBe("¥30");
  });

  it("空输入 → 空串（交给调用方拦）", () => {
    expect(toRewardText("")).toBe("");
  });

  it("0 → 空串（0 元视为没填）", () => {
    expect(toRewardText("0")).toBe("");
  });
});
