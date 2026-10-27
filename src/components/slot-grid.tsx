"use client";

import { useMemo, useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatDayKey, formatHM, toShanghai } from "@/lib/time";
import type { SlotView } from "@/lib/types";

const WEEKDAY = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

type Props = {
  slots: SlotView[];
  value: string[];
  onChange?: (ids: string[]) => void;
  multi?: boolean;
  disabledIds?: string[];
  emptyHint?: string;
  /** 只读展示：不可点，也不显示勾选态（详情页用） */
  readOnly?: boolean;
};

/**
 * 时段格子 —— 这个产品的主视图。
 * 先按天切，再把一天里的时段排成 2 列格子；格子里同时给出时间和剩余名额，
 * 满的时段划掉而不是藏起来（被试需要知道"我看晚了"）。
 */
export function SlotGrid({
  slots,
  value,
  onChange,
  multi = false,
  disabledIds = [],
  emptyHint = "暂时没有可预约的时段",
  readOnly = false,
}: Props) {
  const days = useMemo(() => {
    const map = new Map<string, SlotView[]>();
    for (const slot of slots) {
      const key = formatDayKey(new Date(slot.startAt));
      const list = map.get(key) ?? [];
      list.push(slot);
      map.set(key, list);
    }
    return Array.from(map.entries());
  }, [slots]);

  const [activeDay, setActiveDay] = useState<string | null>(null);
  const currentDay = activeDay && days.some(([k]) => k === activeDay) ? activeDay : days[0]?.[0];
  const currentSlots = days.find(([k]) => k === currentDay)?.[1] ?? [];

  if (slots.length === 0) {
    return (
      <div className="rounded-card border border-dashed border-line bg-surface/60 px-4 py-8 text-center text-[13px] text-ink-soft">
        {emptyHint}
      </div>
    );
  }

  const toggle = (slot: SlotView) => {
    if (readOnly) return;
    if (slot.remaining <= 0 || disabledIds.includes(slot.id)) return;
    const next = multi
      ? value.includes(slot.id)
        ? value.filter((v) => v !== slot.id)
        : [...value, slot.id]
      : value.includes(slot.id)
        ? []
        : [slot.id];
    onChange?.(next);
  };

  return (
    <div>
      <div className="scroll-x -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1">
        {days.map(([key, list]) => {
          const date = new Date(list[0].startAt);
          const wd = WEEKDAY[toShanghai(date).weekday];
          const openCount = list.filter((s) => s.remaining > 0).length;
          const active = key === currentDay;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setActiveDay(key)}
              className={cn(
                "press flex min-w-[52px] flex-col items-center rounded-[8px] border px-2 py-1.5",
                active
                  ? "border-moss bg-moss text-white"
                  : "border-line bg-surface text-ink-soft",
              )}
            >
              <span className={cn("num text-[13px] font-semibold", active ? "text-white" : "text-ink")}>
                {key}
              </span>
              <span className="text-[10px] leading-4">{wd}</span>
              <span
                className={cn(
                  "num mt-0.5 text-[10px] leading-4",
                  active ? "text-white/80" : openCount > 0 ? "text-moss" : "text-ink-soft/60",
                )}
              >
                {openCount > 0 ? `${openCount} 段` : "满"}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        {currentSlots.map((slot) => {
          const full = slot.remaining <= 0;
          const disabled = disabledIds.includes(slot.id);
          const selected = value.includes(slot.id);
          return (
            <button
              key={slot.id}
              type="button"
              disabled={full || disabled}
              onClick={() => toggle(slot)}
              aria-pressed={selected}
              className={cn(
                "press relative flex flex-col items-start rounded-[10px] border px-3 py-2 text-left",
                selected && "border-moss bg-moss-tint",
                !selected && !full && !disabled && "border-line bg-surface",
                (full || disabled) && "border-line/70 bg-mist",
                readOnly && "press-none cursor-default",
              )}
            >
              <span
                className={cn(
                  "num text-[15px] font-semibold leading-5",
                  full || disabled ? "text-ink-soft/55 line-through" : "text-ink",
                )}
              >
                {formatHM(new Date(slot.startAt))}
              </span>
              <span className="num text-[11px] leading-4 text-ink-soft">
                至 {formatHM(new Date(slot.endAt))}
              </span>
              <span
                className={cn(
                  "num mt-0.5 text-[11px]",
                  full ? "text-ink-soft/60" : "text-moss",
                )}
              >
                {full ? "已约满" : `剩 ${slot.remaining}/${slot.capacity}`}
              </span>
              {selected ? (
                <span className="absolute right-2 top-2 flex h-4 w-4 items-center justify-center rounded-full bg-moss">
                  <Check size={11} className="text-white" strokeWidth={3} />
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {multi ? (
        <p className="mt-2 text-[11px] text-ink-soft">可勾选多个时段，系统会帮你定下一个。</p>
      ) : null}
    </div>
  );
}
