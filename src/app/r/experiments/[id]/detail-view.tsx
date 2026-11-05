"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader, Modal } from "@/components/page-header";
import { TabBar } from "@/components/tab-bar";
import { SlotSchedule, type ScheduleSlot } from "@/components/slot-schedule";
import { Button } from "@/components/ui/button";
import { StatusPill, VerifiedBadge } from "@/components/ui/badge";
import { toast } from "@/components/toast";
import { api, postJson } from "@/lib/api-client";
import { appointmentStatusLabel, experimentStatusLabel, type AppointmentStatus } from "@/lib/domain";
import { formatDayCN, formatHM } from "@/lib/time";
import { cn } from "@/lib/cn";
import { rewardLabel } from "@/lib/reward";

type Detail = {
  id: string;
  title: string;
  description: string;
  location: string;
  durationMin: number;
  rewardText: string;
  type: string;
  mode: string;
  needsQuestionnaire: boolean;
  /** 问卷答卷统计（没建问卷时都是 0） */
  responseTotal: number;
  responseScored: number;
  responsePassed: number;
  openAnytime: boolean;
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

export function ResearcherExperimentDetail({
  experimentId,
  today,
}: {
  experimentId: string;
  /** 上海时区今天，服务端给：课程表要标「今天」这一列 */
  today: string;
}) {
  const [tab, setTab] = useState<Tab>("applicants");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [openSlotId, setOpenSlotId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["r-experiment", experimentId],
    queryFn: () => api<Detail>(`/api/r/experiments/${experimentId}`),
  });

  /** 时段 → 课程表格子：人数用库里的 bookedCount，姓名从报名者里按起止时间对上来 */
  const scheduleSlots = useMemo<ScheduleSlot[]>(() => {
    if (!data) return [];
    return data.slots.map((slot) => ({
      id: slot.id,
      startAt: slot.startAt,
      endAt: slot.endAt,
      capacity: slot.capacity,
      bookedCount: slot.bookedCount,
      names: data.applicants
        .filter(
          (a) =>
            a.slot.startAt === slot.startAt &&
            a.slot.endAt === slot.endAt &&
            !a.status.startsWith("CANCELLED"),
        )
        .map((a) => a.subject.name),
    }));
  }, [data]);

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
  /** 线上实验没有时段、容量、预约，整个页面不该再讲这些词 */
  const online = data.mode === "ONLINE";
  const pending = data.applicants.filter(
    (a) =>
      a.status === "AWAITING_RESEARCHER" ||
      a.status === "PENDING_SUBJECT_CONFIRM" ||
      a.appealStatus === "PENDING",
  ).length;

  // 课程表里点开的那一段：谁约的、还能做什么，都在这个弹窗里
  const openSlot = scheduleSlots.find((s) => s.id === openSlotId) ?? null;
  const openBookings = openSlot
    ? data.applicants.filter(
        (a) =>
          a.slot.startAt === openSlot.startAt &&
          a.slot.endAt === openSlot.endAt &&
          !a.status.startsWith("CANCELLED"),
      )
    : [];

  return (
    <main className="shell tabbar-space">
      <PageHeader
        title={data.title}
        subtitle={
          online
            ? `${experimentStatusLabel[data.status as "PUBLISHED"] ?? data.status} · 线上实验`
            : `${experimentStatusLabel[data.status as "PUBLISHED"] ?? data.status} · 已订 ${booked}/${total}`
        }
        back="auto"
        profile={{ role: "RESEARCHER" }}
        right={
          <>
            <a
              href={`/api/r/experiments/${experimentId}/export`}
              className="rounded-full px-2 py-1 text-[12px] text-moss"
            >
              导出
            </a>
            <Link
              href={`/r/experiments/${experimentId}/edit`}
              className="rounded-full px-2 py-1 text-[12px] text-moss"
            >
              编辑
            </Link>
          </>
        }
      />

      <div className="px-4 pt-3">
        <div className="rounded-card border border-line bg-surface p-3.5">
          <p className="text-[12px] leading-5 text-ink-soft">
            {online ? "线上填写" : data.location} · <span className="num">{data.durationMin} 分钟</span> ·{" "}
            {rewardLabel(data.rewardText)} ·{" "}
            {data.openAnytime ? "随时可填" : `截止 ${data.signupDeadline.slice(0, 10)}`}
          </p>
          {online ? (
            // 线上实验的数字不是「订了几场」，而是「收了多少份、过了几个」
            <>
              <div className="mt-2 grid grid-cols-3 divide-x divide-line rounded-[8px] bg-mist/60 py-2 text-center">
                <Stat label="答卷" value={data.responseTotal} />
                <Stat
                  label="已通过"
                  value={data.responsePassed}
                  tone={data.responsePassed > 0 ? "clay" : "ink"}
                />
                <Stat
                  label="待算分"
                  value={Math.max(0, data.responseTotal - data.responseScored)}
                  tone={data.responseTotal > data.responseScored ? "clay" : "ink"}
                />
              </div>
              <p className="mt-1.5 text-[11px] leading-5 text-ink-soft">
                被试提交问卷即算完成，不占时段。
              </p>
            </>
          ) : (
            <div className="mt-2 grid grid-cols-3 divide-x divide-line rounded-[8px] bg-mist/60 py-2 text-center">
              <Stat label="待处理" value={pending} tone={pending > 0 ? "clay" : "ink"} />
              <Stat label="已订" value={booked} />
              <Stat label="总容量" value={total} />
            </div>
          )}
        </div>

        {data.needsQuestionnaire ? (
          <Link
            href={`/r/experiments/${experimentId}/questionnaire`}
            className="mt-3 block rounded-card border border-moss/25 bg-moss-tint/40 px-3.5 py-3"
          >
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-medium text-ink">问卷与答卷</span>
              <span className="text-[11px] text-moss">管理 →</span>
            </div>
            <p className="mt-1 text-[11px] leading-5 text-ink-soft">
              {online
                ? "看答卷、按分数筛选、给达标者发站内消息"
                : "上传材料生成题目、按分数筛选、给达标者发预约邀请"}
            </p>
          </Link>
        ) : null}

        {/* 线上实验没有报名和时段，这两个 tab 里永远是空的，整块不渲染 */}
        {online ? null : (
          <>
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
                    <StatusPill tone={statusTone(a.status)}>
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
            <SlotSchedule slots={scheduleSlots} today={today} onSelect={setOpenSlotId} />
            <p className="px-1 text-[11px] leading-5 text-ink-soft">
              有人约就转红：一对一写预约者姓名，团体写已约/容量。点格子看这一段都有谁。
            </p>
          </div>
        )}
          </>
        )}

        <div className="mt-6">
          <Button variant="danger" size="lg" block onClick={() => setCancelOpen(true)}>
            取消整场实验
          </Button>
          <p className="mt-1.5 text-center text-[11px] leading-4 text-ink-soft">
            {online
              ? "取消后实验立刻关闭，已提交的问卷仍可在答卷后台查看"
              : "距各时段开始不足 24 小时的预约会记你一次未到场（-2，按累计次数禁发布）"}
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

      {/* 点课程表里的一段：谁约的、现在还能做什么 */}
      <Modal
        open={openSlot !== null}
        onClose={() => setOpenSlotId(null)}
        title={
          openSlot
            ? `${formatDayCN(new Date(openSlot.startAt))} ${formatHM(new Date(openSlot.startAt))}–${formatHM(new Date(openSlot.endAt))}`
            : ""
        }
      >
        {openSlot ? (
          <>
            <div className="flex items-baseline justify-between rounded-[8px] bg-mist px-2.5 py-2">
              <span className="text-[12px] text-ink-soft">
                {openSlot.bookedCount === 0
                  ? "这一段还空着"
                  : openSlot.bookedCount >= openSlot.capacity
                    ? "这一段已经约满"
                    : "这一段还有空位"}
              </span>
              <span className="num text-[14px] font-semibold text-ink">
                {openSlot.bookedCount}/{openSlot.capacity}
              </span>
            </div>

            {openBookings.length === 0 ? (
              <p className="px-1 py-5 text-center text-[12px] text-ink-soft">
                还没人报名这一段。想撤掉它得去「编辑实验」。
              </p>
            ) : (
              <div className="mt-2 space-y-2">
                {openBookings.map((a) => (
                  <div key={a.id} className="rounded-[8px] border border-line px-2.5 py-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[14px] font-medium text-ink">{a.subject.name}</span>
                          <VerifiedBadge verified={a.subject.studentVerified} />
                          {a.subject.lowCredit ? <StatusPill tone="danger">信誉低</StatusPill> : null}
                        </div>
                        <p className="num mt-0.5 text-[11px] leading-4 text-ink-soft">
                          {a.subject.school ?? "未填学校"} · 信誉 {a.subject.creditScore} · 未到场{" "}
                          {a.subject.noShowCount} 次
                        </p>
                      </div>
                      <StatusPill tone={statusTone(a.status)}>
                        {appointmentStatusLabel[a.status as AppointmentStatus] ?? a.status}
                      </StatusPill>
                    </div>

                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {a.canConfirm ? (
                        <Button
                          size="sm"
                          loading={act.isPending}
                          onClick={() => act.mutate({ id: a.id, action: "confirm" })}
                        >
                          确认预约
                        </Button>
                      ) : null}
                      {a.canVerify ? (
                        <Button
                          size="sm"
                          loading={act.isPending}
                          onClick={() => act.mutate({ id: a.id, action: "verify" })}
                        >
                          确认到场
                        </Button>
                      ) : null}
                      {a.canMarkNoShow ? (
                        <Button
                          size="sm"
                          variant="danger"
                          loading={act.isPending}
                          onClick={() => act.mutate({ id: a.id, action: "no-show" })}
                        >
                          标记未到
                        </Button>
                      ) : null}
                      {a.canRelease ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          loading={act.isPending}
                          onClick={() => act.mutate({ id: a.id, action: "release" })}
                        >
                          释放名额
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <Button variant="outline" size="lg" block className="mt-3" onClick={() => setOpenSlotId(null)}>
              关闭
            </Button>
          </>
        ) : null}
      </Modal>

      <TabBar role="RESEARCHER" />
    </main>
  );
}

/** 预约状态 → 徽章配色：报名者列表和时段弹窗共用，免得两处颜色对不上 */
function statusTone(status: string): "moss" | "verify" | "danger" | "grey" | "clay" {
  if (status === "COMPLETED" || status === "CONFIRMED") return "moss";
  if (status === "CHECKED_IN") return "verify";
  if (status === "NO_SHOW") return "danger";
  if (status.startsWith("CANCELLED")) return "grey";
  return "clay";
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
