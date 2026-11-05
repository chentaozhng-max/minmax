import { describe, expect, it } from "vitest";
import { QuestionType } from "@/domain/questionnaire";
import { summarizeAnswers, type StatQuestion } from "@/domain/question-stats";

function question(over: Partial<StatQuestion> & { id: string }): StatQuestion {
  return {
    title: "题目",
    type: QuestionType.SINGLE,
    options: [],
    scaleMin: null,
    scaleMax: null,
    ...over,
  };
}

const age = question({
  id: "q1",
  title: "你的年龄段是？",
  options: ["18 岁以下", "18–25 岁", "26–35 岁"],
});

const ways = question({
  id: "q2",
  title: "你练习正念的主要方式有哪些？",
  type: QuestionType.MULTI,
  options: ["呼吸觉察", "身体扫描", "引导音频"],
});

const scale = question({
  id: "q3",
  title: "我能觉察到自己的情绪变化。",
  type: QuestionType.SCALE,
  scaleMin: 1,
  scaleMax: 5,
});

const note = question({ id: "q4", title: "想补充点什么？", type: QuestionType.TEXT });

describe("summarizeAnswers", () => {
  it("单选：按原选项顺序铺全，0 票的也在", () => {
    const [stat] = summarizeAnswers([age], [
      { answers: { q1: "18–25 岁" } },
      { answers: { q1: "18–25 岁" } },
      { answers: { q1: "26–35 岁" } },
    ]);

    expect(stat.answered).toBe(3);
    expect(stat.tallies.map((t) => t.label)).toEqual(["18 岁以下", "18–25 岁", "26–35 岁"]);
    expect(stat.tallies.map((t) => t.count)).toEqual([0, 2, 1]);
    expect(stat.tallies[1].ratio).toBeCloseTo(2 / 3);
  });

  it("分母是回答人数，跳过的人不拉低比例", () => {
    const [stat] = summarizeAnswers([age], [
      { answers: { q1: "18–25 岁" } },
      { answers: { q1: "18–25 岁" } },
      { answers: {} },
      { answers: { q1: "" } },
    ]);

    expect(stat.answered).toBe(2);
    expect(stat.tallies[1].ratio).toBe(1);
  });

  it("多选：拆开分别计数，比例加起来可以超过 100%", () => {
    const [stat] = summarizeAnswers([ways], [
      { answers: { q2: ["呼吸觉察", "身体扫描"] } },
      { answers: { q2: ["呼吸觉察"] } },
    ]);

    expect(stat.answered).toBe(2);
    expect(stat.tallies.map((t) => t.count)).toEqual([2, 1, 0]);
    expect(stat.tallies[0].ratio).toBe(1);
    expect(stat.tallies.reduce((sum, t) => sum + t.ratio, 0)).toBeGreaterThan(1);
  });

  it("量表：从 min 铺到 max，按分值升序", () => {
    const [stat] = summarizeAnswers([scale], [
      { answers: { q3: 5 } },
      { answers: { q3: 5 } },
      { answers: { q3: 3 } },
    ]);

    expect(stat.tallies.map((t) => t.label)).toEqual(["1", "2", "3", "4", "5"]);
    expect(stat.tallies[4].count).toBe(2);
    expect(stat.tallies[2].count).toBe(1);
    expect(stat.tallies[0].count).toBe(0);
  });

  it("量表没写 min/max 时按 1–5 兜底", () => {
    const [stat] = summarizeAnswers(
      [question({ id: "q", type: QuestionType.SCALE })],
      [{ answers: { q: 4 } }],
    );
    expect(stat.tallies.map((t) => t.label)).toEqual(["1", "2", "3", "4", "5"]);
    expect(stat.tallies[3].count).toBe(1);
  });

  it("文本题：列出全部非空回答，不做频次", () => {
    const [stat] = summarizeAnswers([note], [
      { answers: { q4: "压力大时会做呼吸练习" } },
      { answers: { q4: "  " } },
      { answers: { q4: "想学身体扫描" } },
    ]);

    expect(stat.answered).toBe(2);
    expect(stat.texts).toEqual(["压力大时会做呼吸练习", "想学身体扫描"]);
    expect(stat.tallies).toEqual([]);
  });

  it("选项被改过之后，老答案仍会被统计并追加在末尾", () => {
    const [stat] = summarizeAnswers([question({ id: "q", options: ["A", "B"] })], [
      { answers: { q: "A" } },
      { answers: { q: "已删除的旧选项" } },
    ]);

    expect(stat.tallies.map((t) => t.label)).toEqual(["A", "B", "已删除的旧选项"]);
    expect(stat.tallies[2].count).toBe(1);
  });

  it("一份答卷都没有时，比例全是 0 且不除零", () => {
    const [stat] = summarizeAnswers([age], []);
    expect(stat.answered).toBe(0);
    expect(stat.tallies.every((t) => t.count === 0 && t.ratio === 0)).toBe(true);
  });

  it("按传入的题目顺序返回，和原问卷一致", () => {
    const stats = summarizeAnswers([age, ways, scale, note], [{ answers: {} }]);
    expect(stats.map((s) => s.questionId)).toEqual(["q1", "q2", "q3", "q4"]);
  });
});
