import Link from "next/link";
import { Bot, MapPin, Monitor, Clock3 } from "lucide-react";
import { VerifiedBadge } from "@/components/ui/badge";
import { RewardTag } from "@/components/reward-tag";
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
    <div className="press relative overflow-hidden rounded-card border border-line bg-surface">
      {/* 整卡可点：Link 用绝对定位铺满，AI 入口按钮靠 z-index 压在它上面。
          不能把按钮套在 <Link> 里 —— <a> 里嵌 <a> 是非法的，浏览器会把 DOM 拆开。

          注意：Link 之后的兄弟节点必须 `pointer-events-none`。
          定位元素按 DOM 顺序绘制，内容层在 Link 之上，会把点击全部吃掉 ——
          表现就是「整卡点了没反应」，只有卡片边缘能点（真踩过）。 */}
      <Link href={`/experiments/${card.id}`} className="absolute inset-0" aria-label={card.title} />

      <span
        className={`pointer-events-none absolute left-0 top-0 h-full w-[3px] ${soon ? "bg-clay" : "bg-moss/30"}`}
        aria-hidden
      />
      <div className="pointer-events-none relative pl-[19px] pr-4 py-3.5">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-[15px] font-semibold leading-[22px] text-ink">{card.title}</h3>
          <RewardTag text={card.rewardText} className="mt-0.5" />
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px] text-ink-soft">
          <span className="text-ink">{card.researcher.name}</span>
          <VerifiedBadge verified={card.researcher.studentVerified} />
          <span className="text-line">|</span>
          <span>{card.researcher.school ?? "未填写学校"}</span>
          <span className="num text-ink-soft">信誉 {card.researcher.creditScore}</span>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-soft">
          {/* 线上实验没有场地，写「线上完成」；地点字段对它没意义，也不该把残留值露出来 */}
          {card.mode === "ONLINE" ? (
            <span className="inline-flex items-center gap-1">
              <Monitor size={12} strokeWidth={1.8} />
              线上完成
            </span>
          ) : (
            <span className="inline-flex items-center gap-1">
              <MapPin size={12} strokeWidth={1.8} />
              {card.location}
            </span>
          )}
          <span className="inline-flex items-center gap-1">
            <Clock3 size={12} strokeWidth={1.8} />
            <span className="num">{card.durationMin} 分钟</span>
          </span>
        </div>

        <div className="mt-2.5 flex items-end justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {card.lowCreditResearcher ? (
              <span className="chip bg-[#f1f2ee] text-ink-soft">主试信誉较低</span>
            ) : null}
            {card.mode === "ONLINE" ? (
              <span className="chip bg-moss-tint text-moss">线上</span>
            ) : null}
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
          {card.mode === "ONLINE" ? (
            <span className="shrink-0 text-[12px] font-medium text-moss">随时可填</span>
          ) : card.remainingSeats > 0 ? (
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

        {/* AI 入口：列表里也多一条路，省得先进详情页再进对话。
            线上实验没有时段可选，这个入口会把人带进一个空页面，直接不显示。 */}
        {card.mode === "ONLINE" ? null : (
          <Link
            href={`/experiments/${card.id}/chat`}
            className="pointer-events-auto relative z-10 mt-2.5 inline-flex items-center gap-1 rounded-pill border border-moss/25 bg-moss-tint/50 px-2.5 py-1 text-[11px] text-moss active:bg-moss-tint"
          >
            <Bot size={12} strokeWidth={2.2} />
            让 AI 帮我挑时段
          </Link>
        )}
      </div>
    </div>
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
