import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/http";
import { checkEligibility } from "@/lib/credit";
import {
  ACTIVE_APPOINTMENT_STATUSES,
  ChatState,
  ExperimentStatus,
  parseMessages,
  stringifyMessages,
  type ChatMessage,
} from "@/lib/domain";
import { formatDayCN, formatForPrompt, formatHM, formatSlotRange, HOUR } from "@/lib/time";
import { parseVaguePreferred, rankSlots, type TimeWindow } from "@/lib/matching";
import { bookSlot } from "@/server/appointments";
import { chatWithTools, llmConfigured, type LlmMessage, type LlmToolSpec } from "@/server/llm";

const MAX_TURNS = 12;
const MAX_SLOTS_IN_PROMPT = 24;

export type SlotView = {
  id: string;
  startAt: string;
  endAt: string;
  capacity: number;
  bookedCount: number;
  remaining: number;
  label: string;
};

export type ChatTurnResult = {
  mode: "llm" | "form";
  state: string;
  messages: ChatMessage[];
  suggestedSlots: SlotView[];
  availableSlots: SlotView[];
  notice: string | null;
  blocked: { reason: string; message: string } | null;
  appointmentId: string | null;
};

function toSlotView(slot: {
  id: string;
  startAt: Date;
  endAt: Date;
  capacity: number;
  bookedCount: number;
}): SlotView {
  return {
    id: slot.id,
    startAt: slot.startAt.toISOString(),
    endAt: slot.endAt.toISOString(),
    capacity: slot.capacity,
    bookedCount: slot.bookedCount,
    remaining: Math.max(0, slot.capacity - slot.bookedCount),
    label: `${formatDayCN(slot.startAt)} ${formatHM(slot.startAt)}-${formatHM(slot.endAt)}`,
  };
}

export async function loadContext(experimentId: string, subjectId: string, now = new Date()) {
  const experiment = await prisma.experiment.findUnique({
    where: { id: experimentId },
    include: { researcher: true },
  });
  if (!experiment) throw new ApiError(404, "实验不存在");
  const subject = await prisma.user.findUnique({ where: { id: subjectId } });
  if (!subject) throw new ApiError(404, "用户不存在");

  const available = await prisma.slot.findMany({
    where: {
      experimentId,
      startAt: { gt: now },
      // SQLite 不支持字段间比较，这里先取全部再用内存过滤
    },
    orderBy: { startAt: "asc" },
    take: 60,
  });

  const availableSlots = available
    .filter((s) => s.bookedCount < s.capacity)
    .slice(0, MAX_SLOTS_IN_PROMPT)
    .map(toSlotView);

  const busy = await prisma.appointment.findMany({
    where: { subjectId, status: { in: ACTIVE_APPOINTMENT_STATUSES } },
    include: { slot: { include: { experiment: true } } },
    orderBy: { createdAt: "desc" },
  });

  return { experiment, subject, availableSlots, busy, now };
}

const TOOLS: LlmToolSpec[] = [
  {
    type: "function",
    function: {
      name: "get_available_slots",
      description: "读取该实验当前还有空位的时段（系统事实，不要自己编时间）",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_my_busy_slots",
      description: "读取当前被试已有的预约，用于避让时间冲突",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_my_credit_status",
      description: "读取当前被试的信誉分与是否被禁报名",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_slots",
      description: "向被试展示 2-3 个候选时段供其选择。展示后等待用户挑选，不要继续调用 book_slot",
      parameters: {
        type: "object",
        properties: {
          slotIds: {
            type: "array",
            items: { type: "string" },
            description: "候选时段的 id，必须来自 get_available_slots 的结果",
          },
          reasonText: { type: "string", description: "一句话说明为什么推荐这几个" },
        },
        required: ["slotIds", "reasonText"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "book_slot",
      description: "锁定时段并创建预约。只有被试明确选定某个时段后才调用",
      parameters: {
        type: "object",
        properties: { slotId: { type: "string", description: "被选中的时段 id" } },
        required: ["slotId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "join_waitlist",
      description: "没有可用时段时，登记候补",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "escalate_to_researcher",
      description: "被试需要人工沟通时，给主试留言",
      parameters: {
        type: "object",
        properties: { message: { type: "string", description: "给主试的留言" } },
        required: ["message"],
      },
    },
  },
];

function buildSystemPrompt(
  ctx: Awaited<ReturnType<typeof loadContext>>,
  preferred: TimeWindow[] = [],
) {
  const { experiment, subject, availableSlots, busy, now } = ctx;
  const credit = checkEligibility(
    {
      bannedUntil: subject.bannedUntil,
      creditScore: subject.creditScore,
      studentVerified: subject.studentVerified,
      minCreditScore: experiment.minCreditScore,
      needsVerification: experiment.needsVerification,
    },
    now,
  );

  // 由确定性规则先排一遍序：命中被试说法 > 剩余容量多 > 更近。
  // 模型只负责把这几个候选讲清楚，不负责决定"哪个更值得推荐"。
  const ranked = rankSlots(
    availableSlots.map((s) => ({
      id: s.id,
      startAt: new Date(s.startAt),
      endAt: new Date(s.endAt),
      remaining: s.remaining,
      capacity: s.capacity,
      label: s.label,
    })),
    {
      now,
      preferred,
      busy: busy.map((a) => ({ start: a.slot.startAt, end: a.slot.endAt })),
    },
  );

  const slotLines = ranked.map(
    (s, index) =>
      `${index + 1}. id=${s.id} | ${s.label} | 剩余 ${s.remaining}/${s.capacity} | 距今 ${Math.round(
        (s.startAt.getTime() - now.getTime()) / HOUR,
      )} 小时${s.tier === 0 ? " | ★命中被试提到的时间" : ""}`,
  );

  const busyLines = busy.map(
    (a) => `- ${formatSlotRange(a.slot.startAt, a.slot.endAt)}（${a.slot.experiment.title}）`,
  );

  return `你是「PsyMatch」的实验排期助手，替主试和被试撮合时间。

## 当前时间
${formatForPrompt(now)}（Asia/Shanghai，UTC+8）

## 实验信息
标题：${experiment.title}
主试：${experiment.researcher.name}
地点：${experiment.location}
时长：${experiment.durationMin} 分钟
报酬：${experiment.rewardText}
类型：${experiment.type === "GROUP" ? `团体（${experiment.groupSize ?? 2} 人一场）` : "一对一"}

## 候选时段（已按系统规则排序，是唯一合法的时间来源）
${ranked.length > 0 ? slotLines.join("\n") : "（暂时没有空位）"}

## 这位被试已有的预约（必须避让）
${busyLines.length > 0 ? busyLines.join("\n") : "（无）"}

## 被试状态
信誉分 ${subject.creditScore}/100，累计未到场 ${subject.noShowCount} 次，学生认证：${
    subject.studentVerified ? "已认证" : "未认证"
  }
报名资格：${credit.ok ? "可报名" : `不可报名（${credit.message}）`}

## 规则
1. 绝对不要编造时段。候选时段只能来自上面的列表或 get_available_slots 的返回，id 必须原样复制。
2. 被试说得模糊（比如"周三下午"）就直接从上面的排序里挑，然后 propose_slots 给 2-3 个候选。
3. 上面已经是排好序的：标 ★ 的优先，其次剩余容量多的，再次更近的。不要自己另排一套。
4. 只有被试明确选定（"就第一个""可以""14:30 那个"）之后才调用 book_slot。
5. 已经用 propose_slots 卡片展示过的时段，文字里不要再罗列一遍时间，只说"上面几个"或一句理由即可。
6. 没有交集时，要么给最接近的可用时段，要么 join_waitlist。
7. 语气简洁、口语化，每条不超过 3 行。不要用列表符号，不要复述工具返回的原始数据，不要报 id。
8. 全程用中文。`;
}

/** 把持久化的消息转成 OpenAI 兼容格式 */
function toLlmMessages(system: string, history: ChatMessage[]): LlmMessage[] {
  const out: LlmMessage[] = [{ role: "system", content: system }];
  for (const m of history) {
    if (m.role === "user") {
      out.push({ role: "user", content: m.content });
    } else if (m.role === "assistant") {
      const calls = m.toolCalls ?? [];
      out.push({
        role: "assistant",
        content: m.content || null,
        ...(calls.length > 0
          ? {
              tool_calls: calls.map((c) => ({
                id: c.id,
                type: "function" as const,
                function: { name: c.name, arguments: JSON.stringify(c.args) },
              })),
            }
          : {}),
      });
      for (const c of calls) {
        out.push({
          role: "tool",
          tool_call_id: c.id,
          content: JSON.stringify(c.result ?? { ok: true }),
        });
      }
    }
  }
  return out;
}

export async function getOrCreateSession(experimentId: string, subjectId: string) {
  const existing = await prisma.chatSession.findUnique({
    where: { experimentId_subjectId: { experimentId, subjectId } },
  });
  if (existing) return existing;
  return prisma.chatSession.create({
    data: { experimentId, subjectId, state: ChatState.COLLECTING_AVAILABILITY, messages: "[]" },
  });
}

export function collectSuggestedSlots(messages: ChatMessage[], available: SlotView[]) {
  const ids = new Set(available.map((s) => s.id));
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m.role !== "assistant" || !m.toolCalls) continue;
    for (let j = m.toolCalls.length - 1; j >= 0; j -= 1) {
      const call = m.toolCalls[j];
      if (call.name !== "propose_slots") continue;
      const result = call.result as { slots?: SlotView[] } | undefined;
      if (result?.slots && result.slots.length > 0) {
        return result.slots.filter((s) => ids.has(s.id));
      }
    }
  }
  return [];
}

export async function getChatView(experimentId: string, subjectId: string): Promise<ChatTurnResult> {
  const now = new Date();
  const ctx = await loadContext(experimentId, subjectId, now);
  const session = await getOrCreateSession(experimentId, subjectId);
  const messages = parseMessages(session.messages);

  const blocked = (() => {
    const e = checkEligibility(
      {
        bannedUntil: ctx.subject.bannedUntil,
        creditScore: ctx.subject.creditScore,
        studentVerified: ctx.subject.studentVerified,
        minCreditScore: ctx.experiment.minCreditScore,
        needsVerification: ctx.experiment.needsVerification,
      },
      now,
    );
    return e.ok ? null : { reason: e.reason, message: e.message };
  })();

  const suggestedSlots = collectSuggestedSlots(messages, ctx.availableSlots);

  return {
    mode: llmConfigured() ? "llm" : "form",
    state: session.state,
    messages,
    suggestedSlots,
    availableSlots: ctx.availableSlots,
    notice: llmConfigured() ? null : "排期助手暂时不可用，直接选择你能来的时段即可。",
    blocked,
    appointmentId: null,
  };
}

/** 工具执行：所有时间事实都从这里来，LLM 只做选择 */
async function execTool(
  name: string,
  args: Record<string, unknown>,
  ctx: Awaited<ReturnType<typeof loadContext>>,
  sink: { state?: string; appointmentId?: string; bookedLabel?: string },
): Promise<unknown> {
  const { experiment, subject, now } = ctx;

  switch (name) {
    case "get_available_slots": {
      const fresh = await loadContext(experiment.id, subject.id, now);
      return { slots: fresh.availableSlots.map((s) => ({ id: s.id, label: s.label, remaining: s.remaining })) };
    }
    case "get_my_busy_slots": {
      const busy = await prisma.appointment.findMany({
        where: { subjectId: subject.id, status: { in: ACTIVE_APPOINTMENT_STATUSES } },
        include: { slot: { include: { experiment: true } } },
      });
      return {
        slots: busy.map((a) => ({
          label: formatSlotRange(a.slot.startAt, a.slot.endAt),
          experiment: a.slot.experiment.title,
          status: a.status,
        })),
      };
    }
    case "get_my_credit_status":
      return {
        creditScore: subject.creditScore,
        noShowCount: subject.noShowCount,
        bannedUntil: subject.bannedUntil?.toISOString() ?? null,
        studentVerified: subject.studentVerified,
        minCreditScore: experiment.minCreditScore,
        needsVerification: experiment.needsVerification,
      };
    case "propose_slots": {
      const ids = Array.isArray(args.slotIds) ? (args.slotIds as string[]) : [];
      const fresh = await loadContext(experiment.id, subject.id, now);
      const picked = fresh.availableSlots.filter((s) => ids.includes(s.id)).slice(0, 3);
      if (picked.length === 0) {
        return { ok: false, error: "这些时段已经不可用，请重新选择" };
      }
      sink.state = ChatState.PROPOSED;
      return { ok: true, reason: String(args.reasonText ?? ""), slots: picked };
    }
    case "book_slot": {
      const slotId = String(args.slotId ?? "");
      const target = ctx.availableSlots.find((s) => s.id === slotId);
      if (!target) return { ok: false, error: "该时段不在候选列表中" };
      try {
        const appointment = await bookSlot({ userId: subject.id, slotId, now, source: "AGENT" });
        sink.state = ChatState.BOOKED;
        sink.appointmentId = appointment.id;
        sink.bookedLabel = target.label;
        return { ok: true, appointmentId: appointment.id, label: target.label, status: appointment.status };
      } catch (error) {
        const message = error instanceof Error ? error.message : "预订失败";
        return { ok: false, error: message };
      }
    }
    case "join_waitlist":
      sink.state = ChatState.WAITLIST;
      return { ok: true };
    case "escalate_to_researcher":
      sink.state = ChatState.ESCALATED;
      return { ok: true, delivered: String(args.message ?? "") };
    default:
      return { ok: false, error: `未知工具 ${name}` };
  }
}

const FALLBACK_OPENING = (durationMin: number, location: string) =>
  `这个实验要 ${durationMin} 分钟，地点在${location}。你未来 7 天哪些时段方便？说得模糊一点也行，比如"周三下午"。`;

export async function sendTurn(params: {
  experimentId: string;
  subjectId: string;
  text: string;
  now?: Date;
}): Promise<ChatTurnResult> {
  const now = params.now ?? new Date();
  const ctx = await loadContext(params.experimentId, params.subjectId, now);
  const session = await getOrCreateSession(params.experimentId, params.subjectId);
  const history = parseMessages(session.messages);

  const blocked = (() => {
    const e = checkEligibility(
      {
        bannedUntil: ctx.subject.bannedUntil,
        creditScore: ctx.subject.creditScore,
        studentVerified: ctx.subject.studentVerified,
        minCreditScore: ctx.experiment.minCreditScore,
        needsVerification: ctx.experiment.needsVerification,
      },
      now,
    );
    return e.ok ? null : { reason: e.reason, message: e.message };
  })();

  const push = (m: ChatMessage) => history.push(m);

  if (blocked) {
    push({
      role: "assistant",
      content:
        blocked.reason === "BANNED"
          ? `你目前处于限制期，${blocked.message}。解禁后随时可以来找我排期。`
          : `这个实验你暂时报不了：${blocked.message}。`,
      createdAt: now.toISOString(),
    });
    await prisma.chatSession.update({
      where: { id: session.id },
      data: { messages: stringifyMessages(history), state: ChatState.CLOSED },
    });
    return {
      mode: "form",
      state: ChatState.CLOSED,
      messages: history,
      suggestedSlots: [],
      availableSlots: ctx.availableSlots,
      notice: null,
      blocked,
      appointmentId: null,
    };
  }

  push({ role: "user", content: params.text, createdAt: now.toISOString() });

  const userTurns = history.filter((m) => m.role === "user").length;
  if (userTurns > MAX_TURNS) {
    push({
      role: "assistant",
      content: "我们聊得有点久了，直接选时段更快——下面这些还有空位。",
      createdAt: now.toISOString(),
    });
    await prisma.chatSession.update({
      where: { id: session.id },
      data: { messages: stringifyMessages(history), state: ChatState.PROPOSED },
    });
    return {
      mode: "form",
      state: ChatState.PROPOSED,
      messages: history,
      suggestedSlots: [],
      availableSlots: ctx.availableSlots,
      notice: `已聊满 ${MAX_TURNS} 轮，切换成时段多选`,
      blocked: null,
      appointmentId: null,
    };
  }

  if (!llmConfigured()) {
    push({
      role: "assistant",
      content: "排期助手暂时不可用，直接选一个你能来的时段吧。",
      createdAt: now.toISOString(),
    });
    await prisma.chatSession.update({
      where: { id: session.id },
      data: { messages: stringifyMessages(history), state: ChatState.PROPOSED },
    });
    return {
      mode: "form",
      state: ChatState.PROPOSED,
      messages: history,
      suggestedSlots: [],
      availableSlots: ctx.availableSlots,
      notice: "LLM 未配置，已切换到时段多选",
      blocked: null,
      appointmentId: null,
    };
  }

  const sink: { state?: string; appointmentId?: string; bookedLabel?: string } = {};
  const system = buildSystemPrompt(ctx, parseVaguePreferred(params.text, now));

  try {
    for (let step = 0; step < 5; step += 1) {
      const llmMessages = toLlmMessages(system, history);
      const reply = await chatWithTools({ messages: llmMessages, tools: TOOLS });

      if (reply.toolCalls.length === 0) {
        push({
          role: "assistant",
          content: reply.content || "我在，说说你什么时候方便？",
          createdAt: new Date().toISOString(),
        });
        break;
      }

      const record: ChatMessage = {
        role: "assistant",
        content: reply.content,
        toolCalls: reply.toolCalls.map((tc) => ({ ...tc, result: undefined })),
        createdAt: new Date().toISOString(),
      };
      push(record);

      for (const tc of reply.toolCalls) {
        const result = await execTool(tc.name, tc.args, ctx, sink);
        const stored = record.toolCalls?.find((x) => x.id === tc.id);
        if (stored) stored.result = result;
      }

      if (sink.appointmentId) {
        push({
          role: "assistant",
          content: `已锁定 ${sink.bookedLabel}，等待主试确认。确认后「我的预约」里会出现签到入口。`,
          createdAt: new Date().toISOString(),
        });
        break;
      }
    }
  } catch (error) {
    console.error("[agent] llm failed, fallback to form", error);
    push({
      role: "assistant",
      content: "网络有点问题，排期助手先歇一下。你直接选时段吧，一样能预约。",
      createdAt: new Date().toISOString(),
    });
    await prisma.chatSession.update({
      where: { id: session.id },
      data: { messages: stringifyMessages(history), state: ChatState.PROPOSED },
    });
    return {
      mode: "form",
      state: ChatState.PROPOSED,
      messages: history,
      suggestedSlots: [],
      availableSlots: ctx.availableSlots,
      notice: "排期助手无响应，已切换到时段多选",
      blocked: null,
      appointmentId: null,
    };
  }

  const nextState = sink.state ?? session.state;
  await prisma.chatSession.update({
    where: { id: session.id },
    data: { messages: stringifyMessages(history), state: nextState },
  });

  const freshAvailable = (await loadContext(params.experimentId, params.subjectId, new Date())).availableSlots;

  return {
    mode: "llm",
    state: nextState,
    messages: history,
    suggestedSlots: sink.appointmentId ? [] : collectSuggestedSlots(history, freshAvailable),
    availableSlots: freshAvailable,
    notice: null,
    blocked: null,
    appointmentId: sink.appointmentId ?? null,
  };
}

export const AGENT_FALLBACK_OPENING = FALLBACK_OPENING;
export const EXPERIMENT_STATUS_PUBLISHED = ExperimentStatus.PUBLISHED;
