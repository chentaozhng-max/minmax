import { describe, expect, it } from "vitest";
import { summarizeRepeats } from "@/domain/question-stats";

const row = (subjectId: string, round: number) => ({ subjectId, round });

describe("summarizeRepeats", () => {
  it("三个人、其中一人填满七天", () => {
    const responses = [
      ...Array.from({ length: 7 }, (_, i) => row("a", i + 1)),
      row("b", 1),
      row("b", 2),
      row("c", 1),
    ];

    const stat = summarizeRepeats(responses, 7);

    expect(stat.participants).toBe(3);
    expect(stat.completed).toBe(1);
    expect(stat.averageRounds).toBe(3.3); // (7+2+1)/3 = 3.33
    expect(stat.perRound.map((p) => p.count)).toEqual([3, 2, 1, 1, 1, 1, 1]);
  });

  it("同一个人同一天的两条记录只算一天（幂等重算不会虚高）", () => {
    const responses = [row("a", 1), row("a", 1), row("a", 2)];
    const stat = summarizeRepeats(responses, 3);
    expect(stat.participants).toBe(1);
    expect(stat.perRound.map((p) => p.count)).toEqual([1, 1, 0]);
  });

  it("跳着填也算天数，但不影响完成判定", () => {
    const responses = [row("a", 1), row("a", 3)];
    const stat = summarizeRepeats(responses, 3);
    expect(stat.participants).toBe(1);
    expect(stat.completed).toBe(0);
    expect(stat.perRound.map((p) => p.count)).toEqual([1, 0, 1]);
  });

  it("一条答卷都没有时不除零", () => {
    const stat = summarizeRepeats([], 7);
    expect(stat.participants).toBe(0);
    expect(stat.completed).toBe(0);
    expect(stat.averageRounds).toBe(0);
    expect(stat.perRound).toHaveLength(7);
    expect(stat.perRound.every((p) => p.count === 0)).toBe(true);
  });

  it("perRound 的长度永远是 repeatCount，哪怕没人填到那么远", () => {
    const stat = summarizeRepeats([row("a", 1)], 7);
    expect(stat.perRound.map((p) => p.round)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("一天的任务（repeatCount = 1）也是填了就算完成", () => {
    const stat = summarizeRepeats([row("a", 1), row("b", 1)], 1);
    expect(stat.completed).toBe(2);
    expect(stat.averageRounds).toBe(1);
  });
});
