"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader, Modal } from "@/components/page-header";
import { TabBar } from "@/components/tab-bar";
import { Button } from "@/components/ui/button";
import { StatusPill, VerifiedBadge } from "@/components/ui/badge";
import { toast } from "@/components/toast";
import { api, postJson } from "@/lib/api-client";
import { appointmentStatusLabel, experimentStatusLabel, type AppointmentStatus } from "@/lib/domain";
import { formatDayCN, formatHM } from "@/lib/time";
import { cn } from "@/lib/cn";

type Detail = {
  id: string;
  title: string;
  description: string;
  location: string;
  durationMin: number;
  rewardText: string;
  type: string;
  groupSize: number | null;
  requirements: string | null;
  minCreditScore: number;
  needsVerification: boolean;
  signupDeadline: string;
  status: string;
  slots: {
    id: string;
    startAt: string;
    endAt: string;
    capacity: number;
    bookedCount: number;
    remaining: number;
  }[];
  applicants: {
    id: string;
    status: string;
    appealStatus: string | null;
    createdAt: string;
    canConfirm: boolean;
    canVerify: boolean;
    canMarkNoShow: boolean;
    canRelease: boolean;
    canAppealResolve: boolean;
    subject: {
      id: string;
      name: string;
      school: string | null;
      studentId: string | null;
      creditScore: number;
      studentVerified: boolean;
      noShowCount: number;
      lowCredit: boolean;
    };
    slot: { startAt: string; endAt: string; started: boolean };
  }[];
};

type Tab = "applicants" | "slots";

export function ResearcherExperimentDetail({ experimentId }: { experimentId: string }) {
  const [tab, setTab] = useState<Tab>("applicants");
  const [cancelOpen, setCancelOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["r-experiment", experimentId],
    queryFn: () => api<Detail>(`/api/r/experiments/${experimentId}`),
  });

  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) =>
      postJson<{ status: string }>(`/api/appointments/${id}/${action}`),
    onSuccess: async () => {
      toast("已处理");
      await queryClient.invalidateQueries({ queryKey: ["r-experiment", experimentId] });
      await queryClient.invalidateQueries({ queryKey: ["r-experiments"] });
    },
    onError: (err: Error) => toast(err.message, "error"),
  });

  const appeal = useMutation({
    mutationFn: ({ id, result }: { id: string; result: "UPHELD" | "REJECTED" }) =>
      postJson(`/api/appeals/${id}/resolve`, { result }),
    onSuccess: async () => {
      toast("申诉已处理");
      await queryClient.invalidateQueries({ queryKey: ["r-experiment", experimentId] });
      await queryClient.invalidateQueries({ queryKey: ["r-appeals"] });
    },
    onError: (err: Error) => toast(err.message, "error"),
  });

  const cancelExperiment = useMutation({
    mutationFn: () => postJson<{ penalized: number; waived: number }>(`/api/experiments/${experimentId}/cancel`),
    onSuccess: async (res) => {
      setCancelOpen(false);
      toast(
        res.penalized > 0
          ? `已取消。${res.penalized} 条预约距开始不足 24 小时，记你一次未到场`
          : `已取消。${res.waived} 条预约均超过 24 小时，不影响信誉分`,
      );
      await queryClient.invalidateQueries({ queryKey: ["r-experiment", experimentId] });
      await queryClient.invalidateQueries({ queryKey: ["r-experiments"] });
    },
    onError: (err: Error) => toast(err.message, "error"),
  });

  if (isLoading) {
    return (
      <main className="shell">
        <PageHeader title="实验详情" back="/r/experiments" />
        <div className="space-y-2 px-4 pt-3">
          <div className="skeleton h-24" />
          <div className="skeleton h-40" />
        </div>
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="shell">
        <PageHeader title="实验详情" back="/r/experiments" />
        <p className="px-4 pt-10 text-center text-[13px] text-ink-soft">
          {error instanceof Error ? error.message : "加载失败"}
        </p>
      </main>
    );
  }

  const booked = data.slots.reduce((n, s) => n + s.bookedCount, 0);
  const total = data.slots.reduce((n, s) => n + s.capacity, 0);
  const pending = data.applicants.filter(
    (a) =>
      a.status === "AWAITING_RESEARCHER" ||
      a.status === "PENDING_SUBJECT_CONFIRM" ||
      a.appealStatus === "PENDING",
  ).length;

  return (
    <main className="shell tabbar-space">
      <PageHeader
        title={data.title}
        subtitle={`${experimentStatusLabel[data.status as "PUBLISHED"] ?? data.status} · 已订 ${booked}/${total}`}
        back="auto"
        profile={{ role: "RESEARCHER" }}
        right={
          <Link
            href={`/r/experiments/${experimentId}/edit`}
            className="rounded-full px-2 py-1 text-[12px] text-moss"
          >
            编辑
          </Link>
        }
      />

      <div className="px-4 pt-3">
        <div className="rounded-card border border-line bg-surface p-3.5">
          <p className="text-[12px] leading-5 text-ink-soft">
            {data.location} · <span className="num">{data.durationMin} 分钟</span> ·{" "}
            {data.rewardText} · 截止 {data.signupDeadline.slice(0, 10)}
          </p>
          <div className="mt-2 grid grid-cols-3 divide-x divide-line rounded-[8px] bg-mist/60 py-2 text-center">
            <Stat label="待处理" value={pending} tone={pending > 0 ? "clay" : "ink"} />
            <Stat label="已订" value={booked} />
            <Stat label="总容量" value={total} />
          </div>
        </div>

        <div className="mt-3 flex gap-1">
          {(
            [
              { key: "applicants", label: `报名者 ${data.applicants.length}` },
              { key: "slots", label: `时段 ${data.slots.length}` },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                "press flex-1 rounded-pill py-1.5 text-[13px]",
                tab === t.key ? "bg-moss text-white" : "border border-line bg-surface text-ink-soft",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "applicants" ? (
          <div className="mt-3 space-y-2">
            {data.applicants.length === 0 ? (
              <p className="rounded-card border border-dashed border-line bg-surface/60 px-4 py-10 text-center text-[12px] text-ink-soft">
                还没有人报名。被试在详情页选好时段后会出现在这里。
              </p>
            ) : (
              data.applicants.map((a) => (
                <div key={a.id} className="rounded-card border border-line bg-surface p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[15px] font-semibold text-ink">{a.subject.name}</span>
                        <VerifiedBadge verified={a.subject.studentVerified} />
                        {a.subject.lowCredit ? <StatusPill tone="danger">信誉低</StatusPill> : null}
                      </div>
                      <p className="mt-0.5 text-[11px] text-ink-soft">
                        {a.subject.school ?? "未填学校"}
                        {a.subject.studentId ? ` · 学号 ${a.subject.studentId}` : ""}
                      </p>
                      <p className="num mt-0.5 text-[11px] text-ink-soft">
                        信誉 {a.subject.creditScore} · 未到场 {a.subject.noShowCount} 次
                      </p>
                    </div>
                    <StatusPill
                      tone={
                        a.status === "COMPLETED"
                          ? "moss"
                          : a.status === "CONFIRMED"
                            ? "moss"
                            : a.status === "CHECKED_IN"
                              ? "verify"
                              : a.status === "NO_SHOW"
                                ? "danger"
                                : a.status.startsWith("CANCELLED")
                                  ? "grey"
                                  : "clay"
                      }
                    >
                      {appointmentStatusLabel[a.status as AppointmentStatus] ?? a.status}
                    </StatusPill>
                  </div>

                  <p className="num mt-2 rounded-[6px] bg-mist/70 px-2 py-1.5 text-[12px] text-ink">
                    {formatDayCN(new Date(a.slot.startAt))} {formatHM(new Date(a.slot.startAt))}–
                    {formatHM(new Date(a.slot.endAt))}
                  </p>

                  {a.appealStatus === "PENDING" ? (
                    <div className="mt-2 rounded-[6px] border border-warn/25 bg-[#f8efdd] px-2.5 py-1.5">
                      <p className="text-[11px] text-warn">被试申诉「主试未到场」，48 小时内不处理将自动成立</p>
                      <div className="mt-1.5 flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          loading={appeal.isPending}
                          onClick={() => appeal.mutate({ id: a.id, result: "REJECTED" })}
                        >
                          驳回
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          loading={appeal.isPending}
                          onClick={() => appeal.mutate({ id: a.id, result: "UPHELD" })}
                        >
                          认了（扣 2 分）
                        </Button>
                      </div>
                    </div>
                  ) : null}

                  <div className="mt-2.5 flex flex-wrap gap-2">
                    {a.canConfirm ? (
                      <Button
                        size="md"
                        loading={act.isPending}
                        onClick={() => act.mutate({ id: a.id, action: "confirm" })}
                      >
                        确认预约
                      </Button>
                    ) : null}
                    {a.canVerify ? (
                      <Button
                        size="md"
                        loading={act.isPending}
                        onClick={() => act.mutate({ id: a.id, action: "verify" })}
                      >
                        确认到场
                      </Button>
                    ) : null}
                    {a.canMarkNoShow ? (
                      <Button
                        size="md"
                        variant="danger"
                        loading={act.isPending}
                        onClick={() => act.mutate({ id: a.id, action: "no-show" })}
                      >
                        标记未到
                      </Button>
                    ) : null}
                    {a.canRelease ? (
                      <Button
                        size="md"
                        variant="ghost"
                        loading={act.isPending}
                        onClick={() => act.mutate({ id: a.id, action: "release" })}
                      >
                        释放名额
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            {data.slots.map((slot) => {
              const fill = slot.capacity === 0 ? 0 : slot.bookedCount / slot.capacity;
              return (
                <div key={slot.id} className="rounded-card border border-line bg-surface px-3 py-2.5">
                  <div className="flex items-baseline justify-between">
                    <span className="num text-[13px] font-medium text-ink">
                      {formatDayCN(new Date(slot.startAt))} {formatHM(new Date(slot.startAt))}–
                      {formatHM(new Date(slot.endAt))}
                    </span>
                    <span
                      className={cn(
                        "num text-[11px]",
                        slot.remaining === 0 ? "text-danger" : "text-ink-soft",
                      )}
                    >
                      {slot.bookedCount}/{slot.capacity}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-mist">
                    <div
                      className={cn("h-full rounded-full", slot.remaining === 0 ? "bg-clay" : "bg-moss")}
                      style={{ width: `${Math.round(fill * 100)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-6">
          <Button variant="danger" size="lg" block onClick={() => setCancelOpen(true)}>
            取消整场实验
          </Button>
          <p className="mt-1.5 text-center text-[11px] leading-4 text-ink-soft">
            距各时段开始不足 24 小时的预约会记你一次未到场（-2，按累计次数禁发布）
          </p>
        </div>
      </div>

      <Modal open={cancelOpen} onClose={() => setCancelOpen(false)} title="确认取消整场实验？">
        <p className="mb-3 text-[12px] leading-5 text-ink-soft">
          所有有效预约都会被置为「主试已取消」。系统会按每条预约对应的时段开始时间逐条判断：
          距今 ≥ 24 小时的只改状态、不扣分；不足 24 小时的才记你一次未到场。
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="lg" className="flex-1" onClick={() => setCancelOpen(false)}>
            再想想
          </Button>
          <Button
            variant="danger"
            size="lg"
            className="flex-1"
            loading={cancelExperiment.isPending}
            onClick={() => cancelExperiment.mutate()}
          >
            确认取消
          </Button>
        </div>
      </Modal>

      <TabBar role="RESEARCHER" />
    </main>
  );
}

function Stat({
  label,
  value,
  tone = "ink",
}: {
  label: string;
  value: number;
  tone?: "ink" | "clay";
}) {
  return (
    <div>
      <p className={cn("num text-[17px] font-semibold", tone === "clay" ? "text-clay" : "text-ink")}>
        {value}
      </p>
      <p className="mt-0.5 text-[11px] text-ink-soft">{label}</p>
    </div>
  );
}
