"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { TabBar } from "@/components/tab-bar";
import { Button } from "@/components/ui/button";
import { StatusPill, VerifiedBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/experiment-card";
import { Countdown } from "@/components/countdown";
import { toast } from "@/components/toast";
import { api, postJson } from "@/lib/api-client";
import { formatDayCN, formatHM } from "@/lib/time";

type Appeal = {
  id: string;
  appealStatus: string | null;
  appealAt: string | null;
  appealNote: string | null;
  appealResolvedAt: string | null;
  autoResolveAt: string | null;
  overdue: boolean;
  subject: {
    id: string;
    name: string;
    school: string | null;
    creditScore: number;
    studentVerified: boolean;
    noShowCount: number;
  };
  experiment: { id: string; title: string };
  slot: { startAt: string; endAt: string };
};

export function AppealsView() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["r-appeals"],
    queryFn: () => api<{ pending: Appeal[]; resolved: Appeal[] }>("/api/r/appeals"),
  });

  const resolve = useMutation({
    mutationFn: ({ id, result }: { id: string; result: "UPHELD" | "REJECTED" }) =>
      postJson(`/api/appeals/${id}/resolve`, { result }),
    onSuccess: async () => {
      toast("已处理");
      await queryClient.invalidateQueries({ queryKey: ["r-appeals"] });
    },
    onError: (error: Error) => toast(error.message, "error"),
  });

  const pending = data?.pending ?? [];
  const resolved = data?.resolved ?? [];

  return (
    <main className="shell tabbar-space">
      <PageHeader title="申诉处理" back="auto" profile={{ role: "RESEARCHER" }} />

      <div className="px-4 pt-3">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="section-title">待处理</h2>
          <span className="num text-[11px] text-ink-soft">{pending.length} 条</span>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            <div className="skeleton h-32" />
          </div>
        ) : pending.length === 0 ? (
          <EmptyState
            title="没有待处理的申诉"
            description="被试签到后如果没等到你，会在这里发起申诉，48 小时内不处理会自动成立。"
          />
        ) : (
          <div className="space-y-2">
            {pending.map((item) => (
              <div key={item.id} className="rounded-card border border-warn/30 bg-surface p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[15px] font-semibold text-ink">{item.subject.name}</span>
                      <VerifiedBadge verified={item.subject.studentVerified} />
                    </div>
                    <p className="mt-0.5 text-[11px] text-ink-soft">
                      {item.subject.school ?? "未填学校"} · <span className="num">信誉 {item.subject.creditScore}</span>
                    </p>
                  </div>
                  <StatusPill tone={item.overdue ? "danger" : "warn"}>
                    {item.overdue ? "已超时" : "待处理"}
                  </StatusPill>
                </div>

                <p className="mt-2 text-[13px] font-medium text-ink">{item.experiment.title}</p>
                <p className="num text-[11px] text-ink-soft">
                  {formatDayCN(new Date(item.slot.startAt))} {formatHM(new Date(item.slot.startAt))}–
                  {formatHM(new Date(item.slot.endAt))}
                </p>

                {item.appealNote ? (
                  <p className="mt-2 rounded-[6px] bg-mist/70 px-2.5 py-2 text-[12px] leading-5 text-ink">
                    「{item.appealNote}」
                  </p>
                ) : null}

                {item.autoResolveAt ? (
                  <p className="mt-2 text-[11px] text-warn">
                    自动成立倒计时 <Countdown target={item.autoResolveAt} />
                  </p>
                ) : null}

                <div className="mt-2.5 flex gap-2">
                  <Button
                    size="md"
                    variant="outline"
                    loading={resolve.isPending}
                    onClick={() => resolve.mutate({ id: item.id, result: "REJECTED" })}
                  >
                    驳回申诉
                  </Button>
                  <Button
                    size="md"
                    variant="danger"
                    loading={resolve.isPending}
                    onClick={() => resolve.mutate({ id: item.id, result: "UPHELD" })}
                  >
                    承认（扣 2 分）
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {resolved.length > 0 ? (
          <section className="mt-6">
            <h2 className="section-title mb-2">已处理</h2>
            <div className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
              {resolved.map((item) => (
                <div key={item.id} className="flex items-center gap-3 px-3.5 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] text-ink">
                      {item.subject.name} · {item.experiment.title}
                    </p>
                    <p className="num truncate text-[11px] text-ink-soft">
                      {formatDayCN(new Date(item.slot.startAt))} {formatHM(new Date(item.slot.startAt))}
                    </p>
                  </div>
                  <StatusPill tone={item.appealStatus === "UPHELD" ? "danger" : "grey"}>
                    {item.appealStatus === "UPHELD" ? "成立" : "驳回"}
                  </StatusPill>
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </div>

      <TabBar role="RESEARCHER" />
    </main>
  );
}
