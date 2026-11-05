import { describe, expect, it } from "vitest";
import { buildAssistantBrief } from "@/application/assistant-overview";
import type { AssistantAppointment, AssistantQuery } from "@/domain/ports/assistant-query";

const NOW = new Date("2026-11-05T02:00:00.000Z"); // 上海 11-05 10:00
/** 上海 11-05 的 h:m 对应时刻 */
const at = (h: number, m = 0) =>
  new Date(`2026-11-05T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00+08:00`);

function appt(id: string, startH: number, endH: number, title = id): AssistantAppointment {
  return {
    id,
    status: "CONFIRMED",
    experimentId: `e-${id}`,
    experimentTitle: title,
    location: "心理学楼 302",
    researcherName: "张老师",
    startAt: at(startH),
    endAt: at(endH),
  };
}

/** 假端口：记录调用参数，返回预设行 */
function fakeQuery(rows: AssistantAppointment[]) {
  const calls: Array<{ subjectId: string; from: Date; statuses: string[] }> = [];
  const query: AssistantQuery = {
    async listMyUpcomingAppointments(subjectId, from, statuses) {
      calls.push({ subjectId, from, statuses });
      return rows;
    },
    async listMyPastExperiments() {
      return [];
    },
  };
  return { query, calls };
}

const STATUSES = ["CONFIRMED", "CHECKED_IN"];

describe("buildAssistantBrief", () => {
  it("把 now 和状态列表原样传给端口", async () => {
    const { query, calls } = fakeQuery([]);
    await buildAssistantBrief({ query, now: NOW }, "u1", STATUSES);
    expect(calls[0]).toEqual({ subjectId: "u1", from: NOW, statuses: STATUSES });
  });

  it("★ 没有安排 → 引导去找实验（不寒暄）", async () => {
    const { query } = fakeQuery([]);
    const brief = await buildAssistantBrief({ query, now: NOW }, "u1", STATUSES);
    expect(brief.upcoming).toEqual([]);
    expect(brief.headline).toContain("没有安排");
    expect(brief.headline).not.toContain("你好");
  });

  it("一场安排 → 说清时间与实验名", async () => {
    const { query } = fakeQuery([appt("a", 14, 15, "面孔识别实验")]);
    const brief = await buildAssistantBrief({ query, now: NOW }, "u1", STATUSES);
    expect(brief.headline).toContain("1 场");
    expect(brief.headline).toContain("面孔识别实验");
  });

  it("★ 有撞车 → 撞车优先于「下一场是什么」", async () => {
    const { query } = fakeQuery([appt("a", 14, 16, "实验甲"), appt("b", 15, 17, "实验乙")]);
    const brief = await buildAssistantBrief({ query, now: NOW }, "u1", STATUSES);
    expect(brief.overlaps).toHaveLength(1);
    expect(brief.headline).toContain("撞车");
    expect(brief.headline).toContain("实验甲");
    expect(brief.headline).toContain("实验乙");
  });

  it("已结束的预约被剔除（端口若没过滤，用例层仍兜住）", async () => {
    // 不信任上游：换成一个不过滤的实现时，这一层的行为不能变
    const { query } = fakeQuery([appt("old", 8, 9), appt("next", 14, 15)]);
    const brief = await buildAssistantBrief({ query, now: NOW }, "u1", STATUSES);
    expect(brief.upcoming.map((a) => a.id)).toEqual(["next"]);
  });

  it("★ 乱序输入 → 输出按开始时间升序（「最近一场」靠这个）", async () => {
    const { query } = fakeQuery([appt("late", 16, 17), appt("early", 14, 15)]);
    const brief = await buildAssistantBrief({ query, now: NOW }, "u1", STATUSES);
    expect(brief.upcoming.map((a) => a.id)).toEqual(["early", "late"]);
    expect(brief.headline).toContain("early");
  });

  it("撞车文案里带重叠区间", async () => {
    const { query } = fakeQuery([appt("a", 14, 16), appt("b", 15, 17)]);
    const brief = await buildAssistantBrief({ query, now: NOW }, "u1", STATUSES);
    expect(brief.overlaps[0].overlapLabel).toContain("15:00");
    expect(brief.overlaps[0].overlapLabel).toContain("16:00");
  });

  it("两场首尾相接（14-15、15-16）→ 不算撞车，只说下一场", async () => {
    const { query } = fakeQuery([appt("a", 14, 15, "实验甲"), appt("b", 15, 16, "实验乙")]);
    const brief = await buildAssistantBrief({ query, now: NOW }, "u1", STATUSES);
    expect(brief.overlaps).toEqual([]);
    expect(brief.headline).toContain("2 场");
  });
});
