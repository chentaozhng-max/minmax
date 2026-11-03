"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addDaysToDateStr, toShanghai } from "@/lib/time";
import { cn } from "@/lib/cn";

/**
 * 排班表 —— 主试看「谁约了哪一段」的只读周视图。
 *
 * 和发布页的 SlotTimetable 分工不同：
 *   SlotTimetable = 排期编辑器，点空格建 30 分钟粒度的时段，格子只能给一个点；
 *   这个组件      = 看结果，时段是真实长度（45 分钟很常见），格子里要放下姓名。
 * 所以这里不复用 30 分钟网格，改成按实际起止绝对定位：45 分钟就是 45 分钟的高度，
 * 不会被凑成整格，也不会因为「11:00–11:45」这种非整点结束而少画半格。
 *
 * 颜色约定：空位留白，有人就转红（浅红底 + 红字），约满用实心红。
 * 主试扫一眼就知道哪几段已经有人、哪几段还空着。
 */

export type ScheduleSlot = {
  id: string;
  startAt: string;
  endAt: string;
  capacity: number;
  bookedCount: number;
  /** 该时段的预约者姓名，按预约先后排；格子放不下时只显示第一个 */
  names: string[];
};

const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];
/** 左侧时间轴宽度 */
const AXIS_W = 30;
/** 每小时高度：45 分钟的格子能放两行字（姓名 + 时间） */
const HOUR_PX = 46;
/** 最少铺满 3 小时：只有一个时段时表格不至于成一条缝 */
const MIN_SPAN = 180;
/** 滚动容器高度 */
const BODY_MAX_H = 372;

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function dateKey(iso: string) {
  const p = toShanghai(new Date(iso));
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

function startOfWeek(dateStr: string) {
  const wd = new Date(`${dateStr}T12:00:00+08:00`).getUTCDay(); // 0=周日
  return addDaysToDateStr(dateStr, wd === 0 ? -6 : 1 - wd);
}

/** 距当天 00:00 的分钟数 */
function minutesOf(iso: string) {
  const p = toShanghai(new Date(iso));
  return p.hour * 60 + p.minute;
}

function spanMin(startAt: string, endAt: string) {
  return (new Date(endAt).getTime() - new Date(startAt).getTime()) / 60000;
}

function hhmm(minutes: number) {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/**
 * 本周要画的时间范围：贴着实际时段铺，最少 3 小时。
 *
 * 导出来是为了能单测 —— 时间轴的自适应是这块最容易改错的地方
 * （少留 30 分钟会把时段顶到表格边线上，跨日不掐断会画到表格外面）。
 */
export function scheduleWindow(weekSlots: ScheduleSlot[]) {
  if (weekSlots.length === 0) return { from: 8 * 60, to: 12 * 60 };

  let min = 24 * 60;
  let max = 0;
  for (const slot of weekSlots) {
    const start = minutesOf(slot.startAt);
    min = Math.min(min, start);
    // 跨日时段（23:30–00:15）按开始时间 + 时长算，再掐到 24:00
    max = Math.max(max, Math.min(24 * 60, start + spanMin(slot.startAt, slot.endAt)));
  }

  let from = Math.max(0, Math.floor(min / 60) * 60 - 30);
  let to = Math.min(24 * 60, Math.ceil(max / 60) * 60 + 30);

  if (to - from < MIN_SPAN) {
    // 上下各撑一半，撑不下就只往下撑，保证时段本身在视野里
    const need = Math.ceil((MIN_SPAN - (to - from)) / 2 / 30) * 30;
    from = Math.max(0, from - need);
    to = Math.min(24 * 60, from + MIN_SPAN);
    if (to - from < MIN_SPAN) from = Math.max(0, to - MIN_SPAN);
  }

  return { from, to };
}

/** 一个时段在某一周里的格子：颜色与文字都从这里算，渲染只管画 */
function cellState(slot: ScheduleSlot) {
  if (slot.bookedCount <= 0) return "empty" as const;
  return slot.bookedCount >= slot.capacity ? "full" as const : "booked" as const;
}

export function SlotSchedule({
  slots,
  today,
  onSelect,
  className,
}: {
  slots: ScheduleSlot[];
  /** 上海时区今天，YYYY-MM-DD（服务端给，避免两端日期不一致） */
  today: string;
  /** 点某个时段：主试想看这个时段到底是谁 */
  onSelect?: (slotId: string) => void;
  className?: string;
}) {
  const [weekStart, setWeekStart] = useState(() => {
    const earliest = [...slots].sort(
      (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
    )[0];
    return startOfWeek(earliest ? dateKey(earliest.startAt) : today);
  });

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDaysToDateStr(weekStart, i)),
    [weekStart],
  );

  const weekSlots = useMemo(
    () => slots.filter((s) => days.includes(dateKey(s.startAt))),
    [slots, days],
  );

  const { from, to } = useMemo(() => scheduleWindow(weekSlots), [weekSlots]);
  const bodyH = ((to - from) / 60) * HOUR_PX;

  const ticks = useMemo(() => {
    const list: number[] = [];
    for (let m = Math.ceil(from / 60) * 60; m <= to; m += 60) list.push(m);
    return list;
  }, [from, to]);

  const bodyRef = useRef<HTMLDivElement>(null);

  /**
   * 数据晚到（接口还没回来时 slots 是空数组）就跳不到正确的周，
   * 所以补一个「从空变有」的兜底：落在最早那一段所在的周。
   */
  const prevCount = useRef(slots.length);
  useEffect(() => {
    if (prevCount.current === 0 && slots.length > 0) {
      const first = [...slots].sort(
        (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
      )[0];
      setWeekStart(startOfWeek(dateKey(first.startAt)));
    }
    prevCount.current = slots.length;
  }, [slots]);

  /** 换周后把表格滚到本周第一段，免得翻过去是一片空白还得自己找 */
  useEffect(() => {
    const el = bodyRef.current;
    if (!el || weekSlots.length === 0) return;
    const first = Math.min(...weekSlots.map((s) => minutesOf(s.startAt)));
    el.scrollTop = Math.max(0, ((first - from) / 60) * HOUR_PX - 24);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart, from]);

  const bookedSeats = weekSlots.reduce((n, s) => n + s.bookedCount, 0);
  const totalSeats = weekSlots.reduce((n, s) => n + s.capacity, 0);
  const outside = slots.length - weekSlots.length;

  return (
    <div className={cn("rounded-card border border-line bg-surface p-2.5", className)}>
      <div className="flex items-center justify-between">
        <button
          type="button"
          aria-label="上一周"
          onClick={() => setWeekStart(addDaysToDateStr(weekStart, -7))}
          className="press flex h-7 w-7 items-center justify-center rounded-full text-ink-soft"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="num text-[12px] font-medium text-ink">
          {weekStart.slice(5).replace("-", "/")} –{" "}
          {addDaysToDateStr(weekStart, 6).slice(5).replace("-", "/")}
        </span>
        <div className="flex items-center">
          {weekStart !== startOfWeek(today) ? (
            <button
              type="button"
              onClick={() => setWeekStart(startOfWeek(today))}
              className="mr-1 text-[11px] text-moss"
            >
              本周
            </button>
          ) : null}
          <button
            type="button"
            aria-label="下一周"
            onClick={() => setWeekStart(addDaysToDateStr(weekStart, 7))}
            className="press flex h-7 w-7 items-center justify-center rounded-full text-ink-soft"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <div
        ref={bodyRef}
        className="scroll-x mt-2 overflow-y-auto rounded-[6px] border border-line"
        style={{ maxHeight: BODY_MAX_H }}
      >
        {/* 表头：周几 + 日期，跟着竖向滚动吸顶 */}
        <div
          className="sticky top-0 z-20 grid border-b border-line bg-surface"
          style={{ gridTemplateColumns: `${AXIS_W}px repeat(7, minmax(0, 1fr))` }}
        >
          <div />
          {days.map((day, i) => {
            const isToday = day === today;
            return (
              <div
                key={day}
                className={cn(
                  "flex flex-col items-center justify-center border-l border-line py-1",
                  isToday && "bg-moss-tint",
                )}
              >
                <span
                  className={cn(
                    "text-[11px] leading-4",
                    isToday ? "font-semibold text-moss" : "text-ink-soft",
                  )}
                >
                  {WEEKDAY_LABELS[i]}
                </span>
                <span className="num text-[9px] leading-3 text-ink-soft/80">{day.slice(8)}</span>
              </div>
            );
          })}
        </div>

        {/* 表体：按分钟绝对定位，时段的真实长度就是格子的真实高度 */}
        <div className="relative" style={{ height: bodyH }}>
          {/* 今天所在的列 */}
          {days.map((day, i) =>
            day === today ? (
              <div
                key={day}
                className="absolute inset-y-0 bg-moss-tint"
                style={{
                  left: `calc(${AXIS_W}px + (100% - ${AXIS_W}px) / 7 * ${i})`,
                  width: `calc((100% - ${AXIS_W}px) / 7)`,
                }}
              />
            ) : null,
          )}

          {/* 整点线 + 时间标签 */}
          {ticks.map((m) => (
            <div
              key={m}
              className="absolute inset-x-0 flex items-start"
              style={{ top: ((m - from) / 60) * HOUR_PX }}
            >
              <span
                className="num -mt-1.5 shrink-0 pr-1 text-right text-[9px] leading-3 text-ink-soft/80"
                style={{ width: AXIS_W }}
              >
                {hhmm(m)}
              </span>
              <span className="mt-0 h-px flex-1 bg-line" />
            </div>
          ))}

          {/* 时段块 */}
          {weekSlots.map((slot) => {
            const dayIndex = days.indexOf(dateKey(slot.startAt));
            if (dayIndex < 0) return null;

            const start = minutesOf(slot.startAt);
            const real = spanMin(slot.startAt, slot.endAt);
            // 跨日的那一截画到 24:00 为止，多出来的用 title 说明
            const shown = Math.max(15, Math.min(real, 24 * 60 - start));
            const height = (shown / 60) * HOUR_PX;
            const state = cellState(slot);
            const label =
              slot.capacity === 1 ? (slot.names[0] ?? "已约") : `${slot.bookedCount}/${slot.capacity}`;
            const range = `${hhmm(start)}-${hhmm(start + real)}`;

            return (
              <button
                key={slot.id}
                type="button"
                onClick={() => onSelect?.(slot.id)}
                title={`${dateKey(slot.startAt)} ${range} · ${slot.bookedCount}/${slot.capacity}${
                  slot.names.length ? ` · ${slot.names.join("、")}` : ""
                }`}
                className={cn(
                  "absolute overflow-hidden rounded-[4px] border px-0.5 py-0.5 text-left transition-colors",
                  state === "empty" && "border-dashed border-line bg-surface",
                  state === "booked" && "border-danger bg-danger-tint",
                  state === "full" && "border-danger bg-danger",
                  onSelect && "active:opacity-80",
                )}
                style={{
                  left: `calc(${AXIS_W}px + (100% - ${AXIS_W}px) / 7 * ${dayIndex} + 1px)`,
                  width: `calc((100% - ${AXIS_W}px) / 7 - 2px)`,
                  top: ((start - from) / 60) * HOUR_PX + 1,
                  height: height - 2,
                }}
              >
                {state === "empty" ? (
                  <span className="block truncate text-[10px] leading-[12px] text-ink-soft opacity-50">
                    {hhmm(start)}
                  </span>
                ) : (
                  <>
                    <span
                      className={cn(
                        "block truncate text-[10px] font-medium leading-[12px]",
                        state === "full" ? "text-white" : "text-danger",
                      )}
                    >
                      {label}
                    </span>
                    {height >= 30 ? (
                      <span
                        className={cn(
                          "num block truncate text-[9px] leading-[11px]",
                          state === "full" ? "text-white opacity-80" : "text-danger opacity-80",
                        )}
                      >
                        {hhmm(start)}
                      </span>
                    ) : null}
                  </>
                )}
              </button>
            );
          })}

          {weekSlots.length === 0 ? (
            <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-[12px] leading-5 text-ink-soft/70">
              这周没排时段{outside > 0 ? `，还有 ${outside} 段在其他周` : ""}
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-ink-soft">
        <span className="inline-flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-[2px] border border-dashed border-line bg-surface" />
          空位
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-[2px] border border-danger bg-danger-tint" />
          有人约
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-[2px] bg-danger" />
          约满
        </span>
        <span className="ml-auto num">
          本周 <span className="text-ink">{bookedSeats}</span>/{totalSeats} 人 ·{" "}
          <span className="text-ink">{weekSlots.length}</span> 段
        </span>
      </div>

      {outside > 0 ? (
        <p className="mt-1 text-[10px] leading-4 text-ink-soft/70">
          共 {slots.length} 段，另外 {outside} 段在别的周，翻周查看。
        </p>
      ) : null}
    </div>
  );
}
