import { describe, expect, it } from "vitest";
import type { LlmMessage, LlmPort, LlmReply, LlmToolSpec } from "@/domain/ports/llm";
import type {
  CreateReminderInput,
  NotificationRecord,
  NotificationRepository,
  ReminderCandidate,
} from "@/domain/ports/notification-repo";
import { ReminderLevel } from "@/domain/reminder-levels";
import { composeReminder, sendDueReminders } from "@/application/send-reminders";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const NOW = new Date("2026-11-10T09:00:00+08:00");

const at = (ms: number) => new Date(NOW.getTime() + ms);

function candidate(startAt: Date, id = "a1"): ReminderCandidate {
  return {
    appointmentId: id,
    experimentId: "e1",
    subjectId: "s1",
    startAt,
    endAt: new Date(startAt.getTime() + 60 * MINUTE),
    experimentTitle: "面孔识别实验",
    location: "心理学楼 302",
    researcherName: "王老师",
  };
}

/** 记录调用的假仓储；靠内存 Set 模拟唯一键 */
function makeRepo(candidates: ReminderCandidate[]) {
  const created: CreateReminderInput[] = [];
  const seen = new Set<string>();
  const repo: NotificationRepository = {
    async findReminderCandidates() {
      return candidates;
    },
    async hasReminder(appointmentId, level) {
      return seen.has(`${appointmentId}|${level}`);
    },
    async createReminder(input) {
      const key = `${input.appointmentId}|${input.level}`;
      if (seen.has(key)) return { id: "", created: false };
      seen.add(key);
      created.push(input);
      return { id: `n${created.length}`, created: true };
    },
    async listForUser() {
      return [] as NotificationRecord[];
    },
    async countUnread() {
      return 0;
    },
    async markAllRead() {
      return 0;
    },
  };
  return { repo, created };
}

function makeLlm(behavior: { configured?: boolean; reply?: string; throws?: boolean }) {
  const calls: LlmMessage[][] = [];
  const llm: LlmPort = {
    configured: () => behavior.configured ?? true,
    async chat(params: { messages: LlmMessage[]; tools: LlmToolSpec[] }): Promise<LlmReply> {
      calls.push(params.messages);
      if (behavior.throws) throw new Error("模型超时");
      return { content: behavior.reply ?? "提醒你一下，别忘了周三的实验。", toolCalls: [] };
    },
  };
  return { llm, calls };
}

describe("sendDueReminders", () => {
  it("3 小时后的预约 → 生成一条 H3 提醒", async () => {
    const { repo, created } = makeRepo([candidate(at(3 * HOUR))]);
    const { llm } = makeLlm({ reply: "还有 3 小时，别迟到。" });

    const result = await sendDueReminders({ notifications: repo, llm }, NOW);

    expect(result.affected).toBe(1);
    expect(created).toHaveLength(1);
    expect(created[0].level).toBe(ReminderLevel.H3);
    expect(created[0].content).toBe("还有 3 小时，别迟到。");
    expect(created[0].userId).toBe("s1");
  });

  it("再跑一次不重发（幂等靠唯一键，不靠任何状态字段）", async () => {
    const { repo, created } = makeRepo([candidate(at(3 * HOUR))]);
    const { llm, calls } = makeLlm({});

    const deps = { notifications: repo, llm };
    const first = await sendDueReminders(deps, NOW);
    const second = await sendDueReminders(deps, NOW);

    expect(first.affected).toBe(1);
    expect(second.affected).toBe(0);
    expect(second.skipped).toBe(1);
    expect(created).toHaveLength(1);
    // 第二次连模型都不该调 —— 已经发过的档位不该再花一次调用
    expect(calls).toHaveLength(1);
  });

  it("距开场 4 小时 → 一条都不发", async () => {
    const { repo, created } = makeRepo([candidate(at(4 * HOUR))]);
    const { llm } = makeLlm({});

    const result = await sendDueReminders({ notifications: repo, llm }, NOW);

    expect(result.affected).toBe(0);
    expect(created).toHaveLength(0);
  });

  it("服务停摆后恢复（距开场仅剩 5 分钟）→ 只补一条最紧急的，不补三条", async () => {
    const { repo, created } = makeRepo([candidate(at(5 * MINUTE))]);
    const { llm } = makeLlm({});

    const result = await sendDueReminders({ notifications: repo, llm }, NOW);

    expect(result.affected).toBe(1);
    expect(created).toHaveLength(1);
    expect(created[0].level).toBe(ReminderLevel.M10);
  });

  it("多条预约各发各的，互不影响", async () => {
    const { repo, created } = makeRepo([candidate(at(3 * HOUR), "a1"), candidate(at(10 * MINUTE), "a2")]);
    const { llm } = makeLlm({});

    const result = await sendDueReminders({ notifications: repo, llm }, NOW);

    expect(result.affected).toBe(2);
    expect(created.map((c) => c.level).sort()).toEqual(
      [ReminderLevel.H3, ReminderLevel.M10].sort(),
    );
  });

  it("已经开场的预约不发提醒", async () => {
    const { repo, created } = makeRepo([candidate(at(-MINUTE))]);
    const { llm } = makeLlm({});

    const result = await sendDueReminders({ notifications: repo, llm }, NOW);

    expect(result.affected).toBe(0);
    expect(created).toHaveLength(0);
  });
});
