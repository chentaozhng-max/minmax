"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { TabBar } from "@/components/tab-bar";
import { EmptyState } from "@/components/experiment-card";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/badge";
import { api } from "@/lib/api-client";
import { experimentStatusLabel, type ExperimentStatus } from "@/lib/domain";
import { formatDateTimeCN } from "@/lib/time";
import { cn } from "@/lib/cn";

type Row = {
  id: string;
  title: string;
  status: string;
  type: string;
  rewardText: string;
  durationMin: number;
  location: string;
  signupDeadline: string;
  slotCount: number;
  bookedCount: number;
  capacityTotal: number;
  pendingCount: number;
};

const FILTERS = [
  { key: "ALL", label: "全部" },
  { key: "PUBLISHED", label: "招募中" },
  { key: "DRAFT", label: "草稿" },
  { key: "CLOSED", label: "已关闭" },
];

export function ResearcherExperiments() {
  const [filter, setFilter] = useState("ALL");
  const { data, isLoading } = useQuery({
    queryKey: ["r-experiments"],
    queryFn: () => api<Row[]>("/api/r/experiments"),
  });

  const rows = (data ?? []).filter((r) => filter === "ALL" || r.status === filter);

  return (
    <main className="shell tabbar-space">
      <PageHeader
        title="我的实验"
        back="auto"
        profile={{ role: "RESEARCHER" }}
        right={
          <Link href="/r/experiments/new">
            <Button size="sm">发布</Button>
          </Link>
        }
      />

      <div className="scroll-x sticky top-12 z-20 flex gap-1 overflow-x-auto border-b border-line bg-paper/95 px-3 py-2 backdrop-blur">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={cn(
              "press shrink-0 rounded-pill px-3 py-1.5 text-[13px]",
              filter === f.key ? "bg-moss text-white" : "border border-line bg-surface text-ink-soft",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="px-4 pt-3">
        {isLoading ? (
          <div className="space-y-2">
            <div className="skeleton h-24" />
            <div className="skeleton h-24" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title="还没有实验"
            description="发布第一个实验，设定好你能来的时段，剩下的撮合交给排期助手。"
            action={
              <Link href="/r/experiments/new">
                <Button size="md">发布实验</Button>
              </Link>
            }
          />
        ) : (
          <div className="space-y-2">
            {rows.map((row) => (
              <Link
                key={row.id}
                href={`/r/experiments/${row.id}`}
                className="press block rounded-card border border-line bg-surface p-3.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-[15px] font-semibold text-ink">{row.title}</h3>
                  <StatusPill
                    tone={
                      row.status === "PUBLISHED" ? "moss" : row.status === "DRAFT" ? "grey" : "warn"
                    }
                  >
                    {experimentStatusLabel[row.status as ExperimentStatus] ?? row.status}
                  </StatusPill>
                </div>
                <p className="mt-1 text-[12px] text-ink-soft">
                  {row.location} · <span className="num">{row.durationMin} 分钟</span> ·{" "}
                  {row.rewardText}
                </p>

                <div className="mt-2.5 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-mist">
                    <div
                      className="h-full rounded-full bg-moss"
                      style={{
                        width: `${row.capacityTotal === 0 ? 0 : Math.round((row.bookedCount / row.capacityTotal) * 100)}%`,
                      }}
                    />
                  </div>
                  <span className="num shrink-0 text-[11px] text-ink-soft">
                    {row.bookedCount}/{row.capacityTotal}
                  </span>
                </div>

                <div className="mt-2 flex items-center justify-between text-[11px] text-ink-soft">
                  <span>
                    <span className="num">{row.slotCount}</span> 个时段 · 截止{" "}
                    {formatDateTimeCN(new Date(row.signupDeadline))}
                  </span>
                  {row.pendingCount > 0 ? (
                    <span className="num text-clay">{row.pendingCount} 条待处理</span>
                  ) : null}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      <TabBar role="RESEARCHER" />
    </main>
  );
}
