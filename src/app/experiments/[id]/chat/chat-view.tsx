"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowUp, CalendarPlus, Check, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { SlotGrid } from "@/components/slot-grid";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/toast";
import { api, postJson } from "@/lib/api-client";
import type { ChatMessageView, ChatView as ChatViewData, SlotView } from "@/lib/types";

type ExperimentBrief = {
  title: string;
  durationMin: number;
  location: string;
  rewardText: string;
  researcherName: string;
};

type ToolResult =
  | { ok?: boolean; slots?: SlotView[]; reason?: string; error?: string; label?: string }
  | undefined;

export function ChatView({
  experimentId,
  initial,
  experiment,
}: {
  experimentId: string;
  initial: ChatViewData;
  experiment: ExperimentBrief;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const { data } = useQuery({
    queryKey: ["chat", experimentId],
    queryFn: () => api<ChatViewData>(`/api/chat/${experimentId}`),
    initialData: initial,
    staleTime: 0,
  });

  const view = data ?? initial;
  const messages = view.messages;

  const send = useMutation({
    mutationFn: (content: string) => postJson<ChatViewData>(`/api/chat/${experimentId}/message`, { content }),
    onSuccess: (next) => {
      queryClient.setQueryData(["chat", experimentId], next);
      setDraft("");
    },
    onError: (error: Error) => toast(error.message, "error"),
  });

  const book = useMutation({
    mutationFn: (slotId: string) => postJson<{ id: string }>("/api/appointments", { slotId }),
    onSuccess: async () => {
      toast("已锁定，等待主试确认");
      await queryClient.invalidateQueries({ queryKey: ["chat", experimentId] });
      await queryClient.invalidateQueries({ queryKey: ["appointments"] });
    },
    onError: (error: Error) => toast(error.message, "error"),
  });

  const bookMany = useMutation({
    mutationFn: async (slotIds: string[]) => {
      let lastError: Error | null = null;
      for (const slotId of slotIds) {
        try {
          return await postJson<{ id: string }>("/api/appointments", { slotId });
        } catch (error) {
          lastError = error instanceof Error ? error : new Error("预约失败");
        }
      }
      throw lastError ?? new Error("预约失败");
    },
    onSuccess: async () => {
      setPicked([]);
      toast("已锁定，等待主试确认");
      await queryClient.invalidateQueries({ queryKey: ["chat", experimentId] });
      await queryClient.invalidateQueries({ queryKey: ["appointments"] });
    },
    onError: (error: Error) => toast(error.message, "error"),
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages.length, view.mode, send.isPending]);

  const blocked = view.blocked;
  // 只有接口真的降级（LLM 不可用 / 超时 / 聊满 12 轮）才显示表单。
  // Agent 正常提出候选时 state 也是 PROPOSED，但那是对话流，不能切成表单。
  const formMode = view.mode === "form";

  function submitText() {
    const text = draft.trim();
    if (!text) return;
    send.mutate(text);
  }

  return (
    <main className="mx-auto flex h-[100dvh] w-full max-w-[480px] flex-col bg-paper">
      <PageHeader
        title="排期助手"
        subtitle={`${experiment.researcherName} · ${experiment.title}`}
        back={`/experiments/${experimentId}`}
        profile={{ role: "SUBJECT" }}
        right={
          <Link href="/appointments" className="px-2 text-[12px] text-moss">
            我的预约
          </Link>
        }
      />

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {messages.length === 0 ? (
          <>
            <AgentBubble>
              这个实验要 {experiment.durationMin} 分钟，地点在{experiment.location}。你未来 7
              天哪些时段方便？说得模糊一点也行，比如「周三下午」。
            </AgentBubble>
            <div className="mb-3 ml-9 flex flex-wrap gap-1.5">
              {["周三下午", "明天上午", "这周都行", "你帮我挑"].map((text) => (
                <button
                  key={text}
                  type="button"
                  disabled={send.isPending}
                  onClick={() => send.mutate(text)}
                  className="press rounded-pill border border-line bg-surface px-2.5 py-1 text-[12px] text-ink-soft active:bg-mist"
                >
                  {text}
                </button>
              ))}
            </div>
          </>
        ) : null}

        {messages.map((message, index) => (
          <MessageBlock
            key={`${message.createdAt}-${index}`}
            message={message}
            onPick={(slotId) => book.mutate(slotId)}
            picking={book.isPending}
            interactive={index === messages.length - 1 || isLastProposal(messages, index)}
          />
        ))}

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

        {view.notice ? (
          <p className="my-3 text-center text-[11px] text-warn">{view.notice}</p>
        ) : null}

        {blocked ? (
          <div className="my-3 rounded-card border border-danger/20 bg-[#f9e9e6] px-3 py-2.5 text-[12px] leading-5 text-danger">
            {blocked.message}
            {blocked.reason === "VERIFY" ? (
              <Link href="/me/verify" className="ml-1 underline">
                去认证
              </Link>
            ) : null}
          </div>
        ) : null}

        {formMode && !blocked ? (
          <div className="mt-4 rounded-card border border-line bg-surface p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[13px] font-medium text-ink">直接选时段</p>
              <span className="text-[11px] text-ink-soft">可多选</span>
            </div>
            <SlotGrid
              slots={view.availableSlots}
              value={picked}
              onChange={setPicked}
              multi
              emptyHint="目前没有空位，可以给主试留言说明你的时间"
            />
          </div>
        ) : null}

        <div ref={bottomRef} className="h-2" />
      </div>

      {blocked ? (
        <div className="border-t border-line bg-surface px-4 py-3 pb-[calc(12px+env(safe-area-inset-bottom))]">
          <Button size="lg" block disabled>
            暂不可预约
          </Button>
        </div>
      ) : formMode ? (
        <div className="border-t border-line bg-surface px-4 py-3 pb-[calc(12px+env(safe-area-inset-bottom))]">
          <Button
            size="lg"
            block
            disabled={picked.length === 0}
            loading={bookMany.isPending}
            onClick={() => bookMany.mutate(picked)}
          >
            {picked.length > 0 ? `确定这 ${picked.length} 个时段` : "先选一个时段"}
          </Button>
        </div>
      ) : (
        <div className="border-t border-line bg-surface px-3 py-2 pb-[calc(8px+env(safe-area-inset-bottom))]">
          <div className="flex items-end gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) submitText();
              }}
              placeholder="比如：周三下午有空"
              maxLength={500}
              className="h-11 flex-1 rounded-pill bg-[#F5F6F7] px-4 text-[14px] outline-none focus:bg-surface focus:ring-1 focus:ring-moss/40"
            />
            <button
              type="button"
              onClick={submitText}
              disabled={!draft.trim() || send.isPending}
              aria-label="发送"
              className="press mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-moss text-white disabled:opacity-40"
            >
              <ArrowUp size={19} strokeWidth={2.4} />
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

function isLastProposal(messages: ChatMessageView[], index: number) {
  for (let i = messages.length - 1; i > index; i -= 1) {
    if (messages[i].toolCalls?.some((c) => c.name === "propose_slots")) return false;
  }
  return true;
}

function MessageBlock({
  message,
  onPick,
  picking,
  interactive,
}: {
  message: ChatMessageView;
  onPick: (slotId: string) => void;
  picking: boolean;
  interactive: boolean;
}) {
  if (message.role === "user") return <UserBubble>{message.content}</UserBubble>;
  if (message.role !== "assistant") return null;

  const calls = message.toolCalls ?? [];
  const proposals = calls
    .filter((c) => c.name === "propose_slots")
    .map((c) => c.result as ToolResult)
    .filter((r): r is { slots: SlotView[]; reason?: string } => Boolean(r?.slots?.length));
  const booked = calls
    .map((c) => c.result as ToolResult)
    .find((r) => r && "label" in r && r.ok);

  return (
    <>
      {message.content ? <AgentBubble>{message.content}</AgentBubble> : null}

      {proposals.map((proposal, i) => (
        <div key={i} className="mb-3 ml-9">
          {proposal.reason ? (
            <p className="mb-1.5 text-[11px] text-ink-soft">{proposal.reason}</p>
          ) : null}
          <div className="overflow-hidden rounded-card border border-line bg-surface">
            {proposal.slots.map((slot) => (
              <button
                key={slot.id}
                type="button"
                disabled={!interactive || picking}
                onClick={() => onPick(slot.id)}
                className="flex w-full items-center justify-between border-b border-line px-3 py-2.5 text-left last:border-b-0 active:bg-mist disabled:opacity-60"
              >
                <span>
                  <span className="num block text-[14px] font-medium text-ink">{slot.label}</span>
                  <span className="num text-[11px] text-ink-soft">
                    剩 {slot.remaining}/{slot.capacity}
                  </span>
                </span>
                <span className="flex items-center gap-1 text-[12px] text-moss">
                  <Check size={13} strokeWidth={2.4} />
                  就这个
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}

      {booked?.label ? (
        <div className="mb-3 ml-9 flex items-center gap-2 rounded-[10px] border border-moss/25 bg-moss-tint px-3 py-2 text-[12px] text-moss">
          <CalendarPlus size={14} strokeWidth={2} />
          已锁定 {booked.label}
        </div>
      ) : null}
    </>
  );
}

function AgentBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-start gap-2">
      <Avatar />
      <div className="max-w-[80%] rounded-[12px] rounded-tl-[4px] border border-line bg-surface px-3 py-2 text-[14px] leading-[22px] text-ink">
        {children}
      </div>
    </div>
  );
}

function UserBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-3 flex justify-end">
      <div className="max-w-[80%] rounded-[12px] rounded-tr-[4px] bg-moss px-3 py-2 text-[14px] leading-[22px] text-white">
        {children}
      </div>
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

export function BackHint() {
  return (
    <span className="inline-flex items-center gap-1">
      <ArrowLeft size={12} />
    </span>
  );
}
