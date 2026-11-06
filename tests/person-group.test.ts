import { describe, expect, it } from "vitest";
import { groupResponsesByPerson } from "@/domain/question-stats";

const row = (subjectId: string, round: number, score: number | null, passed: boolean | null = null) => ({
  subjectId,
  round,
  score,
  passed,
});

describe("groupResponsesByPerson", () => {
  it("同一个人三天的答卷合成一组", () => {
    const groups = groupResponsesByPerson([row("a", 1, 80), row("a", 2, 70), row("a", 3, 90)], 60);
    expect(groups).toHaveLength(1);
    expect(groups[0].doneCount).toBe(3);
    expect(groups[0].rounds.map((r) => r.round)).toEqual([1, 2, 3]);
  });

  it("填得多的排前面，一样多按平均分降序", () => {
    const groups = groupResponsesByPerson(
      [
        row("a", 1, 90),
        row("b", 1, 60),
        row("b", 2, 60),
        row("c", 1, 70),
      ],
      60,
    );
    // b 填了 2 天排第一；a(90) 和 c(70) 都是 1 天，按均分排
    expect(groups.map((g) => g.subjectId)).toEqual(["b", "a", "c"]);
  });

  it("判定只看第 1 轮 —— 后面几天答得松不该把人踢出去", () => {
    const groups = groupResponsesByPerson([row("a", 1, 90), row("a", 2, 20), row("a", 3, 10)], 60);
    expect(groups[0].firstPass).toBe("PASS");
  });

  it("第 1 轮没过就是不通过，哪怕后面几天分很高", () => {
    const groups = groupResponsesByPerson([row("a", 1, 30), row("a", 2, 99)], 60);
    expect(groups[0].firstPass).toBe("FAIL");
  });

  it("均分保留一位小数，且只算有分数的份", () => {
    const groups = groupResponsesByPerson([row("a", 1, 80), row("a", 2, 85), row("a", 3, null)], null);
    // (80+85)/2 = 82.5，null 那份不参与
    expect(groups[0].averageScore).toBe(82.5);
  });

  it("同一天有两条记录时 doneCount 只算一天", () => {
    const groups = groupResponsesByPerson([row("a", 1, 80), row("a", 1, 80)], null);
    expect(groups[0].doneCount).toBe(1);
    expect(groups[0].rounds).toHaveLength(2);
  });

  it("库里存的 passed 优先于分数线 —— 不能和上面的「达标 N 份」对不上", () => {
    // 分数低于线，但计分时已经判过 true（主试可能手改过）
    const groups = groupResponsesByPerson([row("a", 1, 30, true)], 60);
    expect(groups[0].firstPass).toBe("PASS");
  });

  it("没有分数线时都是 UNKNOWN", () => {
    const groups = groupResponsesByPerson([row("a", 1, 80)], null);
    expect(groups[0].firstPass).toBe("UNKNOWN");
  });

  it("一条答卷都没有时返回空数组", () => {
    expect(groupResponsesByPerson([], 60)).toEqual([]);
  });
});
