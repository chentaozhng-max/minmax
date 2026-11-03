"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Bell, CalendarClock, CheckCheck } from "lucide-react";
import { api, postJson } from "@/lib/api-client";
import { formatDateTimeCN } from "@/lib/time";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { useUnreadStore } from "@/lib/unread-store";

type NotificationItem = {
  id: string;
  kind: string;
  level: string | null;
  content: string;
  experimentId: string | null;
  appointmentId: string | null;
  read: boolean;
  createdAt: string;
};

type NotificationList = { unread: number; items: NotificationItem[] };

const LEVEL_LABEL: Record<string, string> = {
  H3: "3 小时前",
  H1: "1 小时前",
  M10: "10 分钟前",
};

/**
 * 通知列表。
 *
 * 提醒的「表面身份」是 Agent：图标用同一个 Sparkles 语汇，
 * 内容由模型生成（见 application/send-reminders.ts），但触发是代码。
 */
export function NotificationsView() {
  const queryClient = useQueryClient();
  const setUnread = useUnreadStore((s) => s.setUnread);

  const { data, isLoading } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api<NotificationList>("/api/me/notifications"),
  });

  const markAll = useMutation({
    mutationFn: () => postJson<{ count: number }>("/api/me/notifications/read"),
    onSuccess: async () => {
      // 同步清掉全局未读数：否则底部红点和本页列表最多有 30 秒不一致，
      // 用户点了「全部已读」却发现红点还在，会以为没生效。
      setUnread(0);
      await queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  const items = data?.items ?? [];
  const unread = data?.unread ?? 0;

  return (
    <div className="px-4 pt-3">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="section-title">提醒</h2>
        {unread > 0 ? (
          <button
            type="button"
            onClick={() => markAll.mutate()}
            disabled={markAll.isPending}
            className="flex items-center gap-1 text-[12px] text-moss disabled:opacity-50"
          >
            <CheckCheck size={13} strokeWidth={2.2} />
            全部已读
          </button>
        ) : null}
      </div>

      {isLoading ? (
        <p className="rounded-card border border-dashed border-line bg-surface/60 px-4 py-5 text-center text-[12px] text-ink-soft">
          加载中…
        </p>
      ) : items.length === 0 ? (
        <div className="rounded-card border border-dashed border-line bg-surface/60 px-4 py-8 text-center">
          <Bell size={22} className="mx-auto mb-2 text-ink-soft/60" strokeWidth={1.6} />
          <p className="text-[13px] text-ink">还没有提醒</p>
          <p className="mt-1 text-[12px] leading-5 text-ink-soft">
            约上实验后，开始前 3 小时、1 小时和 10 分钟，我会在这里提醒你。
          </p>
        </div>
      ) : (
        <div className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
          {items.map((item) => (
            <NotificationRow key={item.id} item={item} />
          ))}
        </div>
      )}

      {items.length > 0 ? (
        <p className="mt-3 text-center text-[11px] leading-5 text-ink-soft">
          提醒在实验开始前 3 小时、1 小时、10 分钟各发一次。
          <br />
          10 分钟那条到来时，就已经可以在「我的预约」签到了。
        </p>
      ) : null}
    </div>
  );
}

function NotificationRow({ item }: { item: NotificationItem }) {
  const href = item.experimentId ? `/experiments/${item.experimentId}` : "/appointments";

  return (
    <Link
      href={href}
      className={cn(
        "block px-3.5 py-3 active:bg-mist",
        !item.read && "bg-moss-tint/30",
      )}
    >
      <div className="flex gap-2.5">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-moss-tint">
          <CalendarClock size={15} className="text-moss" strokeWidth={1.9} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="flex items-center gap-1.5 text-[12px] font-medium text-ink">
              排期助手
              {!item.read ? <span className="h-1.5 w-1.5 rounded-full bg-moss" /> : null}
            </span>
            <span className="shrink-0 text-[10px] text-ink-soft">
              {formatDateTimeCN(new Date(item.createdAt))}
            </span>
          </div>
          <p className="mt-1 text-[13px] leading-5 text-ink">{item.content}</p>
          {item.level ? (
            <span className="mt-1 inline-block text-[10px] text-ink-soft">
              {LEVEL_LABEL[item.level] ?? item.level}
            </span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}

export function NotificationsEmptyAction() {
  return (
    <Link href="/">
      <Button variant="outline" size="md">
        去找实验
      </Button>
    </Link>
  );
}
