import { describe, expect, it } from "vitest";
import { MAX_SCORE_ITEMS, normalizeBreakdown, sumBreakdown } from "@/domain/questionnaire";

describe("normalizeBreakdown", () => {
  it("正常的分项原样保留", () => {
    const items = normalizeBreakdown([
      { item: "练习频率", points: 10, max: 40, note: "每天" },
      { item: "情绪觉察", points: 12, max: 30, note: "自评 3" },
    ]);

    expect(items).toEqual([
      { item: "练习频率", points: 10, max: 40, note: "每天" },
      { item: "情绪觉察", points: 12, max: 30, note: "自评 3" },
    ]);
  });

  it("不是数组就给 null —— 宁可没有分项，也不能算出乱数", () => {
    expect(normalizeBreakdown(undefined)).toBeNull();
    expect(normalizeBreakdown("练习频率 10 分")).toBeNull();
    expect(normalizeBreakdown({ item: "练习频率", points: 10 })).toBeNull();
    expect(normalizeBreakdown([])).toBeNull();
  });

  it("缺维度名或分数不是数字的项被跳过，其余保留", () => {
    const items = normalizeBreakdown([
      { points: 10 },
      { item: "练习频率", points: "不是数字" },
      { item: "情绪觉察", points: 8 },
    ]);

    expect(items).toEqual([{ item: "情绪觉察", points: 8, max: null, note: null }]);
  });

  it("points 是数字字符串也能收", () => {
    const items = normalizeBreakdown([{ item: "练习频率", points: "12" }]);
    expect(items?.[0].points).toBe(12);
  });

  it("负数和小数被规整成非负整数", () => {
    const items = normalizeBreakdown([
      { item: "甲", points: -5 },
      { item: "乙", points: 7.6 },
    ]);
    expect(items?.map((i) => i.points)).toEqual([0, 8]);
  });

  it("max 非法时置 null，不编一个默认满分", () => {
    const items = normalizeBreakdown([
      { item: "甲", points: 5, max: 0 },
      { item: "乙", points: 5, max: "十" },
      { item: "丙", points: 5, max: 20 },
    ]);
    expect(items?.map((i) => i.max)).toEqual([null, null, 20]);
  });

  it("超过满分的项按上限截断 —— 模型真会写出「12/10」这种", () => {
    const items = normalizeBreakdown([
      { item: "补充信息", points: 12, max: 10 },
      { item: "练习频率", points: 8, max: 20 },
    ]);
    expect(items?.map((i) => i.points)).toEqual([10, 8]);
  });

  it("超过上限的项被截掉（主试也核不过来）", () => {
    const many = Array.from({ length: MAX_SCORE_ITEMS + 4 }, (_, i) => ({ item: `维度${i}`, points: 1 }));
    expect(normalizeBreakdown(many)).toHaveLength(MAX_SCORE_ITEMS);
  });

  it("维度名和说明都截断，防止把卡片撑爆", () => {
    const items = normalizeBreakdown([
      { item: "这是一个非常非常长的评分维度名称", points: 5, note: "这是一段很长的依据说明，长到会换行好几次" },
    ]);
    expect(items?.[0].item.length).toBeLessThanOrEqual(20);
    expect(items?.[0].note!.length).toBeLessThanOrEqual(40);
  });

  it("空说明变成 null，不是空字符串", () => {
    const items = normalizeBreakdown([{ item: "甲", points: 5, note: "   " }]);
    expect(items?.[0].note).toBeNull();
  });
});

describe("sumBreakdown", () => {
  it("各项相加", () => {
    expect(
      sumBreakdown([
        { item: "甲", points: 10, max: 40, note: null },
        { item: "乙", points: 12, max: 30, note: null },
      ]),
    ).toBe(22);
  });

  it("超过 100 截到 100，低于 0 截到 0", () => {
    expect(sumBreakdown([{ item: "甲", points: 80, max: null, note: null }, { item: "乙", points: 50, max: null, note: null }])).toBe(100);
    expect(sumBreakdown([])).toBe(0);
  });
});
