import { describe, expect, it } from "vitest";
import { buildInviteMessage, inviteQualified } from "@/application/invite-qualified";
import type { QuestionnaireRepository, ResponseRecord } from "@/domain/ports/questionnaire";
import type { NoticePort } from "@/domain/ports/notice";

function response(over: Partial<ResponseRecord> & { id: string }): ResponseRecord {
  return {
    questionnaireId: "q1",
    subjectId: "s1",
    subjectName: "被试",
    subjectSchool: null,
    subjectStudentId: null,
    subjectVerified: true,
    subjectCredit: 100,
    answers: {},
    score: 80,
    scoreReason: null,
    scoreBreakdown: null,
    passed: true,
    status: "SCORED",
    submittedAt: new Date("2026-11-05T02:00:00.000Z"),
    invitedAt: null,
    declinedAt: null,
    ...over,
  };
}

function makeDeps(responses: ResponseRecord[]) {
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
    markInvited: async (ids: string[]) => {
      marked.push(...ids);
      return ids.length;
    },
  } as unknown as QuestionnaireRepository;
  const notices: NoticePort = {
    send: async (input) => {
      sent.push({ userId: input.userId, kind: input.kind, content: input.content });
      return true;
    },
  };
  return { repo, notices, sent, marked };
}

const base = {
  experimentId: "e1",
  researcherId: "r1",
  experimentTitle: "正念练习与情绪调节",
  passScore: 60,
};

describe("buildInviteMessage", () => {
  it("线上实验不能让人「去选一个时段」—— 线上根本没有时段", () => {
    const text = buildInviteMessage({ title: "线上问卷", mode: "ONLINE", score: 88, threshold: 60 });
    expect(text).not.toContain("时段");
    expect(text).not.toContain("预约");
    expect(text).toContain("安排后续");
  });

  it("线下实验保留「去选一个时段」", () => {
    const text = buildInviteMessage({ title: "实验室实验", mode: "OFFLINE", score: 88, threshold: 60 });
    expect(text).toContain("选一个时段");
    expect(text).toContain("得分 ≥ 60 分");
  });

  it("带上分数、实验名与附言", () => {
    const text = buildInviteMessage({
      title: "正念练习",
      mode: "ONLINE",
      score: 88,
      threshold: 60,
      message: "请回复方便的时间",
    });
    expect(text).toContain("正念练习");
    expect(text).toContain("88 分");
    expect(text).toContain("请回复方便的时间");
  });

  it("没有分数时不写「你的问卷得分 ？ 分」", () => {
    const text = buildInviteMessage({ title: "x", mode: "ONLINE", score: null, threshold: 60 });
    expect(text).not.toContain("得分");
  });
});

describe("inviteQualified", () => {
  it("只发给达标且没邀请过的人", async () => {
    const deps = makeDeps([
      response({ id: "a", subjectId: "pass", score: 90 }),
      response({ id: "b", subjectId: "low", score: 20, passed: false }),
      response({ id: "c", subjectId: "done", invitedAt: new Date("2026-11-01T00:00:00.000Z") }),
    ]);

    const result = await inviteQualified({ ...base, mode: "ONLINE" }, deps);

    expect(result.qualified).toBe(2);
    expect(result.sent).toBe(1);
    expect(result.alreadyInvited).toBe(1);
    expect(deps.sent.map((s) => s.userId)).toEqual(["pass"]);
    expect(deps.sent[0].kind).toBe("INVITE");
  });

  it("线上实验的邀请消息里不出现「时段」", async () => {
    const deps = makeDeps([response({ id: "a", score: 90 })]);
    await inviteQualified({ ...base, mode: "ONLINE" }, deps);
    expect(deps.sent[0].content).not.toContain("时段");
  });

  it("没设分数线直接拒绝 —— 没标准就谈不上达标", async () => {
    const deps = makeDeps([response({ id: "a" })]);
    await expect(inviteQualified({ ...base, passScore: null, mode: "ONLINE" }, deps)).rejects.toThrow(/分数线/);
  });

  it("一个都没发时不标记", async () => {
    const deps = makeDeps([response({ id: "a", invitedAt: new Date("2026-11-01T00:00:00.000Z") })]);
    await inviteQualified({ ...base, mode: "ONLINE" }, deps);
    expect(deps.marked).toEqual([]);
  });
});
