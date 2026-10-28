import { describe, expect, it } from "vitest";
import { rewardAmountText, rewardLabel, rewardYuan, toRewardText } from "../src/lib/reward";

describe("奖励金额", () => {
  it("从库里的文本读出金额", () => {
    expect(rewardYuan("¥30")).toBe(30);
    expect(rewardYuan("¥50")).toBe(50);
    // 老数据里被试端看到的「50元」这种自由文本也要能认
    expect(rewardYuan("50元")).toBe(50);
  });

  it("没有金额的老数据老实说面议，不能把「1 学分」读成 1 块钱", () => {
    expect(rewardYuan("1 学分")).toBeNull();
    expect(rewardYuan("面议")).toBeNull();
    expect(rewardAmountText("1 学分")).toBe("面议");
  });

  it("展示时带上「奖励」两个字，而不是光秃秃一个数字", () => {
    expect(rewardLabel("¥30")).toBe("奖励 ¥30");
    expect(rewardAmountText("¥30")).toBe("¥30");
  });

  it("表单输入按元存成 ¥N，0 和空值返回空串交给调用方拦", () => {
    expect(toRewardText("30")).toBe("¥30");
    expect(toRewardText(" 50 ")).toBe("¥50");
    expect(toRewardText("0")).toBe("");
    expect(toRewardText("")).toBe("");
  });
});
