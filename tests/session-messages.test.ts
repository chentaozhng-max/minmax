import { describe, expect, it } from "vitest";
import {
  collapseFromLlm,
  compactHistory,
  compactToolResult,
  expandForLlm,
  parseSessionMessages,
  shouldCompact,
  stringifySessionMessages,
  type SessionMessage,
} from "@/domain/session-messages";
import type { LlmMessage } from "@/domain/ports/llm";

/**
 * 折叠存储 ⇄ 四类展开 的等价性，以及第 1 层压缩的「无腐烂字段」约束。
 *
 * 这个文件测的是领域层纯函数，不碰数据库不碰网络 —— 所以它同时也是
 * 「压缩逻辑本身有没有搞错」的第一道闸。
 */

const at = "2026-11-05T10:00:00.000Z";

const userMsg = (content: string): SessionMessage => ({ role: "user", content, createdAt: at });

const assistantText = (content: string): SessionMessage => ({
  role: "assistant",
  content,
  createdAt: at,
});

const assistantWithTool = (result: unknown): SessionMessage => ({
  role: "assistant",
  content: "",
  createdAt: at,
  toolCalls: [{ id: "call_1", name: "search_experiments", args: { weekday: "周三" }, result }],
});

describe("expandForLlm", () => {
  it("user 消息原样透传", () => {
    expect(expandForLlm([userMsg("周三下午有空")])).toEqual([
      { role: "user", content: "周三下午有空" },
    ]);
  });

  it("只有 toolCalls 没有文字时 content 必须是 null（传空串会被当成空消息）", () => {
    const out = expandForLlm([assistantWithTool({ ok: true })]);
    expect(out[0]).toMatchObject({ role: "assistant", content: null });
  });

  it("每个 tool_call 后面紧跟一条 role:tool 回填（否则 provider 400）", () => {
    const out = expandForLlm([assistantWithTool({ ok: true, summary: "找到 3 门" })]);

    expect(out).toHaveLength(2);
    expect(out[1].role).toBe("tool");
    expect((out[1] as { tool_call_id: string }).tool_call_id).toBe("call_1");
    expect(JSON.parse((out[1] as { content: string }).content)).toEqual({
      ok: true,
      summary: "找到 3 门",
    });
  });

  it("result 缺失时回填 {ok:true}，不留空字符串", () => {
    const msg: SessionMessage = {
      role: "assistant",
      content: "",
      createdAt: at,
      toolCalls: [{ id: "c9", name: "x", args: {} }],
    };
    const tool = expandForLlm([msg])[1] as { content: string };
    expect(JSON.parse(tool.content)).toEqual({ ok: true });
  });
});

describe("collapseFromLlm", () => {
  it("把 tool 回填折叠进 assistant.toolCalls（而非留成独立消息）", () => {
    const llm: LlmMessage[] = [
      { role: "user", content: "周三下午有空" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "c1",
            type: "function",
            function: { name: "search_experiments", arguments: '{"weekday":"周三"}' },
          },
        ],
      },
      { role: "tool", tool_call_id: "c1", content: '{"ok":true}' },
    ];
    const folded = collapseFromLlm(llm, at);

    expect(folded).toHaveLength(2);
    expect(folded[1].toolCalls).toHaveLength(1);
    expect(folded[1].toolCalls?.[0].result).toEqual({ ok: true });
    expect(folded[1].toolCalls?.[0].args).toEqual({ weekday: "周三" });
  });

  it("⚠️ 悬空 tool 消息被丢弃，不抛错", () => {
    const llm: LlmMessage[] = [
      { role: "user", content: "hi" },
      { role: "tool", tool_call_id: "orphan", content: '{"ok":true}' },
    ];
    expect(() => collapseFromLlm(llm, at)).not.toThrow();
    expect(collapseFromLlm(llm, at)).toHaveLength(1);
  });

  it("arguments 不是合法 JSON 时回落成空对象，不炸", () => {
    const llm: LlmMessage[] = [
      {
        role: "assistant",
        content: "在",
        tool_calls: [{ id: "c1", type: "function", function: { name: "x", arguments: "{不是JSON" } }],
      },
    ];
    expect(collapseFromLlm(llm, at)[0].toolCalls?.[0].args).toEqual({});
  });

  it("多个 tool_call 时按 id 分别回填（不能串）", () => {
    const llm: LlmMessage[] = [
      {
        role: "assistant",
        content: null,
        tool_calls: [
          { id: "a", type: "function", function: { name: "t1", arguments: "{}" } },
          { id: "b", type: "function", function: { name: "t2", arguments: "{}" } },
        ],
      },
      { role: "tool", tool_call_id: "b", content: '{"v":"B"}' },
      { role: "tool", tool_call_id: "a", content: '{"v":"A"}' },
    ];
    const calls = collapseFromLlm(llm, at)[0].toolCalls ?? [];
    expect(calls.find((c) => c.id === "a")?.result).toEqual({ v: "A" });
    expect(calls.find((c) => c.id === "b")?.result).toEqual({ v: "B" });
  });
});

describe("往返等价", () => {
  it.each([
    ["纯文字对话", [userMsg("周三有空"), assistantText("找到 3 门实验")]],
    ["带工具调用", [userMsg("找实验"), assistantWithTool({ ok: true, summary: "找到 3 门" })]],
    [
      "多轮混合",
      [
        userMsg("找实验"),
        assistantWithTool({ ok: true, summary: "找到 3 门" }),
        userMsg("换个时间"),
        assistantText("好的"),
      ],
    ],
  ])("%s：collapse(expand(x)) 等价于 x", (_name, original: SessionMessage[]) => {
    const roundTripped = collapseFromLlm(expandForLlm(original), at);
    expect(roundTripped).toEqual(original);
  });
});

describe("compactToolResult", () => {
  it("只留 id + 标题，丢掉会腐烂的时段与名额", () => {
    const full = {
      ok: true,
      summary: "找到 2 门符合的实验",
      totalEligible: 2,
      excludedCount: 0,
      experiments: [
        {
          id: "exp_1",
          title: "睡眠与情绪",
          location: "302",
          rewardText: "¥50",
          durationMin: 30,
          matchedSlotCount: 2,
          nextSlotAt: "2026-11-06T14:00:00.000Z",
          matchedSlots: [
            { startAt: "2026-11-06T14:00:00.000Z", endAt: "2026-11-06T14:30:00.000Z", remaining: 2 },
          ],
        },
      ],
    };
    const compact = compactToolResult(full) as Record<string, unknown>;

    expect(compact.cards).toEqual([{ id: "exp_1", title: "睡眠与情绪" }]);
    expect(compact.summary).toBe("找到 2 门符合的实验");
  });

  it("⚠️ 压缩结果里不许出现 startAt / remaining（会腐烂的字段被回退时这条会红）", () => {
    const compact = compactToolResult({
      ok: true,
      experiments: [
        { id: "a", title: "A", matchedSlots: [{ startAt: "x", remaining: 3 }], nextSlotAt: "y" },
      ],
    });
    const text = JSON.stringify(compact);

    expect(text).not.toContain("startAt");
    expect(text).not.toContain("remaining");
    expect(text).not.toContain("nextSlotAt");
    expect(text).not.toContain("rewardText");
  });

  it("被资格挡掉的只留标题 + 原因", () => {
    const compact = compactToolResult({
      ok: true,
      excluded: [{ title: "XX", reason: "需要学生认证", extra: { secret: 1 } }],
      excludedCount: 1,
    }) as { excluded: unknown[] };

    expect(compact.excluded).toEqual([{ title: "XX", reason: "需要学生认证" }]);
  });

  it("null / 原始值原样返回，不抛错", () => {
    expect(compactToolResult(null)).toBeNull();
    expect(compactToolResult("字符串")).toBe("字符串");
    expect(compactToolResult([1, 2])).toEqual([1, 2]);
  });
});

describe("compactHistory / shouldCompact", () => {
  const build = (n: number): SessionMessage[] =>
    Array.from({ length: n }, (_, i) =>
      i % 2 === 0
        ? userMsg(`q${i}`)
        : assistantWithTool({
            ok: true,
            experiments: [{ id: `e${i}`, title: `T${i}`, startAt: "s", remaining: 1 }],
          }),
    );

  it("最近 keepRecent 条原样保留（含完整 payload）", () => {
    const msgs = build(5); // 索引 3、4 是「最近两条」：3 = assistant 带工具
    const out = compactHistory(msgs, 2);
    const keptTool = out[3] as SessionMessage;

    expect(JSON.stringify(keptTool.toolCalls?.[0].result)).toContain("startAt");
  });

  it("更早的工具结果被压缩掉腐烂字段", () => {
    const out = compactHistory(build(5), 2);
    const firstTool = out[1] as SessionMessage;

    expect(JSON.stringify(firstTool.toolCalls?.[0].result)).not.toContain("startAt");
    expect(JSON.stringify(firstTool.toolCalls?.[0].result)).toContain("T1");
  });

  it("不改原数组（纯函数，别让上层拿到被改过的历史）", () => {
    const msgs = build(5);
    const snapshot = JSON.stringify(msgs);
    compactHistory(msgs, 2);
    expect(JSON.stringify(msgs)).toBe(snapshot);
  });

  it("keepRecent 大于总条数时什么也不压", () => {
    const msgs = build(3);
    expect(compactHistory(msgs, 10)).toEqual(msgs);
  });

  it("shouldCompact 严格大于阈值才触发", () => {
    expect(shouldCompact(build(20), 20)).toBe(false);
    expect(shouldCompact(build(21), 20)).toBe(true);
  });
});

describe("序列化", () => {
  it("往返一致", () => {
    const msgs = [userMsg("你好"), assistantWithTool({ ok: true })];
    expect(parseSessionMessages(stringifySessionMessages(msgs))).toEqual(msgs);
  });

  it("坏 JSON → 空数组，不抛错", () => {
    expect(parseSessionMessages("{不是 JSON")).toEqual([]);
  });

  it("单条坏消息只丢那一条", () => {
    const raw = JSON.stringify([
      { role: "user", content: "正常", createdAt: at },
      { role: "system", content: "角色不认识" },
      { role: "user", content: 123 },
      null,
      { role: "assistant", content: "也正常", createdAt: at },
    ]);
    expect(parseSessionMessages(raw).map((m) => m.content)).toEqual(["正常", "也正常"]);
  });
});
