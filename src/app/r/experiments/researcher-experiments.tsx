"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { Modal, PageHeader } from "@/components/page-header";
import { TabBar } from "@/components/tab-bar";
import { EmptyState } from "@/components/experiment-card";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/badge";
import { api } from "@/lib/api-client";
import { experimentStatusLabel, type ExperimentStatus } from "@/lib/domain";
import { banUntilText } from "@/domain/experiment-rules";
import { formatDateTimeCN } from "@/lib/time";
import { rewardLabel } from "@/lib/reward";
import { cn } from "@/lib/cn";

type Row = {
  id: string;
  title: string;
  status: string;
  type: string;
  mode: string;
  rewardText: string;
  durationMin: number;
  location: string;
  signupDeadline: string;
  openAnytime: boolean;
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

export function ResearcherExperiments({
  bannedUntil,
  bannedDays,
  initialFilter,
}: {
  bannedUntil: string | null;
  bannedDays: number;
  /** 从「我的」页的统计数字点进来时带的筛选，非法值一律回到「全部」 */
  initialFilter?: string;
}) {
  const [filter, setFilter] = useState(
    FILTERS.some((f) => f.key === initialFilter) ? (initialFilter as string) : "ALL",
  );
  const [banOpen, setBanOpen] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["r-experiments"],
    queryFn: () => api<Row[]>("/api/r/experiments"),
  });

  const bannedDate = bannedUntil ? new Date(bannedUntil) : null;
  const banned = bannedDate !== null;
  const daysLeft = bannedDays;

  const rows = (data ?? []).filter((r) => filter === "ALL" || r.status === filter);

  return (
    <main className="shell tabbar-space">
      <PageHeader
        title="我的实验"
        back="auto"
        profile={{ role: "RESEARCHER" }}
        right={
          <>
            <Link href="/r/schedule" className="px-2 text-[12px] text-moss">
              日程
            </Link>
            {banned ? (
              <Button size="sm" variant="outline" onClick={() => setBanOpen(true)}>
                发布
              </Button>
            ) : (
              <Link href="/r/experiments/new">
                <Button size="sm">发布</Button>
              </Link>
            )}
          </>
        }
      />

      {banned && bannedDate ? (
        <div className="mx-4 mt-3 flex items-start gap-2 rounded-[8px] border border-warn/30 bg-warn/5 px-3 py-2">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warn" />
          <p className="text-[11px] leading-5 text-ink">
            因累计未到场，禁发布至 <span className="num">{banUntilText(bannedDate)}</span>
            {daysLeft > 0 ? `（还有 ${daysLeft} 天）` : ""}。
            <Link href="/r/appeals" className="ml-1 text-moss underline">
              去申诉
            </Link>
          </p>
        </div>
      ) : null}

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
            description="发布第一个实验，开放你能来的时段，被试挑时段报名。"
            action={
              banned ? (
                <Button size="md" onClick={() => setBanOpen(true)}>
                  发布实验
                </Button>
              ) : (
                <Link href="/r/experiments/new">
                  <Button size="md">发布实验</Button>
                </Link>
              )
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
                  {row.mode === "ONLINE" ? "线上" : row.location} ·{" "}
                  <span className="num">{row.durationMin} 分钟</span> · {rewardLabel(row.rewardText)}
                </p>

                {/* 线上实验没有容量，0/0 的进度条只会让人以为「一个都没招到」 */}
                {row.mode === "ONLINE" ? null : (
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
                )}

                <div className="mt-2 flex items-center justify-between text-[11px] text-ink-soft">
                  <span>
                    {row.mode === "ONLINE" ? (
                      <>
                        线上 · {row.openAnytime ? "全时段可填" : `截止 ${formatDateTimeCN(new Date(row.signupDeadline))}`}
                      </>
                    ) : (
                      <>
                        <span className="num">{row.slotCount}</span> 个时段 · 截止{" "}
                        {formatDateTimeCN(new Date(row.signupDeadline))}
                      </>
                    )}
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

      {/* 点「发布」先弹这个，而不是让人填完一整页再被服务端拒绝 */}
      <Modal open={banOpen} onClose={() => setBanOpen(false)} title="暂时不能发布实验">
        <p className="text-[13px] leading-6 text-ink">
          因累计未到场，禁发布至{" "}
          <span className="num font-medium">{bannedDate ? banUntilText(bannedDate) : ""}</span>
          {daysLeft > 0 ? `（还有 ${daysLeft} 天）` : ""}。
        </p>
        <p className="mt-2 rounded-[8px] bg-mist/70 px-3 py-2 text-[12px] leading-5 text-ink-soft">
          禁期到点自动解除。如果这次未到场有争议，可以先申诉，成立后会撤销记录并恢复发布权限。
        </p>
        <div className="mt-4 flex gap-2">
          <Button variant="outline" size="lg" className="flex-1" onClick={() => setBanOpen(false)}>
            知道了
          </Button>
          <Link href="/r/appeals" className="flex-1">
            <Button size="lg" block onClick={() => setBanOpen(false)}>
              去申诉
            </Button>
          </Link>
        </div>
      </Modal>

      <TabBar role="RESEARCHER" />
    </main>
  );
}
