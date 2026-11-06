import { describe, expect, it } from "vitest";
import { summarizeScores } from "@/domain/questionnaire";

const row = (score: number | null, passed: boolean | null = null) => ({ score, passed });

describe("summarizeScores 的描述统计", () => {
  it("均值保留一位小数，标准差用样本口径（n−1）", () => {
    // 均值 20；样本方差 = (100+0+100)/2 = 100，SD = 10
    const s = summarizeScores([row(10), row(20), row(30)], 20);
    expect(s.mean).toBe(20);
    expect(s.sd).toBe(10);
    expect(s.median).toBe(20);
  });

  it("均值末位真的保留，不是整数四舍五入", () => {
    const s = summarizeScores([row(61), row(62), row(64)], null);
    expect(s.mean).toBe(62.3);
    expect(s.average).toBe(62); // 四宫格那个是整数口径
  });

  it("只有一份答卷时不报标准差 —— 一个人没有「离散程度」可言", () => {
    const s = summarizeScores([row(88)], null);
    expect(s.mean).toBe(88);
    expect(s.sd).toBeNull();
  });

  it("偶数份的中位数取中间两个的平均", () => {
    const s = summarizeScores([row(10), row(20), row(40), row(50)], null);
    expect(s.median).toBe(30);
  });

  it("没打分的答卷不进均值，也不进分布", () => {
    const s = summarizeScores([row(80), row(null), row(null)], null);
    expect(s.total).toBe(3);
    expect(s.scored).toBe(1);
    expect(s.mean).toBe(80);
    expect(s.distribution.reduce((a, b) => a + b.count, 0)).toBe(1);
  });
});

describe("summarizeScores 的分数分布", () => {
  it("永远十个档，空档也留着 —— 否则看不出分布形状", () => {
    const s = summarizeScores([row(75)], null);
    expect(s.distribution).toHaveLength(10);
    expect(s.distribution[7].count).toBe(1);
    expect(s.distribution.filter((d) => d.count === 0)).toHaveLength(9);
  });

  it("档位边界：70 落在 70–79，不是 60–69", () => {
    const s = summarizeScores([row(70)], null);
    expect(s.distribution[6].count).toBe(0);
    expect(s.distribution[7].count).toBe(1);
    expect(s.distribution[7].label).toBe("70–79");
  });

  it("100 分落在最后一档，不溢出", () => {
    const s = summarizeScores([row(100)], null);
    expect(s.distribution).toHaveLength(10);
    expect(s.distribution[9].count).toBe(1);
    expect(s.distribution[9].label).toBe("90–100");
  });

  it("0 分落在第一档", () => {
    const s = summarizeScores([row(0)], null);
    expect(s.distribution[0].count).toBe(1);
  });

  it("一条答卷都没有时也不崩", () => {
    const s = summarizeScores([], null);
    expect(s.mean).toBeNull();
    expect(s.sd).toBeNull();
    expect(s.median).toBeNull();
    expect(s.distribution).toHaveLength(10);
  });
});
