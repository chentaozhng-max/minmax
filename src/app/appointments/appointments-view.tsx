"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MapPin, ShieldAlert } from "lucide-react";
import { PageHeader, Modal } from "@/components/page-header";
import { TabBar } from "@/components/tab-bar";
import { Countdown } from "@/components/countdown";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/badge";
import { EmptyState } from "@/components/experiment-card";
import { toast } from "@/components/toast";
import { api, postJson } from "@/lib/api-client";
import { appointmentStatusLabel, type AppointmentStatus } from "@/lib/domain";
import { formatDayCN, formatHM } from "@/lib/time";
import { rewardLabel } from "@/lib/reward";
import { cn } from "@/lib/cn";
import type { AppointmentItem } from "@/lib/types";

const TABS = [
  { key: "pending", label: "待确认" },
  { key: "confirmed", label: "已确认" },
  { key: "checkin", label: "待签到" },
  { key: "done", label: "已完成" },
  { key: "cancelled", label: "已取消" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

function tabOf(item: AppointmentItem): TabKey {
  if (item.status === "CHECKED_IN") return "checkin";
  if (item.status === "CONFIRMED") return item.canCheckIn ? "checkin" : "confirmed";
  return item.group;
}

export function AppointmentsView() {
  const [tab, setTab] = useState<TabKey>("pending");
  const [appealTarget, setAppealTarget] = useState<AppointmentItem | null>(null);
  const [appealNote, setAppealNote] = useState("");
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["appointments"],
    queryFn: () => api<AppointmentItem[]>("/api/me/appointments"),
  });

  const act = useMutation({
    mutationFn: ({ id, action, body }: { id: string; action: string; body?: unknown }) =>
      postJson<{ status: string }>(`/api/appointments/${id}/${action}`, body),
    onSuccess: async (_data, variables) => {
      toast(
        variables.action === "confirm-subject"
          ? "已确认，等待主试确认"
          : variables.action === "checkin"
            ? "签到成功"
            : variables.action === "cancel"
              ? "已取消"
              : variables.action === "appeal"
                ? "申诉已提交"
                : "已处理",
      );
      setAppealTarget(null);
      setAppealNote("");
      await queryClient.invalidateQueries({ queryKey: ["appointments"] });
    },
    onError: (error: Error) => toast(error.message, "error"),
  });

  const items = data ?? [];
  const grouped = useMemo(() => {
    const map: Record<TabKey, AppointmentItem[]> = {
      pending: [],
      confirmed: [],
      checkin: [],
      done: [],
      cancelled: [],
    };
    for (const item of items) map[tabOf(item)].push(item);
    return map;
  }, [items]);

  const list = grouped[tab];

  return (
    <main className="shell tabbar-space">
      <PageHeader title="我的预约" back="auto" profile={{ role: "SUBJECT" }} />

      <div className="scroll-x sticky top-12 z-20 flex gap-1 overflow-x-auto border-b border-line bg-paper/95 px-3 py-2 backdrop-blur">
        {TABS.map((t) => {
          const count = grouped[t.key].length;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                "press flex shrink-0 items-center gap-1 rounded-pill px-3 py-1.5 text-[13px]",
                tab === t.key ? "bg-moss text-white" : "bg-surface text-ink-soft border border-line",
              )}
            >
              {t.label}
              {count > 0 ? (
                <span className={cn("num text-[11px]", tab === t.key ? "text-white/80" : "text-ink-soft/70")}>
                  {count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="px-4 pt-3">
        {isLoading ? (
          <div className="space-y-2">
            <div className="skeleton h-28" />
            <div className="skeleton h-28" />
          </div>
        ) : list.length === 0 ? (
          <EmptyState
            title={tab === "pending" ? "没有待确认的预约" : "这一栏是空的"}
            description="去首页看看正在招募的实验，挑一个时段就能约上。"
            action={
              <Link href="/">
                <Button variant="outline" size="md">
                  去逛实验
                </Button>
              </Link>
            }
          />
        ) : (
          <div className="space-y-2">
            {list.map((item) => (
              <AppointmentCard
                key={item.id}
                item={item}
                busy={act.isPending}
                onConfirm={() => act.mutate({ id: item.id, action: "confirm-subject" })}
                onCheckin={() => act.mutate({ id: item.id, action: "checkin" })}
                onCancel={() => act.mutate({ id: item.id, action: "cancel" })}
                onAppeal={() => {
                  setAppealTarget(item);
                  setAppealNote("");
                }}
              />
            ))}
          </div>
        )}
      </div>

      <Modal open={Boolean(appealTarget)} onClose={() => setAppealTarget(null)} title="申诉主试未到场">
        <p className="mb-3 text-[12px] leading-5 text-ink-soft">
          你已签到但主试没有出现。提交后主试需在 48 小时内处理，逾期自动判为成立。
        </p>
        <textarea
          value={appealNote}
          onChange={(e) => setAppealNote(e.target.value)}
          placeholder="简单描述当时的情况，比如等了多久、实验室是否上锁"
          maxLength={200}
          className="h-20 w-full resize-none rounded-[10px] border border-line bg-surface px-3 py-2 text-[14px] outline-none focus:border-moss"
        />
        <Button
          size="lg"
          block
          className="mt-3"
          loading={act.isPending}
          onClick={() => {
            if (appealTarget)
              act.mutate({
                id: appealTarget.id,
                action: "appeal",
                body: { note: appealNote || "主试未到场" },
              });
          }}
        >
          提交申诉
        </Button>
      </Modal>

      <TabBar role="SUBJECT" />
    </main>
  );
}

function AppointmentCard({
  item,
  busy,
  onConfirm,
  onCheckin,
  onCancel,
  onAppeal,
}: {
  item: AppointmentItem;
  busy: boolean;
  onConfirm: () => void;
  onCheckin: () => void;
  onCancel: () => void;
  onAppeal: () => void;
}) {
  const start = new Date(item.slot.startAt);
  const end = new Date(item.slot.endAt);
  const upcoming = start.getTime() > Date.now();

  const tone =
    item.status === "NO_SHOW"
      ? "danger"
      : item.status.startsWith("CANCELLED")
        ? "grey"
        : item.status === "COMPLETED"
          ? "moss"
          : item.status === "CHECKED_IN"
            ? "verify"
            : "clay";

  return (
    <div className="rounded-card border border-line bg-surface p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-semibold text-ink">{item.experiment.title}</h3>
          <p className="mt-0.5 text-[12px] text-ink-soft">
            {item.experiment.researcher.name}
            {item.experiment.researcher.school ? ` · ${item.experiment.researcher.school}` : ""}
          </p>
        </div>
        <StatusPill tone={tone}>{appointmentStatusLabel[item.status as AppointmentStatus]}</StatusPill>
      </div>

      <div className="mt-2.5 flex items-center justify-between rounded-[8px] bg-mist/70 px-2.5 py-2">
        <span className="num text-[13px] font-medium text-ink">
          {formatDayCN(start)} {formatHM(start)}–{formatHM(end)}
        </span>
        {upcoming && (item.status === "CONFIRMED" || item.status === "PENDING_SUBJECT_CONFIRM" || item.status === "AWAITING_RESEARCHER") ? (
          <span className="text-[11px] text-ink-soft">
            还有 <Countdown target={item.slot.startAt} />
          </span>
        ) : null}
      </div>

      <div className="mt-2 flex items-center gap-1 text-[12px] text-ink-soft">
        <MapPin size={12} strokeWidth={1.8} />
        {item.experiment.location}
        <span className="num ml-auto text-clay">{rewardLabel(item.experiment.rewardText)}</span>
      </div>

      {item.appealStatus === "PENDING" ? (
        <p className="mt-2 flex items-center gap-1 rounded-[4px] bg-[#f8efdd] px-2 py-1 text-[11px] text-warn">
          <ShieldAlert size={12} /> 申诉处理中，主试需在 48 小时内回应
        </p>
      ) : null}
      {item.appealStatus === "UPHELD" ? (
        <p className="mt-2 rounded-[4px] bg-moss-tint px-2 py-1 text-[11px] text-moss">申诉成立，主试已被记录</p>
      ) : null}
      {item.appealStatus === "REJECTED" ? (
        <p className="mt-2 rounded-[4px] bg-mist px-2 py-1 text-[11px] text-ink-soft">申诉被驳回</p>
      ) : null}

      {item.status === "CONFIRMED" && item.canCheckIn ? (
        <p className="mt-2 rounded-[4px] bg-moss-tint px-2 py-1 text-[11px] text-moss">
          到现场后点「到场签到」，主试确认即完成
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {item.status === "PENDING_SUBJECT_CONFIRM" ? (
          <Button size="md" loading={busy} onClick={onConfirm}>
            确认这个时段
          </Button>
        ) : null}
        {item.status === "CONFIRMED" && item.canCheckIn ? (
          <Button size="md" loading={busy} onClick={onCheckin}>
            到场签到
          </Button>
        ) : null}
        {item.canAppeal ? (
          <Button size="md" variant="outline" onClick={onAppeal}>
            主试没来？申诉
          </Button>
        ) : null}
        {item.canCancel ? (
          <Button size="md" variant="ghost" onClick={onCancel}>
            取消预约
          </Button>
        ) : null}
        <Link
          href={`/experiments/${item.experiment.id}`}
          className="ml-auto flex items-center text-[12px] text-moss"
        >
          实验详情
        </Link>
      </div>
    </div>
  );
}
