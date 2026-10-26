import Link from "next/link";
import { MapPin, Clock3 } from "lucide-react";
import { VerifiedBadge, StatusPill } from "@/components/ui/badge";
import { formatDateTimeCN, formatHM } from "@/lib/time";
import type { CardView } from "@/server/experiments";

/**
 * 实验卡片。
 * 结构：左侧一条 3px 的"刻度条"标记下一个可约时段是否在 48 小时内，
 * 这是实验室场景的语言（时间块），也替代了常见的彩色渐变头图。
 */
export function ExperimentCard({ card }: { card: CardView }) {
  const next = card.nextSlotAt ? new Date(card.nextSlotAt) : null;
  const soon = next ? next.getTime() - Date.now() < 48 * 60 * 60 * 1000 : false;

  return (
    <Link
      href={`/experiments/${card.id}`}
      className="press relative block overflow-hidden rounded-card border border-line bg-surface"
    >
      <span
        className={`absolute left-0 top-0 h-full w-[3px] ${soon ? "bg-clay" : "bg-moss/30"}`}
        aria-hidden
      />
      <div className="pl-[19px] pr-4 py-3.5">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-[15px] font-semibold leading-[22px] text-ink">{card.title}</h3>
          {card.lowCreditResearcher ? (
            <StatusPill tone="grey">主试信誉较低</StatusPill>
          ) : (
            <span className="num shrink-0 pt-0.5 text-[15px] font-semibold text-clay">
              {card.rewardText}
            </span>
          )}
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px] text-ink-soft">
          <span className="text-ink">{card.researcher.name}</span>
          <VerifiedBadge verified={card.researcher.studentVerified} />
          <span className="text-line">|</span>
          <span>{card.researcher.school ?? "未填写学校"}</span>
          <span className="num text-ink-soft">信誉 {card.researcher.creditScore}</span>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-soft">
          <span className="inline-flex items-center gap-1">
            <MapPin size={12} strokeWidth={1.8} />
            {card.location}
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock3 size={12} strokeWidth={1.8} />
            <span className="num">{card.durationMin} 分钟</span>
          </span>
        </div>

        <div className="mt-2.5 flex items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {next ? (
              <span className="chip bg-mist text-ink-soft">
                最近 <span className="num">{formatDateTimeCN(next)}</span>
              </span>
            ) : null}
            {card.type === "GROUP" ? (
              <span className="chip bg-mist text-ink-soft">团体 {card.groupSize ?? 2} 人</span>
            ) : null}
            {card.minCreditScore > 0 ? (
              <span className="chip bg-[#f8efdd] text-warn">信誉 ≥ {card.minCreditScore}</span>
            ) : null}
          </div>
          {card.remainingSeats > 0 ? (
            <span className="num shrink-0 text-[12px] font-medium text-moss">
              剩 {card.remainingSeats} 位
            </span>
          ) : (
            <span className="shrink-0 text-[12px] text-ink-soft">已约满</span>
          )}
        </div>

        {!card.eligibility.ok ? (
          <p className="mt-2 rounded-[4px] bg-[#f9e9e6] px-2 py-1 text-[11px] text-danger">
            {card.eligibility.message}
          </p>
        ) : null}
      </div>
    </Link>
  );
}

export function ExperimentCardSkeleton() {
  return (
    <div className="rounded-card border border-line bg-surface p-4">
      <div className="skeleton h-4 w-2/3" />
      <div className="skeleton mt-2.5 h-3 w-1/2" />
      <div className="skeleton mt-2 h-3 w-2/5" />
      <div className="mt-3 flex gap-2">
        <div className="skeleton h-5 w-20" />
        <div className="skeleton h-5 w-14" />
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-card border border-dashed border-line bg-surface/60 px-6 py-12 text-center">
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-mist">
        <Clock3 size={20} className="text-ink-soft" strokeWidth={1.6} />
      </div>
      <p className="text-[15px] font-medium text-ink">{title}</p>
      <p className="mt-1 max-w-[240px] text-[12px] leading-5 text-ink-soft">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
