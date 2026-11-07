import { describe, expect, it } from "vitest";
import { makeSubjectTodoQuery } from "@/adapters/db/prisma/page-query-subject-todo";
import {
  ACTIVE_TAB_KEYS,
  APPOINTMENT_TABS,
  parseAppointmentsTab,
} from "@/app/appointments/tabs";

/**
 * 适配器 + 深链参数解析的形状测试。
 *
 * 适配器侧断言的仍然是「查询形状」（这批查询服务于统计数字，
 * where 一改就是行为变了）；深链侧断言非法值必须归一，
 * 别把用户手打的参数原样塞进 state。
 */

function makeFakeTodoDb(overrides: Record<string, any> = {}) {
  const log: Array<{ op: string; args: any }> = [];
  const db = {
    questionnaire: {
      findMany: async (args: any) => {
        log.push({ op: "questionnaire.findMany", args });
        return overrides.questionnaires ?? [];
      },
    },
    questionnaireResponse: {
      findMany: async (args: any) => {
        log.push({ op: "questionnaireResponse.findMany", args });
        return overrides.responses ?? [];
      },
    },
  };
  return { db, log };
}

describe("listQuestionnaireCandidatesForSubject", () => {
  it("where 只要「问卷已发布 + 实验招募中 + 需要问卷」，判断留给领域层", async () => {
    const { db, log } = makeFakeTodoDb();
    await makeSubjectTodoQuery(db).listQuestionnaireCandidatesForSubject("u_1");

    expect(log[0].args.where).toEqual({
      status: "PUBLISHED",
      experiment: { status: "PUBLISHED", needsQuestionnaire: true },
    });
  });

  it("⚠️ 按截止时间升序（先截止的排前面，域层不重排）", async () => {
    const { db, log } = makeFakeTodoDb();
    await makeSubjectTodoQuery(db).listQuestionnaireCandidatesForSubject("u_1");
    expect(log[0].args.orderBy).toEqual({ experiment: { signupDeadline: "asc" } });
  });

  it("线下实验的 scheduleMode 归一成 SCHEDULED（schema 里只对线上有意义）", async () => {
    const { db } = makeFakeTodoDb({
      questionnaires: [
        {
          id: "q_1",
          title: "参与问卷",
          experiment: {
            id: "exp_1",
            title: "线下实验",
            rewardText: "¥30",
            durationMin: 30,
            mode: "OFFLINE",
            scheduleMode: "ANYTIME",
            windowStart: null,
            repeatCount: 1,
            openAnytime: false,
            signupDeadline: new Date("2026-12-01T00:00:00Z"),
            researcher: { name: "陈砚" },
          },
        },
      ],
    });
    const [c] = await makeSubjectTodoQuery(db).listQuestionnaireCandidatesForSubject("u_1");
    expect(c.scheduleMode).toBe("SCHEDULED");
  });

  it("线上实验原样带出 scheduleMode", async () => {
    const { db } = makeFakeTodoDb({
      questionnaires: [
        {
          id: "q_1",
          title: "参与问卷",
          experiment: {
            id: "exp_1",
            title: "线上实验",
            rewardText: "¥10",
            durationMin: 10,
            mode: "ONLINE",
            scheduleMode: "WINDOW",
            windowStart: new Date("2026-11-08T00:00:00Z"),
            repeatCount: 7,
            openAnytime: false,
            signupDeadline: new Date("2026-12-01T00:00:00Z"),
            researcher: { name: "陈砚" },
          },
        },
      ],
    });
    const [c] = await makeSubjectTodoQuery(db).listQuestionnaireCandidatesForSubject("u_1");
    expect(c.scheduleMode).toBe("WINDOW");
    expect(c.repeatCount).toBe(7);
  });
});

describe("listMyResponseRounds", () => {
  it("只取 questionnaireId + round 两列（不把答案 JSON 拖进来）", async () => {
    const { db, log } = makeFakeTodoDb({ responses: [{ questionnaireId: "q_1", round: 2 }] });
    const rows = await makeSubjectTodoQuery(db).listMyResponseRounds("u_1");

    expect(log[0].args).toEqual({
      where: { subjectId: "u_1" },
      select: { questionnaireId: true, round: true },
    });
    expect(rows).toEqual([{ questionnaireId: "q_1", round: 2 }]);
  });
});

describe("parseAppointmentsTab", () => {
  it("合法值原样返回", () => {
    for (const t of APPOINTMENT_TABS) {
      expect(parseAppointmentsTab(t.key)).toBe(t.key);
    }
  });

  it("⚠️ 非法值归一成 pending，不原样透传", () => {
    expect(parseAppointmentsTab("nonsense")).toBe("pending");
    expect(parseAppointmentsTab("<script>")).toBe("pending");
    expect(parseAppointmentsTab(undefined)).toBe("pending");
  });

  it("数组取第一个（Next searchParams 的重复参数形态）", () => {
    expect(parseAppointmentsTab(["done", "cancelled"])).toBe("done");
  });

  it("active 是聚合视角，不是某一栏", () => {
    expect(parseAppointmentsTab("active")).toBe("active");
    expect(ACTIVE_TAB_KEYS).toEqual(["pending", "confirmed", "checkin"]);
  });
});
