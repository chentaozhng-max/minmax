"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUp } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { toast } from "@/components/toast";
import { api, postJson } from "@/lib/api-client";
import type { ThreadMessage, ThreadPeer } from "@/server/dm";
import { formatDateTimeCN } from "@/lib/time";

type ThreadData = {
  thread: { id: string; myRole: "SUBJECT" | "RESEARCHER"; peer: ThreadPeer };
  messages: ThreadMessage[];
};

export function DmChat({
  threadId,
  initial,
  role,
}: {
  threadId: string;
  initial: ThreadData;
  role: "SUBJECT" | "RESEARCHER";
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const { data } = useQuery({
    queryKey: ["dm", threadId],
    queryFn: () => api<ThreadData>(`/api/dm/threads/${threadId}`),
    initialData: initial,
    staleTime: 0,
    refetchInterval: 15000,
  });

  const view = data ?? initial;
  const messages = view.messages;
  const peer = view.thread.peer;

  const send = useMutation({
    mutationFn: (content: string) =>
      postJson<ThreadData>(`/api/dm/threads/${threadId}/messages`, { content }),
    onSuccess: (next) => {
      queryClient.setQueryData(["dm", threadId], next);
      queryClient.invalidateQueries({ queryKey: ["dm-threads"] });
      setDraft("");
    },
    onError: (error: Error) => toast(error.message, "error"),
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages.length, send.isPending]);

  function submit() {
    const text = draft.trim();
    if (!text || send.isPending) return;
    send.mutate(text);
  }

  return (
    <main className="mx-auto flex h-[100dvh] w-full max-w-[480px] flex-col bg-paper">
      <PageHeader
        title={peer.name}
        subtitle={`${[peer.school, peer.department].filter(Boolean).join(" · ") || "主试"} · 信誉 ${peer.creditScore}`}
        back={role === "RESEARCHER" ? "/r/messages" : "/messages"}
        right={
          <Link
            href={role === "RESEARCHER" ? "/r/profile" : `/researchers/${peer.id}`}
            className="px-2 text-[12px] text-moss"
          >
            主页
          </Link>
        }
        profile={{ role }}
      />

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {messages.length === 0 ? (
          <div className="mt-6 rounded-card border border-dashed border-line bg-surface/70 px-4 py-6 text-center">
            <p className="text-[13px] text-ink">还没有聊过</p>
            <p className="mt-1 text-[11px] leading-5 text-ink-soft">
              {view.thread.myRole === "SUBJECT"
                ? "问点什么？比如实验具体流程、要不要带电脑、能不能换时间。"
                : "跟被试确认一下时间或注意事项，对方会在这里收到。"}
            </p>
          </div>
        ) : null}

        {messages.map((message, index) => {
          const prev = messages[index - 1];
          const showTime =
            !prev ||
            new Date(message.createdAt).getTime() - new Date(prev.createdAt).getTime() >
              10 * 60 * 1000;

          return (
            <div key={message.id}>
              {showTime ? (
                <p className="my-2 text-center text-[10px] text-ink-soft">
                  {formatDateTimeCN(new Date(message.createdAt))}
                </p>
              ) : null}

              <div className={`mb-2 flex ${message.mine ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[78%] rounded-[12px] px-3 py-2 text-[14px] leading-[22px] ${
                    message.mine
                      ? "rounded-tr-[4px] bg-moss text-white"
                      : "rounded-tl-[4px] border border-line bg-surface text-ink"
                  }`}
                >
                  {message.content}
                </div>
              </div>
            </div>
          );
        })}

        {send.isPending ? (
          <p className="mb-2 text-right text-[11px] text-ink-soft">发送中…</p>
        ) : null}

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
            placeholder="说点什么…"
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
