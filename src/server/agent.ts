import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/http";
import { makeChatSessionRepository } from "@/adapters/db/prisma/chat-session-repo";
import { makeSchedulingQuery } from "@/adapters/db/prisma/scheduling-query";

/**
 * 会话读写的唯一入口。
 *
 * 重构前 agent.ts 有 7 处 `prisma.chatSession.update` 重复同一件事，
 * 现在全部走这个仓储。装配点在模块顶部，测试可换成手写假实现。
 */
const chatSessions = makeChatSessionRepository(prisma);
const schedulingQuery = makeSchedulingQuery(prisma);
import { checkEligibility } from "@/lib/credit";
import {
  ACTIVE_APPOINTMENT_STATUSES,
  ChatState,
  ExperimentStatus,
  parseMessages,
  stringifyMessages,
  type ChatMessage,
  type ExperimentType,
} from "@/lib/domain";
import { formatDayCN, formatForPrompt, formatHM, formatSlotRange, HOUR } from "@/lib/time";
import { parseVaguePreferred, rankSlots, type TimeWindow } from "@/lib/matching";
import { bookSlot } from "@/server/appointments";
import { getLlm, type LlmMessage } from "@/adapters/llm";
import { createToolRegistry } from "@/tools";
import type { AgentContext, ToolContext, ToolSink } from "@/tools";
import { checkScope } from "@/application/scope-gate";
import { createScopeClassifier } from "@/adapters/llm/scope-classifier";
import { getStrike, setStrike } from "@/application/scope-strike-store";
import { createGuardState, deniedResult, guardToolCall, noteToolCall } from "@/tools/guard";

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
  experimentType: ExperimentType;
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

/**
 * 载入一次对话所需的全部上下文。
 *
 * 这里只做三件事：拿数据 → 缺了就报 404 → 按展示需要排序截断。
 * 真实 SQL 全部在 adapters/db/prisma/scheduling-query.ts，本文件不再出现 prisma。
 *
 * 注意 experiment / subject 的形状不再是 Prisma 的完整模型，而是端口定义的
 * 最小记录 —— 所以下面每个字段访问都必须是显式的（这正是我们要的：用什么取什么）。
 */
export async function loadContext(experimentId: string, subjectId: string, now = new Date()) {
  const experiment = await schedulingQuery.findExperimentDetail(experimentId);
  if (!experiment) throw new ApiError(404, "实验不存在");
  const subject = await schedulingQuery.findSubjectProfile(subjectId);
  if (!subject) throw new ApiError(404, "用户不存在");

  const upcoming = await schedulingQuery.findUpcomingSlots(experimentId, now, 60);

  // SQLite 不支持字段间比较，所以「已满」在这里用内存过滤（重构前就是这个行为）
  const availableSlots = upcoming
    .filter((s) => s.bookedCount < s.capacity)
    .slice(0, MAX_SLOTS_IN_PROMPT)
    .map(toSlotView);

  const busy = await schedulingQuery.findActiveAppointments(subjectId, ACTIVE_APPOINTMENT_STATUSES);

  return { experiment, subject, availableSlots, busy, now };
}

/**
 * 把 loadContext 的返回值适配成工具层认识的形状。
 *
 * 为什么要转换而不是直接用：
 *   tools/ 不能 import server/agent.ts（会循环依赖），所以两边靠结构化的最小形状对接。
 * 副作用注入：
 *   reloadSlots / book 由 agent 层注入，工具层因此不需要知道 prisma 和 bookSlot 的存在。
 */
function toToolContext(
  ctx: Awaited<ReturnType<typeof loadContext>>,
  sink: ToolSink,
): ToolContext<AgentContext> {
  const { experiment, subject, availableSlots, busy, now } = ctx;

  return {
    ctx: {
      experiment: {
        id: experiment.id,
        title: experiment.title,
        durationMin: experiment.durationMin,
        location: experiment.location,
        minCreditScore: experiment.minCreditScore,
        needsVerification: experiment.needsVerification,
      },
      subject: {
        id: subject.id,
        creditScore: subject.creditScore,
        noShowCount: subject.noShowCount,
        bannedUntil: subject.bannedUntil,
        studentVerified: subject.studentVerified,
      },
      availableSlots,
      busy: busy.map((a) => ({
        status: a.status,
        slot: {
          startAt: a.slot.startAt,
          endAt: a.slot.endAt,
          experiment: { title: a.slot.experiment.title },
        },
      })),
      now,
      // 工具要「最新余位」时调这个，而不是自己去查库
      reloadSlots: async () => {
        const fresh = await loadContext(experiment.id, subject.id, now);
        return fresh.availableSlots;
      },
      // 锁位 + 建预约也由这里注入
      book: async (slotId: string) => {
        const appointment = await bookSlot({
          userId: subject.id,
          slotId,
          now,
          source: "AGENT",
        });
        return { id: appointment.id, status: appointment.status };
      },
    },
    sink,
    now,
  };
}

/** 工具注册表：加能力只需改 tools/index.ts，本文件不动 */
const toolRegistry = createToolRegistry();

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
主试：${experiment.researcherName}
地点：${experiment.location}
时长：${experiment.durationMin} 分钟
奖励金额：${experiment.rewardText}
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
  const existing = await chatSessions.findByExperimentAndSubject(experimentId, subjectId);
  if (existing) return existing;
  return chatSessions.create({
    experimentId,
    subjectId,
    state: ChatState.COLLECTING_AVAILABILITY,
    messages: "[]",
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
    mode: getLlm().configured() ? "llm" : "form",
    state: session.state,
    experimentType: ctx.experiment.type,
    messages,
    suggestedSlots,
    availableSlots: ctx.availableSlots,
    notice: getLlm().configured() ? null : "排期助手暂时不可用，直接选择你能来的时段即可。",
    blocked,
    appointmentId: null,
  };
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
    await chatSessions.save(session.id, ChatState.CLOSED, stringifyMessages(history));
    return {
      mode: "form",
      state: ChatState.CLOSED,
      experimentType: ctx.experiment.type,
      messages: history,
      suggestedSlots: [],
      availableSlots: ctx.availableSlots,
      notice: null,
      blocked,
      appointmentId: null,
    };
  }

  push({ role: "user", content: params.text, createdAt: now.toISOString() });

  // ── 范围闸 ────────────────────────────────────────────────
  // 放在推进主模型之前：跑题的话根本不该花一次主模型调用。
  // 规则层先判（零成本可复现），判不了才问分类器；分类器任何失败都放行。
  const scope = await checkScope({
    text: params.text,
    classifier: createScopeClassifier(),
    counter: getStrike(session.id),
  });
  setStrike(session.id, scope.counter);

  if (scope.blocked) {
    push({
      role: "assistant",
      content: scope.reply ?? "这个我帮不上忙，我们聊聊实验报名吧。",
      createdAt: now.toISOString(),
    });
    await chatSessions.save(session.id, session.state, stringifyMessages(history));
    // 拦在表单模式：用户可以直接无视对话去点下面的时段，不该因为说了句
    // 不相关的话就失去预约能力
    return {
      mode: "form",
      state: session.state,
      experimentType: ctx.experiment.type,
      messages: history,
      suggestedSlots: collectSuggestedSlots(history, ctx.availableSlots),
      availableSlots: ctx.availableSlots,
      notice: null,
      blocked: null,
      appointmentId: null,
    };
  }

  const userTurns = history.filter((m) => m.role === "user").length;
  if (userTurns > MAX_TURNS) {
    push({
      role: "assistant",
      content: "我们聊得有点久了，直接选时段更快——下面这些还有空位。",
      createdAt: now.toISOString(),
    });
    await chatSessions.save(session.id, ChatState.PROPOSED, stringifyMessages(history));
    return {
      mode: "form",
      state: ChatState.PROPOSED,
      experimentType: ctx.experiment.type,
      messages: history,
      suggestedSlots: [],
      availableSlots: ctx.availableSlots,
      notice: `已聊满 ${MAX_TURNS} 轮，切换成时段多选`,
      blocked: null,
      appointmentId: null,
    };
  }

  if (!getLlm().configured()) {
    push({
      role: "assistant",
      content: "排期助手暂时不可用，直接选一个你能来的时段吧。",
      createdAt: now.toISOString(),
    });
    await chatSessions.save(session.id, ChatState.PROPOSED, stringifyMessages(history));
    return {
      mode: "form",
      state: ChatState.PROPOSED,
      experimentType: ctx.experiment.type,
      messages: history,
      suggestedSlots: [],
      availableSlots: ctx.availableSlots,
      notice: "LLM 未配置，已切换到时段多选",
      blocked: null,
      appointmentId: null,
    };
  }

  const sink: ToolSink = {};
  const system = buildSystemPrompt(ctx, parseVaguePreferred(params.text, now));
  // 工具闸的状态：记录本轮已发生的调用，供重复检测与读写预算判断
  const guard = createGuardState({ availableSlotIds: ctx.availableSlots.map((s) => s.id) });

  try {
    for (let step = 0; step < 5; step += 1) {
      const llmMessages = toLlmMessages(system, history);
      const reply = await getLlm().chat({ messages: llmMessages, tools: toolRegistry.specs() });

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
        // 闸在 exec 之前判：它挡的是模型的调用**行为**（刷接口、绕过用户下单），
        // 这类问题跨工具发生，所以放在所有工具的共同入口前面。
        const verdict = guardToolCall({
          name: tc.name,
          args: tc.args,
          risk: toolRegistry.riskOf(tc.name),
          guard,
        });

        let result;
        if (!verdict.allow) {
          // 被拦下也要记 —— 否则模型原样重试时永远被当成「第一次」
          noteToolCall({ name: tc.name, args: tc.args, guard });
          result = deniedResult(verdict);
        } else {
          result = await toolRegistry.exec(tc.name, tc.args, toToolContext(ctx, sink));
          noteToolCall({ name: tc.name, args: tc.args, guard, booked: Boolean(sink.appointmentId) });
        }

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
    await chatSessions.save(session.id, ChatState.PROPOSED, stringifyMessages(history));
    return {
      mode: "form",
      state: ChatState.PROPOSED,
      experimentType: ctx.experiment.type,
      messages: history,
      suggestedSlots: [],
      availableSlots: ctx.availableSlots,
      notice: "排期助手无响应，已切换到时段多选",
      blocked: null,
      appointmentId: null,
    };
  }

  const nextState = sink.state ?? session.state;
  await chatSessions.save(session.id, nextState, stringifyMessages(history));

  const freshAvailable = (await loadContext(params.experimentId, params.subjectId, new Date())).availableSlots;

  return {
    mode: "llm",
    state: nextState,
    experimentType: ctx.experiment.type,
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
