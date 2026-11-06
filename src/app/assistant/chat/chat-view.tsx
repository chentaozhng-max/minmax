"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUp, AlertTriangle, CalendarClock, ChevronDown, ChevronRight, House, MapPin, Monitor, Sparkles, Timer } from "lucide-react";
import { cn } from "@/lib/cn";
import { PageHeader } from "@/components/page-header";
import { TabBar } from "@/components/tab-bar";
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
  /** 这一轮被范围闸拦了（没进主模型）。拒答也是一条 assistant 消息，光看 messages 分不出来 */
  blocked: boolean;
  /** `repeat` = 本会话里第二次越界，这时才给「开个新对话」的出口 */
  strikeLevel: "first" | "repeat";
};

/** search_experiments 的返回（只取渲染需要的字段） */
type SearchHit = {
  id: string;
  title: string;
  location: string;
  mode: "ONLINE" | "OFFLINE";
  scheduleMode: "ANYTIME" | "WINDOW" | "SCHEDULED";
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

/**
 * 点「新对话」后本地先显示的开场白。
 *
 * 与服务端的 `ASSISTANT_OPENING` 同义 —— 但那份在 server 模块里，
 * 客户端组件不能 import（会把 prisma 拖进 bundle）。两句话不一样也无所谓：
 * 这句只在「还没发出去」的瞬间存在，发出去之后服务端返回的整份 messages 会覆盖它。
 */
const FRESH_OPENING = "好，我们重新开始。你想参加什么实验？";

export function AssistantChatView({
  initial,
  scheduleSummary,
}: {
  initial: ChatResult;
  /** 门厅顶部那条安排摘要。都为 0 时不显示 */
  scheduleSummary: { headline: string; overlapCount: number; upcomingCount: number };
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  /**
   * 用户点了「新对话」，但还没说第一句。
   *
   * 不在点击时就请求服务端：服务端开 session 必须带一条用户消息（`create` 之后
   * 立刻要 save），凭空造一条假的会让历史里多出一条用户没说过的话。
   * 所以点击只切本地视图，真正的新建发生在下一句发送时（带 `newSession: true`）。
   * 副作用是「点了新对话但没说话就关掉浏览器」= 什么都没发生，这正好是想要的。
   */
  const [fresh, setFresh] = useState(false);
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
    mutationFn: (input: { text: string; newSession?: boolean }) =>
      postJson<ChatResult>("/api/assistant/chat", {
        content: input.text,
        // 带上服务端给的 sessionId：不带就只能靠 30 分钟时间窗猜，
        // 用户在两个窗口/两次访问之间切换时会接错会话。
        sessionId: input.newSession ? undefined : view.sessionId || undefined,
        newSession: input.newSession,
      }),
    onSuccess: (next) => {
      queryClient.setQueryData(["assistant-chat"], next);
      setDraft("");
      setFresh(false);
    },
    onError: (error: Error) => toast(error.message, "error"),
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [view.messages.length, send.isPending]);

  function submit() {
    const text = draft.trim();
    if (!text) return;
    send.mutate({ text, newSession: fresh || undefined });
  }

  function startFresh() {
    // 只切本地视图。真正的 create 发生在下一句（见 `fresh` 的注释）。
    setFresh(true);
    setDraft("");
    queryClient.setQueryData<ChatResult>(["assistant-chat"], {
      ...view,
      messages: [],
      blocked: false,
      strikeLevel: "first",
    });
  }

  return (
    <main className="mx-auto flex h-[100dvh] w-full max-w-[480px] flex-col bg-paper">
      <PageHeader
        title="实验助手"
        subtitle={
          view.bookedCount > 0 ? `已约 ${view.bookedCount} 场，还想参加什么？` : "我帮你找合适的实验"
        }
        right={
          <>
            {/*
              通往「我的安排」的常驻入口。
              这里踩过两次同样的坑：入口只要带条件渲染，用户就会在另一种状态下
              彻底找不到路（第一次是「有安排就不给入口」，第二次是把摘要条挂在
              `upcomingCount > 0` 上 —— 没安排的人整个入口消失，有安排的人也因为
              摘要条被折叠而看不到）。所以这颗图标**无条件渲染**，房子比文字更省
              位置，右上角带一个数字表示有几场。
            */}
            <Link
              href="/assistant"
              aria-label="我的安排"
              className="press relative rounded-pill border border-line bg-surface px-2 py-1 text-ink-soft active:bg-mist"
            >
              <House size={15} strokeWidth={2} />
              {scheduleSummary.upcomingCount > 0 ? (
                <span
                  className="num absolute -right-1 -top-1 flex h-[14px] min-w-[14px] items-center justify-center rounded-full bg-moss px-1 text-[9px] font-semibold leading-none text-white"
                  aria-hidden
                >
                  {scheduleSummary.upcomingCount > 9 ? "9+" : scheduleSummary.upcomingCount}
                </span>
              ) : null}
            </Link>
            {/* 已经在新对话里（fresh 且没说过话）就不显示：那时候点了也没事发生。 */}
            {fresh && view.messages.length === 0 ? null : (
              <button
                type="button"
                onClick={startFresh}
                disabled={send.isPending}
                className="press rounded-pill border border-line bg-surface px-2.5 py-1 text-[12px] text-ink-soft active:bg-mist disabled:opacity-40"
              >
                新对话
              </button>
            )}
          </>
        }
        profile={{ role: "SUBJECT" }}
      />

      {/* 我的安排摘要 —— 门厅是 tab 根页，不再有「上一页」，所以把原先
          /assistant 总览页上「最该说的一句话」搬到这里，压成一条可点的横条。
          没有任何安排时不显示：那时候标题里的引导语已经说清了，多一条反而是噪音。 */}
      {scheduleSummary.upcomingCount > 0 || scheduleSummary.overlapCount > 0 ? (
        <div className="px-4 pb-1 pt-2">
          <Link href="/assistant" className="block">
            <div
              className={cn(
                "flex items-center gap-2.5 rounded-card border px-3 py-2.5 active:opacity-80",
                scheduleSummary.overlapCount > 0
                  ? "border-warn/30 bg-warn/[0.06]"
                  : "border-line bg-surface",
              )}
            >
              <span
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
                  scheduleSummary.overlapCount > 0
                    ? "bg-warn/15 text-warn"
                    : "bg-moss-tint text-moss",
                )}
              >
                {scheduleSummary.overlapCount > 0 ? (
                  <AlertTriangle size={13} strokeWidth={2.3} />
                ) : (
                  <CalendarClock size={13} strokeWidth={2.2} />
                )}
              </span>
              <p className="min-w-0 flex-1 truncate text-[12px] leading-5 text-ink">
                {scheduleSummary.headline}
              </p>
              <ChevronRight size={14} className="shrink-0 text-ink-soft/60" strokeWidth={2.2} />
            </div>
          </Link>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {fresh && view.messages.length === 0 ? (
          <div className="mb-3 flex items-start gap-2">
            <Avatar />
            <div className="max-w-[80%] rounded-[12px] rounded-tl-[4px] border border-line bg-surface px-3 py-2 text-[14px] leading-[22px] text-ink">
              {FRESH_OPENING}
            </div>
          </div>
        ) : null}
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
                onClick={() => send.mutate({ text, newSession: fresh || undefined })}
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

        {/* 连续第二次越界才给这个出口。
            第一次越界只留一句软话术 —— 用户可能只是随口一问，弹组件反而像赶人。
            第二次就是明显在试探了，这时候"换个话题重开"才是有用的建议。 */}
        {view.blocked && view.strikeLevel === "repeat" ? (
          <div className="mb-3 rounded-card border border-line bg-mist/60 p-3">
            <p className="text-[12px] font-medium text-ink">要不我们换个话题重新开始？</p>
            <p className="mt-1 text-[11px] leading-5 text-ink-soft">
              开个新对话就能接着找实验。你已经约好的都在「我的预约」里，不会丢。
            </p>
            <button
              type="button"
              onClick={startFresh}
              className="press mt-2 rounded-pill bg-moss px-3 py-1.5 text-[12px] text-white active:opacity-90"
            >
              开个新对话
            </button>
          </div>
        ) : null}

        <div ref={bottomRef} className="h-2" />
      </div>

      {/* 输入区。
          门厅现在是 tab 根页，底部有 TabBar（fixed 定位、不占流内空间），
          所以这里要自己让出 56px，否则输入框会被 TabBar 压住 ——
          这个坑之前踩过一次（`fixed bottom-0 z-40` 盖住输入框）。 */}
      <div className="border-t border-line bg-surface px-3 py-2 pb-[calc(8px+56px+env(safe-area-inset-bottom))]">
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

      <TabBar role="SUBJECT" />
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
  /**
   * 线上且不是固定场次 → 没有「时段」这个概念，点进去就能做。
   *
   * 以前这里一律写「N 个时段」，线上实验永远是「0 个时段」，
   * 看起来像主试还没排期，被试根本不会点（用户就是这么被劝退的）。
   */
  const anytime = hit.mode === "ONLINE" && hit.scheduleMode !== "SCHEDULED";

  const head = (
    <div className="flex items-start justify-between gap-2">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-medium text-ink">{hit.title}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-ink-soft">
          <span className="inline-flex items-center gap-0.5">
            <Timer size={11} strokeWidth={2} />
            {hit.durationMin} 分钟
          </span>
          {anytime ? (
            <span className="inline-flex items-center gap-0.5">
              <Monitor size={11} strokeWidth={2} />
              线上
            </span>
          ) : (
            <span className="inline-flex min-w-0 items-center gap-0.5">
              <MapPin size={11} strokeWidth={2} />
              <span className="truncate">{hit.location}</span>
            </span>
          )}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <RewardTag text={hit.rewardText} />
        <span className="inline-flex items-center gap-0.5 text-[11px] text-moss">
          {anytime
            ? hit.scheduleMode === "WINDOW"
              ? "每天可填"
              : "随时可填"
            : open
              ? "收起"
              : `${hit.matchedSlotCount || slots.length} 个时段`}
          {anytime ? null : (
            <ChevronDown
              size={12}
              strokeWidth={2.4}
              className={open ? "rotate-180 transition-transform" : "transition-transform"}
            />
          )}
        </span>
      </span>
    </div>
  );

  // 线上「点进去就能做」：一票直达详情页，不再让人先展开一个空列表
  if (anytime) {
    return (
      <Link
        href={`/experiments/${hit.id}`}
        className="block rounded-card border border-line bg-surface px-3 py-2.5 active:bg-mist"
      >
        {head}
      </Link>
    );
  }

  return (
    <div className="overflow-hidden rounded-card border border-line bg-surface">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-3 py-2.5 text-left active:bg-mist"
      >
        {head}
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
