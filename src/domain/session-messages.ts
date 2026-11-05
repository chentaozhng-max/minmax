/**
 * 门厅会话消息 —— 折叠存储 + 两种展开。
 *
 * ## 为什么不按「user / assistant / tool_call / tool_result」四类平铺存储
 *
 * 与模型交互那一层**本来就已经是四类**（`expandForLlm` 产出的 `assistant.tool_calls`
 * + `role:"tool"` 回填）。问题只在存储：平铺会让消息条数翻倍，还要额外校验
 * `tool_call_id` 配对（悬空 result 会让 provider 直接 400）。
 *
 * 折叠存储把 tool_result 塞进 `assistant.toolCalls[i].result`：
 *   · 卡片渲染天然绑在「这条 assistant 说了什么 + 它查到了什么」上，不用反查
 *   · 条数不翻倍，老测试不受影响
 * 语义上仍是四类，只是落盘是折叠态 —— 转换全在本文件，别处不要自己拼。
 *
 * ## 本文件必须是纯函数（零 IO）
 *
 * 领域层不许碰外部世界（L1/L2），所以这里只做数据变换，压缩策略与存储实现都在外层。
 */
import type { LlmMessage, LlmRawToolCall } from "@/domain/ports/llm";

/** 一次工具调用（结果折叠在里面） */
export type SessionToolCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
};

/** 一条会话消息（与 ChatMessage 形状对齐，页面可直接复用） */
export type SessionMessage = {
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  toolCalls?: SessionToolCall[];
};

/* ---------------- 序列化 ---------------- */

/** 解析失败返回空数组而不是抛错：一条坏数据不该让整段对话打不开 */
export function parseSessionMessages(raw: string): SessionMessage[] {
  let list: unknown;
  try {
    list = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];

  const out: SessionMessage[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    if (rec.role !== "user" && rec.role !== "assistant") continue;
    if (typeof rec.content !== "string") continue;
    out.push({
      role: rec.role,
      content: rec.content,
      createdAt: typeof rec.createdAt === "string" ? rec.createdAt : new Date(0).toISOString(),
      ...(Array.isArray(rec.toolCalls)
        ? { toolCalls: rec.toolCalls as SessionToolCall[] }
        : {}),
    });
  }
  return out;
}

export function stringifySessionMessages(messages: SessionMessage[]): string {
  return JSON.stringify(messages);
}

/* ---------------- 展开 / 折叠 ---------------- */

/**
 * 折叠态 → provider 要的四类。
 *
 * 两个必须守住的点（当初踩过）：
 *   · 只有 tool_calls 没有文字时 `content` 必须是 `null`，传 `""` 会被当成空消息
 *   · 每个 tool_call 后面必须紧跟一条 `role:"tool"` 回填，否则 400
 */
export function expandForLlm(messages: SessionMessage[]): LlmMessage[] {
  const out: LlmMessage[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      out.push({ role: "user", content: m.content });
      continue;
    }
    const calls = m.toolCalls ?? [];
    const rawCalls: LlmRawToolCall[] = calls.map((c) => ({
      id: c.id,
      type: "function",
      function: { name: c.name, arguments: JSON.stringify(c.args) },
    }));
    out.push({
      role: "assistant",
      content: m.content || null,
      ...(rawCalls.length > 0 ? { tool_calls: rawCalls } : {}),
    });
    for (const c of calls) {
      out.push({
        role: "tool",
        tool_call_id: c.id,
        content: JSON.stringify(c.result ?? { ok: true }),
      });
    }
  }
  return out;
}

/**
 * 四类 → 折叠态（expandForLlm 的逆）。
 *
 * ⚠️ 悬空的 `role:"tool"`（前面没有对应的 tool_call）**直接丢弃**，不抛错 ——
 * 历史里出现半截数据时，宁可少一条消息，也不要让整页 500。
 * `createdAt` 无法从 LlmMessage 还原，统一用 `createdAt` 参数兜底。
 */
export function collapseFromLlm(messages: LlmMessage[], createdAt: string): SessionMessage[] {
  const out: SessionMessage[] = [];

  for (let i = 0; i < messages.length; i += 1) {
    const m = messages[i];
    if (m.role === "user") {
      out.push({ role: "user", content: m.content, createdAt });
      continue;
    }
    if (m.role !== "assistant") continue; // 悬空 tool / system 都丢掉

    const rawCalls = m.tool_calls ?? [];
    if (rawCalls.length === 0) {
      out.push({ role: "assistant", content: m.content ?? "", createdAt });
      continue;
    }

    const toolCalls: SessionToolCall[] = rawCalls.map((c) => ({
      id: c.id,
      name: c.function.name,
      args: safeParseArgs(c.function.arguments),
    }));

    // 把紧跟其后的 tool 消息按 id 回填
    let j = i + 1;
    while (j < messages.length && messages[j].role === "tool") {
      const toolMsg = messages[j] as { role: "tool"; tool_call_id: string; content: string };
      const target = toolCalls.find((c) => c.id === toolMsg.tool_call_id);
      if (target) {
        target.result = safeParseValue(toolMsg.content);
        i = j;
      }
      j += 1;
    }

    out.push({ role: "assistant", content: m.content ?? "", createdAt, toolCalls });
  }

  return out;
}

function safeParseArgs(raw: string): Record<string, unknown> {
  const v = safeParseValue(raw);
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function safeParseValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/* ---------------- 压缩 ---------------- */

/**
 * 第 1 层压缩：工具返回体只留「渲染 + 追述」需要的最小字段。
 *
 * 为什么可以这么狠：门厅前端只渲染**最后一轮**搜索的卡片（`lastSearchIndex`），
 * 所以更早轮次的 `result` 本来就是死数据 —— 实测它占了历史体积的 91%。
 * 这里做的是纯删除，不需要模型参与，因此零成本。
 *
 * 丢掉的是会腐烂的字段（`startAt` / `remaining` / 具体奖励），
 * 保留的是「点得进去的 id + 标题」和「一句话结论」。
 */
export function compactToolResult(result: unknown): unknown {
  if (result === null || result === undefined) return null;
  if (typeof result !== "object" || Array.isArray(result)) return result;

  const src = result as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  if (typeof src.ok === "boolean") out.ok = src.ok;
  if (typeof src.error === "string") out.error = src.error;
  if (typeof src.summary === "string") out.summary = src.summary;
  if (typeof src.totalEligible === "number") out.totalEligible = src.totalEligible;
  if (typeof src.excludedCount === "number") out.excludedCount = src.excludedCount;

  // 被资格挡掉的：标题 + 原因已是最小集合
  if (Array.isArray(src.excluded)) {
    out.excluded = src.excluded
      .filter((e): e is Record<string, unknown> => Boolean(e) && typeof e === "object")
      .map((e) => ({ title: e.title, reason: e.reason }));
  }

  // 卡片只留点得进去的 id + 标题；时段/剩余名额/奖励一律丢弃（进详情页会重新查）
  const list = Array.isArray(src.experiments)
    ? src.experiments
    : Array.isArray(src.cards)
      ? src.cards
      : null;
  if (list) {
    out.cards = list
      .filter((c): c is Record<string, unknown> => Boolean(c) && typeof c === "object")
      .map((c) => ({ id: c.id, title: c.title }));
  }

  return out;
}

/** 第 1 层：最近 `keepRecent` 条原样保留，更早的 assistant 工具结果降级 */
export function compactHistory(messages: SessionMessage[], keepRecent: number): SessionMessage[] {
  const cut = messages.length - keepRecent;
  return messages.map((m, i) => {
    if (i >= cut) return m;
    if (m.role !== "assistant" || !m.toolCalls?.length) return m;
    return {
      ...m,
      toolCalls: m.toolCalls.map((c) => ({ ...c, result: compactToolResult(c.result) })),
    };
  });
}

/** 是否需要触发压缩（按消息条数，user 与 assistant 都算） */
export function shouldCompact(messages: SessionMessage[], threshold: number): boolean {
  return messages.length > threshold;
}
