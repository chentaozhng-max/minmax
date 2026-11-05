"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUp, ChevronDown, MapPin, Sparkles, Timer } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { RewardTag } from "@/components/reward-tag";
import { toast } from "@/components/toast";
import { api, postJson } from "@/lib/api-client";
import { formatDayCN, formatHM } from "@/lib/time";

/** 与 server/assistant-agent.ts 的 AssistantChatResult 对应 */
type ThreadMessage = {
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  toolCalls?: {
    id: string;
    name: string;
    args: Record<string, unknown>;
    result?: unknown;
  }[];
};

type ChatResult = {
  messages: ThreadMessage[];
  /** 这一轮所属的会话 id。下一句要带回去，否则只能靠时间窗口猜 */
  sessionId: string;
  /** 正在进行的实验场数（门厅标题显示「已约 N 场」） */
  bookedCount: number;
  degraded: boolean;
  notice: string | null;
};

/** search_experiments 的返回（只取渲染需要的字段） */
type SearchHit = {
  id: string;
  title: string;
  location: string;
  durationMin: number;
  rewardText: string;
  researcherName: string;
  matchedSlotCount: number;
  nextSlotAt: string | null;
  matchedSlots: { id: string; startAt: string; endAt: string; remaining: number }[];
};

type SearchPayload = {
  ok?: boolean;
  summary?: string;
  experiments?: SearchHit[];
  excluded?: { title: string; reason: string }[];
  excludedCount?: number;
};

const QUICK_WORDS = ["周三下午有空", "奖励高的", "一个小时以内"];

export function AssistantChatView({ initial }: { initial: ChatResult }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const { data } = useQuery({
    queryKey: ["assistant-chat"],
    queryFn: () => api<ChatResult>("/api/assistant/chat"),
    initialData: initial,
    staleTime: 0,
  });

  const view = data ?? initial;

  /**
   * 只渲染**最后一轮**搜索的卡片。
   *
   * 不然改条件之后，旧卡片还留在上面，一屏翻下去 4 组列表 ——
   * 用户会以为「怎么越搜越多」。历史搜索的结果已经被新结果取代，
   * 留着它只是噪音；对话文字还留着，能看出他筛过什么。
   */
  const lastSearchIndex = (() => {
    for (let i = view.messages.length - 1; i >= 0; i--) {
      const has = (view.messages[i].toolCalls ?? []).some((c) => c.name === "search_experiments");
      if (has) return i;
    }
    return -1;
  })();

  const send = useMutation({
    mutationFn: (content: string) =>
      postJson<ChatResult>("/api/assistant/chat", {
        content,
        // 带上服务端给的 sessionId：不带就只能靠 30 分钟时间窗猜，
        // 用户在两个窗口/两次访问之间切换时会接错会话。
        sessionId: view.sessionId || undefined,
      }),
    onSuccess: (next) => {
      queryClient.setQueryData(["assistant-chat"], next);
      setDraft("");
    },
    onError: (error: Error) => toast(error.message, "error"),
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [view.messages.length, send.isPending]);

  function submit() {
    const text = draft.trim();
    if (!text) return;
    send.mutate(text);
  }

  return (
    <main className="mx-auto flex h-[100dvh] w-full max-w-[480px] flex-col bg-paper">
      <PageHeader
        title="实验助手"
        subtitle={
          view.bookedCount > 0 ? `已约 ${view.bookedCount} 场，还想参加什么？` : "我帮你找合适的实验"
        }
        back="/assistant"
        profile={{ role: "SUBJECT" }}
      />

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {view.messages.map((m, i) => (
          <MessageBlock key={`${m.createdAt}-${i}`} message={m} showCards={i === lastSearchIndex} />
        ))}

        {/* 快捷词只在还没说过话时出现：说过了就说明他知道怎么问了 */}
        {view.messages.filter((m) => m.role === "user").length === 0 ? (
          <div className="mb-3 ml-9 flex flex-wrap gap-1.5">
            {QUICK_WORDS.map((text) => (
              <button
                key={text}
                type="button"
                disabled={send.isPending}
                onClick={() => send.mutate(text)}
                className="press rounded-pill border border-line bg-surface px-2.5 py-1 text-[12px] text-ink-soft active:bg-mist disabled:opacity-50"
              >
                {text}
              </button>
            ))}
          </div>
        ) : null}

        {send.isPending ? (
          <div className="mb-3 flex items-center gap-2 pl-1">
            <Avatar />
            <span className="flex gap-1 rounded-card border border-line bg-surface px-3 py-2">
              <Dot delay="0ms" />
              <Dot delay="140ms" />
              <Dot delay="280ms" />
            </span>
          </div>
        ) : null}

        {view.notice ? <p className="my-3 text-center text-[11px] text-warn">{view.notice}</p> : null}

        <div ref={bottomRef} className="h-2" />
      </div>

      <div className="border-t border-line bg-surface px-3 py-2 pb-[calc(8px+env(safe-area-inset-bottom))]">
        <div className="flex items-end gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) submit();
            }}
            placeholder="比如：周三下午有空，别太久"
            maxLength={500}
            className="h-11 flex-1 rounded-pill bg-[#F5F6F7] px-4 text-[14px] outline-none focus:bg-surface focus:ring-1 focus:ring-moss/40"
          />
          <button
            type="button"
            onClick={submit}
            disabled={!draft.trim() || send.isPending}
            aria-label="发送"
            className="press mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-moss text-white disabled:opacity-40"
          >
            <ArrowUp size={19} strokeWidth={2.4} />
          </button>
        </div>
      </div>
    </main>
  );
}

/* ---------------- 消息渲染 ---------------- */

function MessageBlock({ message, showCards = true }: { message: ThreadMessage; showCards?: boolean }) {
  if (message.role === "user") {
    return (
      <div className="mb-3 flex justify-end">
        <div className="max-w-[80%] rounded-[12px] rounded-tr-[4px] bg-moss px-3 py-2 text-[14px] leading-[22px] text-white">
          {message.content}
        </div>
      </div>
    );
  }

  // 只认 search_experiments 的结果；别的工具在门厅不存在
  const payloads = showCards
    ? (message.toolCalls ?? [])
        .filter((c) => c.name === "search_experiments")
        .map((c) => c.result as SearchPayload | undefined)
        .filter((p): p is SearchPayload => Boolean(p))
    : [];

  return (
    <>
      {message.content ? (
        <div className="mb-3 flex items-start gap-2">
          <Avatar />
          <div className="max-w-[80%] rounded-[12px] rounded-tl-[4px] border border-line bg-surface px-3 py-2 text-[14px] leading-[22px] text-ink">
            {message.content}
          </div>
        </div>
      ) : null}

      {payloads.map((p, i) => (
        <SearchResultBlock key={i} payload={p} />
      ))}
    </>
  );
}

function SearchResultBlock({ payload }: { payload: SearchPayload }) {
  const hits = payload.experiments ?? [];
  const excluded = payload.excluded ?? [];
  if (hits.length === 0 && excluded.length === 0) return null;

  return (
    <div className="mb-3 ml-9 space-y-2">
      {hits.map((hit) => (
        <ExperimentCard key={hit.id} hit={hit} />
      ))}

      {excluded.length > 0 ? (
        <div className="rounded-card border border-line bg-mist/60 px-3 py-2">
          <p className="text-[11px] font-medium text-ink-soft">
            有 {payload.excludedCount ?? excluded.length} 门你没报上名
          </p>
          <ul className="mt-1 space-y-0.5">
            {excluded.map((e) => (
              <li key={e.title} className="text-[11px] leading-5 text-ink-soft">
                「{e.title}」—— {e.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/**
 * 一张候选实验卡片（B2-a：内联展开时段）。
 *
 * 为什么不做成「点卡片直接跳走」：用户在这一步还在**比较实验**，
 * 直接跳进某一门的排期页等于替他做了决定。先让他看一眼具体时间，
 * 确认了点时段再跳 —— 跳过去之后那条链路才是「约」。
 */
function ExperimentCard({ hit }: { hit: SearchHit }) {
  const [open, setOpen] = useState(false);
  const slots = hit.matchedSlots.slice(0, 6);

  return (
    <div className="overflow-hidden rounded-card border border-line bg-surface">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-3 py-2.5 text-left active:bg-mist"
      >
        <div className="flex items-start justify-between gap-2">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-medium text-ink">{hit.title}</span>
            <span className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-ink-soft">
              <span className="inline-flex items-center gap-0.5">
                <Timer size={11} strokeWidth={2} />
                {hit.durationMin} 分钟
              </span>
              <span className="inline-flex min-w-0 items-center gap-0.5">
                <MapPin size={11} strokeWidth={2} />
                <span className="truncate">{hit.location}</span>
              </span>
            </span>
          </span>
          <span className="flex shrink-0 flex-col items-end gap-1">
            <RewardTag text={hit.rewardText} />
            <span className="inline-flex items-center gap-0.5 text-[11px] text-moss">
              {open ? "收起" : `${hit.matchedSlotCount || slots.length} 个时段`}
              <ChevronDown
                size={12}
                strokeWidth={2.4}
                className={open ? "rotate-180 transition-transform" : "transition-transform"}
              />
            </span>
          </span>
        </div>
      </button>

      {open ? (
        <div className="border-t border-line">
          {slots.length === 0 ? (
            <p className="px-3 py-2.5 text-[12px] text-ink-soft">
              暂时没有和你条件匹配的空位，可以点进去看看别的时间。
            </p>
          ) : (
            slots.map((s) => (
              <Link
                key={s.id}
                href={`/experiments/${hit.id}/chat?from=assistant&slot=${encodeURIComponent(s.id)}`}
                className="flex items-center justify-between border-b border-line px-3 py-2 last:border-b-0 active:bg-mist"
              >
                <span className="num text-[13px] text-ink">
                  {formatDayCN(new Date(s.startAt))} {formatHM(new Date(s.startAt))}–
                  {formatHM(new Date(s.endAt))}
                </span>
                <span className="num text-[11px] text-ink-soft">剩 {s.remaining} 位</span>
              </Link>
            ))
          )}
          <Link
            href={`/experiments/${hit.id}/chat?from=assistant`}
            className="block border-t border-line bg-moss-tint/50 px-3 py-2 text-center text-[12px] text-moss"
          >
            去这门实验选时间
          </Link>
        </div>
      ) : null}
    </div>
  );
}

function Avatar() {
  return (
    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-moss-tint">
      <Sparkles size={14} className="text-moss" strokeWidth={1.9} />
    </span>
  );
}

function Dot({ delay }: { delay: string }) {
  return (
    <span
      className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-soft/50"
      style={{ animationDelay: delay }}
    />
  );
}
