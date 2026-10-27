import Link from "next/link";
import type { ThreadItem } from "@/server/dm";
import { VerifiedBadge } from "@/components/ui/badge";
import { formatDateTimeCN } from "@/lib/time";

/** 私信会话列表（被试端与主试端共用） */
export function ThreadList({
  threads,
  hrefBase = "/messages",
  emptyText,
}: {
  threads: ThreadItem[];
  hrefBase?: string;
  emptyText?: string;
}) {
  return (
    <div className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
      {threads.map((thread) => (
        <Link
          key={thread.id}
          href={`${hrefBase}/${thread.id}`}
          className="flex gap-3 px-3.5 py-3 active:bg-mist"
        >
          <span className="relative mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-moss-tint text-[13px] font-semibold text-moss">
            {thread.peer.name.slice(0, 1)}
            {thread.unread > 0 ? (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-clay px-1 text-[10px] font-medium text-white">
                {thread.unread > 9 ? "9+" : thread.unread}
              </span>
            ) : null}
          </span>

          <span className="min-w-0 flex-1">
            <span className="flex items-baseline justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1">
                <span className="truncate text-[14px] font-medium text-ink">{thread.peer.name}</span>
                <VerifiedBadge verified={thread.peer.studentVerified} />
              </span>
              <span className="shrink-0 text-[10px] text-ink-soft">
                {formatDateTimeCN(new Date(thread.updatedAt))}
              </span>
            </span>

            <span className="mt-0.5 block truncate text-[12px] text-ink-soft">
              {thread.lastMessage
                ? `${thread.lastMessage.mine ? "我：" : ""}${thread.lastMessage.content}`
                : (emptyText ?? "还没有消息")}
            </span>

            {thread.experimentTitle ? (
              <span className="mt-1 inline-flex max-w-full items-center gap-1 truncate rounded-[3px] bg-[#F4F5F2] px-1.5 py-0.5 text-[10px] text-ink-soft">
                来自：{thread.experimentTitle}
              </span>
            ) : null}
          </span>
        </Link>
      ))}
    </div>
  );
}
