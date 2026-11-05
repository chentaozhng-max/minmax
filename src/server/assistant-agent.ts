/**
 * 门厅对话编排 —— 「还不知道是哪门实验」时的找实验对话。
 *
 * ## 与 server/agent.ts 的分工
 *
 *   agent.ts      房间：loadContext(experimentId) 锁死一门实验，7 个工具排期/预约
 *   本文件        门厅：没有 experimentId，只有 1 个工具（search_experiments）
 *
 * 两份编排不合并，因为它们的**上下文形状不同**（一个有 experiment 一个没有）。
 * 合并的结果一定是「experiment 变成可选」——那 7 个工具就都不知道自己在哪了。
 *
 * ## AI 在这里只做一件事
 *
 * 把用户的话翻成搜索条件，然后把结果说人话。**不排期、不下单**。
 * 用户点卡片里的时段后跳回 `/experiments/[id]/chat`，那条链路复用现成的 7 个工具。
 */
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/http";
import { makeSessionStore } from "@/adapters/db/prisma/session-store-repo";
import { makeExperimentSearch } from "@/adapters/db/prisma/experiment-search";
import { makeSchedulingQuery } from "@/adapters/db/prisma/scheduling-query";
import { searchExperiments, type SearchSubject } from "@/application/search-experiments";
import { createAssistantToolRegistry } from "@/tools";
import type { AssistantContext, AssistantSearchPayload } from "@/tools/assistant-context";
import type { SessionMessage } from "@/domain/session-messages";
import { getLlm, type LlmMessage } from "@/adapters/llm";

const sessions = makeSessionStore(prisma as never);
const experimentSearch = makeExperimentSearch(prisma as never);
const schedulingQuery = makeSchedulingQuery(prisma);
const toolRegistry = createAssistantToolRegistry();

/** 二二定的开场白。只在一条消息都没有时出现 */
export const ASSISTANT_OPENING = "你好，我是你的实验助手，你想参加什么实验？";

/** 最多留多少条消息（门厅不需要长记忆） */
const MAX_STORED_MESSAGES = 20;
/** 一轮里最多让模型连调几次工具 */
const MAX_TOOL_STEPS = 3;

/**
 * 「还算接着聊」的窗口。
 *
 * 阶段 2 先用它顶住「一人一条永不更换」的老行为：不传真实 sessionId 时取最近
 * 30 分钟内活跃的那条。阶段 3 起 sessionId 由前端带上来，这个窗口退化成兜底。
 */
const RESUME_WINDOW_MS = 30 * 60 * 1000;

export type AssistantChatResult = {
  messages: SessionMessage[];
  /** true = 这轮是降级（没配 LLM 或模型炸了），页面照常可看列表 */
  degraded: boolean;
  notice: string | null;
};

/* ---------------- 读出当前视图 ---------------- */

export async function getAssistantChatView(subjectId: string): Promise<AssistantChatResult> {
  const thread = await findSession(subjectId, new Date());
  const stored = thread?.messages ?? [];
  if (stored.length > 0) return { messages: stored, degraded: false, notice: null };

  // 空对话 = 首次进来。开场白不落库（否则每加一条都要判一次「这条是不是开场白」）
  return {
    messages: [
      { role: "assistant", content: ASSISTANT_OPENING, createdAt: new Date().toISOString() },
    ],
    degraded: false,
    notice: null,
  };
}

/* ---------------- 发一轮 ---------------- */

export async function sendAssistantTurn(params: {
  subjectId: string;
  text: string;
  now?: Date;
}): Promise<AssistantChatResult> {
  const now = params.now ?? new Date();
  const subject = await loadSubject(params.subjectId);
  if (!subject) throw new ApiError(404, "用户不存在");

  // 没有活会话就开一条：这正是「每次打开网站 = 新 session」的落点
  const thread = (await findSession(params.subjectId, now)) ?? (await sessions.create(params.subjectId));
  const history: SessionMessage[] = [...thread.messages];
  history.push({ role: "user", content: params.text, createdAt: now.toISOString() });

  const ctx = makeAssistantContext(subject, now);

  if (!getLlm().configured()) {
    // 没配模型也要能用：直接搜一次。门厅的价值是「找到实验」，聊天只是包装。
    history.push(await runSearchFallback(ctx, now));
    await save(thread.id, thread.summary, history);
    return { messages: history, degraded: true, notice: "助手暂时只能给你直接搜到的列表" };
  }

  try {
    await runToolLoop(history, ctx, now);
  } catch (error) {
    console.error("[assistant-agent] llm failed", error);
    history.push(await runSearchFallback(ctx, now));
    await save(thread.id, thread.summary, history);
    return {
      messages: history,
      degraded: true,
      notice: "助手刚才走神了，先给你一份直接搜到的列表",
    };
  }

  await save(thread.id, thread.summary, history);
  return { messages: history, degraded: false, notice: null };
}

/* ---------------- 内部 ---------------- */

/** 最近窗口内的活会话；没有则 null（调用方决定是否新建） */
async function findSession(subjectId: string, now: Date) {
  return sessions.findActiveBySubject(subjectId, new Date(now.getTime() - RESUME_WINDOW_MS));
}

async function loadSubject(subjectId: string): Promise<SearchSubject | null> {
  const profile = await schedulingQuery.findSubjectProfile(subjectId);
  if (!profile) return null;
  return {
    id: profile.id,
    creditScore: profile.creditScore,
    studentVerified: profile.studentVerified,
    bannedUntil: profile.bannedUntil,
  };
}

/**
 * 装配工具上下文。
 *
 * `search` 回调把 application 用例包一层，并把结果裁成工具/页面都能吃的形状。
 * 注入成回调而不是让工具 import prisma —— 工具测试因此可以塞假实现。
 */
function makeAssistantContext(subject: SearchSubject, now: Date): AssistantContext {
  return {
    subject,
    now,
    async search(criteria) {
      const r = await searchExperiments({ search: experimentSearch, now }, subject, criteria);
      return {
        summary: r.summary,
        totalEligible: r.totalEligible,
        excluded: r.excluded,
        excludedCount: r.excludedCount,
        experiments: r.hits.map((h) => ({
          id: h.id,
          title: h.title,
          location: h.location,
          durationMin: h.durationMin,
          rewardText: h.rewardText,
          researcherName: h.researcherName,
          matchedSlotCount: h.matchedSlotCount,
          nextSlotAt: h.nextSlotAt,
          matchedSlots: h.matchedSlots,
        })),
      } satisfies AssistantSearchPayload;
    },
  };
}

/** 降级路径：不带条件搜一次，把它写成人话 */
async function runSearchFallback(
  ctx: AssistantContext,
  now: Date,
): Promise<SessionMessage> {
  const payload = await ctx.search({});
  return {
    role: "assistant",
    content: payload.summary,
    createdAt: now.toISOString(),
    // 存 toolCalls 形状，页面渲染卡片与正常路径完全一致
    toolCalls: [
      {
        id: `fallback_${now.getTime()}`,
        name: "search_experiments",
        args: {},
        result: { ok: true, ...payload },
      },
    ],
  };
}

/**
 * 工具循环。与 agent.ts 同构，但只有 3 步（门厅不需要多轮工具编排）。
 *
 * ⚠️ 关键点：模型回的 tool_call 必须**回填 role:"tool" 消息**再继续，
 * 否则下一轮会被 provider 判为「assistant 的 tool_calls 没有跟随 tool 消息」而 400。
 */
async function runToolLoop(
  history: SessionMessage[],
  ctx: AssistantContext,
  now: Date,
): Promise<void> {
  for (let step = 0; step < MAX_TOOL_STEPS; step += 1) {
    const reply = await getLlm().chat({ messages: toLlmMessages(history), tools: toolRegistry.specs() });

    if (reply.toolCalls.length === 0) {
      history.push({
        role: "assistant",
        content: reply.content || "我在，说说你想参加什么方向的实验？",
        createdAt: new Date().toISOString(),
      });
      return;
    }

    const record: SessionMessage = {
      role: "assistant",
      content: reply.content,
      createdAt: new Date().toISOString(),
      toolCalls: reply.toolCalls.map((tc) => ({ ...tc, result: undefined })),
    };
    history.push(record);

    for (const tc of reply.toolCalls) {
      // 门厅只有 search_experiments；别的工具明确拒绝而不是静默失败（静默会让模型反复重试）
      const result = toolRegistry.has(tc.name)
        ? await toolRegistry.exec(tc.name, tc.args, { ctx, sink: {}, now: ctx.now })
        : { ok: false, error: `这里只能搜索实验，不能调用 ${tc.name}` };
      const stored = record.toolCalls?.find((x) => x.id === tc.id);
      if (stored) stored.result = result;
    }
  }

  // 3 步还没收尾：不让用户干等
  history.push({
    role: "assistant",
    content: "我查到了，点下面的卡片看看具体时间吧。",
    createdAt: now.toISOString(),
  });
}

/** 把持久化消息转成 OpenAI 兼容格式（与 agent.ts 同构，不做 provider 特有处理） */
function toLlmMessages(history: SessionMessage[]): LlmMessage[] {
  const out: LlmMessage[] = [{ role: "system", content: SYSTEM_PROMPT }];
  for (const m of history) {
    if (m.role === "user") {
      out.push({ role: "user", content: m.content });
      continue;
    }
    const calls = m.toolCalls ?? [];
    out.push({
      role: "assistant",
      // 只有 tool_calls 没有文字时 content 必须是 null —— 传 "" 会被 provider 当成空消息
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
    } as LlmMessage);
    for (const c of calls) {
      out.push({ role: "tool", tool_call_id: c.id, content: JSON.stringify(c.result ?? { ok: true }) });
    }
  }
  return out;
}

/**
 * 门厅的系统提示词。
 *
 * 写得很短：只有一个工具、一个任务。
 * 三条硬约束：必须调工具（不许凭空说有哪些实验）、条件原样传中文（不许算日期）、不排期。
 */
const SYSTEM_PROMPT = [
  "你是「PsyMatch」的实验助手，帮被试找到合适的实验。",
  "",
  "## 你只能做一件事：按条件搜索实验",
  '用户说想找实验时，调用 search_experiments。条件原样传中文（weekday: "周三"、timeOfDay: "下午"），',
  "不要自己算日期——日期换算由系统做。没有任何条件也要调用一次。",
  "",
  "## 你不能做的事",
  "- 不能直接预约。预约要用户自己点卡片里的时段，点完会跳到他选的那门实验里完成。",
  "- 不能编造实验名、时间、奖励。一切事实来自 search_experiments 的返回。",
  "- 不能调用除 search_experiments 以外的任何工具。",
  "",
  "## 怎么说",
  "1. 先用一句话说结果（summary 已经写好了，照着说或稍微口语化一点）。",
  "2. 被资格挡掉的实验要提到（excluded），让用户知道不是系统里没有，而是他暂时报不了。",
  "3. 语气简洁口语化，每条不超过 3 行。不要用列表符号，不要复述原始数据，不要报 id。",
  "4. 全程用中文。",
].join("\n");

async function save(id: string, summary: string | null, messages: SessionMessage[]): Promise<void> {
  // 阶段 2 的保留策略仍是「只留最近若干条」——真压缩在阶段 3 接上。
  // 走 SessionStore 而不是老仓储：老端口按 subjectId 唯一，写不出第二条会话。
  await sessions.save(id, { messages: messages.slice(-MAX_STORED_MESSAGES), summary });
}
