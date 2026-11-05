import { describe, expect, it } from "vitest";
import { buildDeclineMessage, notifyDeclined } from "@/application/notify-declined";
import { selectDeclined } from "@/domain/questionnaire";
import type { QuestionnaireRepository, ResponseRecord } from "@/domain/ports/questionnaire";
import type { NoticePort } from "@/domain/ports/notice";

function response(over: Partial<ResponseRecord> & { id: string }): ResponseRecord {
  return {
    questionnaireId: "q1",
    subjectId: "s1",
    subjectName: "被试",
    subjectSchool: null,
    subjectStudentId: null,
    subjectVerified: false,
    subjectCredit: 100,
    answers: {},
    score: 40,
    scoreReason: null,
    scoreBreakdown: null,
    passed: false,
    status: "SCORED",
    submittedAt: new Date("2026-11-05T02:00:00.000Z"),
    invitedAt: null,
    declinedAt: null,
    ...over,
  };
}

function makeDeps(responses: ResponseRecord[], failFor: string[] = []) {
  const sent: { userId: string; kind: string; content: string }[] = [];
  const marked: string[] = [];

  const repo = {
    findByExperiment: async () => ({
      id: "q1",
      experimentId: "e1",
      title: "问卷",
      intro: "",
      status: "PUBLISHED",
      scoringRule: null,
      passScore: 60,
      questions: [],
    }),
    listResponses: async () => responses,
    markDeclined: async (ids: string[]) => {
      marked.push(...ids);
      return ids.length;
    },
  } as unknown as QuestionnaireRepository;

  const notices: NoticePort = {
    send: async (input) => {
      if (failFor.includes(input.userId)) return false;
      sent.push({ userId: input.userId, kind: input.kind, content: input.content });
      return true;
    },
  };

  return { repo, notices, sent, marked };
}

const input = {
  experimentId: "e1",
  researcherId: "r1",
  experimentTitle: "正念练习与情绪调节",
  passScore: 60,
};

describe("selectDeclined", () => {
  it("分数低于线、且没被手动改过 → 算未通过", () => {
    const rows = [response({ id: "a", score: 30, passed: null })];
    expect(selectDeclined(rows, 60)).toHaveLength(1);
  });

  it("手动判 false 优先，分数再高也算未通过", () => {
    const rows = [response({ id: "a", score: 99, passed: false })];
    expect(selectDeclined(rows, 60)).toHaveLength(1);
  });

  it("手动判 true 的不算未通过，哪怕分数低于线", () => {
    const rows = [response({ id: "a", score: 10, passed: true })];
    expect(selectDeclined(rows, 60)).toHaveLength(0);
  });

  it("没设分数线时只认手动判定", () => {
    const rows = [
      response({ id: "a", score: 10, passed: null }),
      response({ id: "b", score: 10, passed: false }),
    ];
    expect(selectDeclined(rows, null).map((r) => r.id)).toEqual(["b"]);
  });

  it("未算分的（score=null 且没手动判定）不算未通过", () => {
    const rows = [response({ id: "a", score: null, passed: null })];
    expect(selectDeclined(rows, 60)).toHaveLength(0);
  });
});

describe("notifyDeclined", () => {
  it("只发给未通过的人，通过的收不到", async () => {
    const deps = makeDeps([
      response({ id: "a", subjectId: "s_pass", score: 90, passed: true }),
      response({ id: "b", subjectId: "s_fail", score: 20, passed: false }),
    ]);

    const result = await notifyDeclined(input, deps);

    expect(result.declined).toBe(1);
    expect(result.sent).toBe(1);
    expect(deps.sent.map((s) => s.userId)).toEqual(["s_fail"]);
    expect(deps.sent[0].kind).toBe("REJECT");
  });

  it("未算分的人不会收到（还没判定，不能先下结论）", async () => {
    const deps = makeDeps([response({ id: "a", subjectId: "s1", score: null, passed: null })]);
    const result = await notifyDeclined(input, deps);

    expect(result.declined).toBe(0);
    expect(deps.sent).toHaveLength(0);
  });

  it("已经告知过的跳过，不重复发", async () => {
    const deps = makeDeps([
      response({ id: "a", subjectId: "s1", declinedAt: new Date("2026-11-01T00:00:00.000Z") }),
      response({ id: "b", subjectId: "s2" }),
    ]);

    const result = await notifyDeclined(input, deps);

    expect(result.declined).toBe(2);
    expect(result.sent).toBe(1);
    expect(result.alreadyNotified).toBe(1);
    expect(deps.marked).toEqual(["b"]);
  });

  it("单条发送失败只计数，不影响其他人", async () => {
    const deps = makeDeps(
      [response({ id: "a", subjectId: "bad" }), response({ id: "b", subjectId: "ok" })],
      ["bad"],
    );

    const result = await notifyDeclined(input, deps);

    expect(result.sent).toBe(1);
    expect(result.failed).toBe(1);
    expect(deps.marked).toEqual(["b"]);
  });

  it("一个都没发出去时不去标记", async () => {
    const deps = makeDeps([response({ id: "a", subjectId: "bad" })], ["bad"]);
    await notifyDeclined(input, deps);
    expect(deps.marked).toEqual([]);
  });

  it("带主试附言时拼在默认文案后面", async () => {
    const deps = makeDeps([response({ id: "a" })]);
    await notifyDeclined({ ...input, message: "欢迎参加下一轮" }, deps);

    expect(deps.sent[0].content).toContain("欢迎参加下一轮");
  });

  it("没有问卷时报 404", async () => {
    const deps = makeDeps([]);
    (deps.repo as unknown as { findByExperiment: () => Promise<null> }).findByExperiment = async () => null;

    await expect(notifyDeclined(input, deps)).rejects.toThrow(/问卷/);
  });
});

describe("buildDeclineMessage", () => {
  const text = buildDeclineMessage({ title: "正念练习与情绪调节" });

  it("带上实验名，说明这轮不匹配", () => {
    expect(text).toContain("正念练习与情绪调节");
    expect(text).toContain("不太匹配");
  });

  it("不出现分数 —— 对没通过的人没有信息量，只会让人去比较", () => {
    expect(text).not.toMatch(/\d+\s*分/);
    expect(text).not.toContain("得分");
  });

  it("不用「未通过 / 不合格 / 淘汰」这类判定词", () => {
    expect(text).not.toContain("未通过");
    expect(text).not.toContain("不合格");
    expect(text).not.toContain("淘汰");
    expect(text).not.toContain("拒绝");
  });

  it("交代数据去向，并留下后续可能", () => {
    expect(text).toContain("匿名");
    expect(text).toContain("之后有合适的实验会再联系你");
  });
});
