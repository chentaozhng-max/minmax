import { describe, expect, it } from "vitest";
import {
  pickPendingQuestionnaires,
  roundToFill,
  type MyResponseBrief,
  type QuestionnaireTodoCandidate,
} from "@/domain/questionnaire-todo";

/**
 * 「待填问卷」计数的规则测试。
 *
 * 这个数字显示在「我的」页四格统计里，错了没人会当场发现 ——
 * 用户只会觉得「怎么一直有个 1」或者「明明要填却没有」。
 * 所以四条规则各配正反用例。
 */

const day1 = new Date("2026-11-08T00:00:00+08:00");
const future = new Date("2026-12-31T23:59:00+08:00");
const past = new Date("2026-11-01T00:00:00+08:00");

function candidate(overrides: Partial<QuestionnaireTodoCandidate> = {}): QuestionnaireTodoCandidate {
  return {
    experimentId: "exp_1",
    experimentTitle: "面孔吸引力判断",
    questionnaireId: "q_1",
    questionnaireTitle: "参与问卷",
    rewardText: "¥30",
    durationMin: 30,
    researcherName: "陈砚",
    scheduleMode: "ANYTIME",
    windowStart: null,
    repeatCount: 1,
    openAnytime: true,
    signupDeadline: future,
    ...overrides,
  };
}

function responses(...pairs: Array<[string, number]>): MyResponseBrief[] {
  return pairs.map(([questionnaireId, round]) => ({ questionnaireId, round }));
}

describe("pickPendingQuestionnaires", () => {
  it("一次性问卷：没填过 → 待填", () => {
    expect(pickPendingQuestionnaires([candidate()], [], day1)).toHaveLength(1);
  });

  it("⚠️ 一次性问卷：填过一次就永远消失（哪怕没通过筛选）", () => {
    expect(pickPendingQuestionnaires([candidate()], responses(["q_1", 1]), day1)).toEqual([]);
  });

  it("⚠️ 长程重复测量：昨天填了，今天仍要填", () => {
    const c = candidate({
      scheduleMode: "WINDOW",
      windowStart: day1,
      repeatCount: 7,
      openAnytime: false,
    });
    const today = new Date("2026-11-09T10:00:00+08:00");
    // 交过第 1 轮，现在是第 2 轮 → 还在待办里
    expect(pickPendingQuestionnaires([c], responses(["q_1", 1]), today)).toHaveLength(1);
    // 今天这一轮也交了 → 消失
    expect(pickPendingQuestionnaires([c], responses(["q_1", 1], ["q_1", 2]), today)).toEqual([]);
  });

  it("⚠️ 窗口还没开始 → 不算待办（点了也只会看到「还没开始」）", () => {
    const c = candidate({ scheduleMode: "WINDOW", windowStart: day1, repeatCount: 7, openAnytime: false });
    expect(pickPendingQuestionnaires([c], [], new Date("2026-11-07T10:00:00+08:00"))).toEqual([]);
  });

  it("⚠️ 窗口已结束 → 不算待办", () => {
    const c = candidate({ scheduleMode: "WINDOW", windowStart: day1, repeatCount: 3, openAnytime: false });
    expect(pickPendingQuestionnaires([c], [], new Date("2026-11-20T10:00:00+08:00"))).toEqual([]);
  });

  it("报名已截止 → 不算待办（交了主试也不收）", () => {
    expect(
      pickPendingQuestionnaires([candidate({ openAnytime: false, signupDeadline: past })], [], day1),
    ).toEqual([]);
  });

  it("openAnytime 时忽略 signupDeadline 哨兵值", () => {
    const c = candidate({ openAnytime: true, signupDeadline: past });
    expect(pickPendingQuestionnaires([c], [], day1)).toHaveLength(1);
  });

  it("顺序原样保留（不在这里重排）", () => {
    const list = [candidate({ questionnaireId: "b" }), candidate({ questionnaireId: "a" })];
    expect(pickPendingQuestionnaires(list, [], day1).map((c) => c.questionnaireId)).toEqual(["b", "a"]);
  });

  it("多个实验互不干扰：交了 A 不影响 B", () => {
    const list = [candidate({ questionnaireId: "q_a" }), candidate({ questionnaireId: "q_b" })];
    const pending = pickPendingQuestionnaires(list, responses(["q_a", 1]), day1);
    expect(pending.map((c) => c.questionnaireId)).toEqual(["q_b"]);
  });
});

describe("roundToFill", () => {
  it("一次性问卷恒为 1", () => {
    expect(roundToFill(candidate(), day1)).toBe(1);
  });

  it("长程重复测量返回当天轮次", () => {
    const c = candidate({ scheduleMode: "WINDOW", windowStart: day1, repeatCount: 7 });
    expect(roundToFill(c, new Date("2026-11-10T14:00:00+08:00"))).toBe(3);
  });

  it("窗口外回落 1（页面不该显示 NaN）", () => {
    const c = candidate({ scheduleMode: "WINDOW", windowStart: day1, repeatCount: 3 });
    expect(roundToFill(c, new Date("2026-12-01T14:00:00+08:00"))).toBe(1);
  });
});
