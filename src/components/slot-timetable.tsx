"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/toast";
import { addDaysToDateStr, toShanghai, toShanghaiIso } from "@/lib/time";
import { cn } from "@/lib/cn";

/**
 * 时段课程表 —— 主试排期的唯一视图。
 *
 * 为什么换成课程表：
 *   原来「批量生成 → 一串 chip」的做法，主试只能看到自己生成了什么，
 *   看不到「这一周哪几天还空着」。想加周三 15:30，得重开生成器、改范围、再合并。
 *   课程表把「一周 × 一天」摊开之后，点格子就是加时段，再点就是取消。
 *
 * 交互约定（都在格子上完成，不需要额外弹窗）：
 *   - 点空格子：加一段（长度 = 实验时长）
 *   - 点已选格子：删掉这一段
 *   - 点一段中间（被覆盖的格子）：也删掉整段，避免「点了没反应」
 *   - 与已有时段重叠的位置不响应，并提示 —— 不会默默把别的时段挤掉
 *
 * 这个组件只认 ISO 字符串和数字，不碰接口、不认 Prisma。
 */

export type TimetableSlot = {
  startAt: string;
  endAt: string;
  capacity: number;
  /** 只读展示时用：已被预约的人数 */
  bookedCount?: number;
};

type WindowKey = "am" | "pm" | "eve" | "all";

const WINDOWS: Record<WindowKey, { label: string; start: number; end: number }> = {
  am: { label: "上午", start: 8 * 60, end: 12 * 60 },
  pm: { label: "下午", start: 12 * 60, end: 18 * 60 },
  eve: { label: "晚上", start: 18 * 60, end: 22 * 60 },
  // 真·全天：草稿里可能带凌晨时段，只到 08:00 起会让它们永远显示不出来
  all: { label: "全天", start: 0, end: 24 * 60 },
};

const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];
/** 批量填充的星期选项，1=周一 */
const FILL_DAYS = [1, 2, 3, 4, 5, 6, 7];

const MINUTE_MS = 60 * 1000;

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function hhmm(minutes: number) {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

function dateOf(iso: string) {
  const p = toShanghai(new Date(iso));
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

function startOfWeek(dateStr: string) {
  const wd = new Date(`${dateStr}T12:00:00+08:00`).getUTCDay(); // 0=周日
  const offset = wd === 0 ? -6 : 1 - wd;
  return addDaysToDateStr(dateStr, offset);
}

function weekdayOf(dateStr: string) {
  const wd = new Date(`${dateStr}T12:00:00+08:00`).getUTCDay();
  return wd === 0 ? 7 : wd;
}

function sortSlots(list: TimetableSlot[]) {
  return [...list].sort(
    (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
  );
}

/** 批量填充时把新时段并进去：已有起点跳过，重叠丢弃，不产生嵌套 */
function mergeSlots(current: TimetableSlot[], incoming: TimetableSlot[]) {
  const map = new Map<string, TimetableSlot>();
  for (const s of [...current, ...incoming]) map.set(s.startAt, s);

  const out: TimetableSlot[] = [];
  let lastEnd = Number.NEGATIVE_INFINITY;
  for (const slot of sortSlots([...map.values()])) {
    const start = new Date(slot.startAt).getTime();
    const end = new Date(slot.endAt).getTime();
    if (start < lastEnd) continue;
    out.push(slot);
    lastEnd = end;
  }
  return out;
}

/**
 * 打开时该看哪一周、哪个时间窗 —— 由已有数据决定，没有数据就看明天下午。
 *
 * 必须放在 useState 的初始化里而不是 useEffect：这个组件在第 2 步才挂载，
 * 草稿回填发生在挂载之前，effect 那次「从 0 变多」根本不会触发，
 * 结果就是回填了 2 段却停在空白的下午视图。
 */
function initialView(slots: TimetableSlot[], today: string) {
  if (slots.length === 0) {
    return { weekStart: startOfWeek(addDaysToDateStr(today, 1)), windowKey: "pm" as WindowKey };
  }
  const earliest = sortSlots(slots)[0];
  const p = toShanghai(new Date(earliest.startAt));
  const minutes = p.hour * 60 + p.minute;
  // 落在哪个窗口就跳哪个；凌晨这种不属于任何命名窗口的，切到全天
  const matched = (["am", "pm", "eve"] as const).find(
    (k) => minutes >= WINDOWS[k].start && minutes < WINDOWS[k].end,
  );
  return {
    weekStart: startOfWeek(dateOf(earliest.startAt)),
    windowKey: (matched ?? "all") as WindowKey,
  };
}

export function SlotTimetable({
  slots,
  durationMin,
  capacity,
  today,
  onChange,
  showBooked = false,
  className,
}: {
  slots: TimetableSlot[];
  durationMin: number;
  capacity: number;
  /** 上海时区今天，YYYY-MM-DD（由服务端给，避免水合时两端日期不一致） */
  today: string;
  /** 不传 = 只读。传 setState 而不是「next 数组」回调：
   *  连续快速点几个格子时，React 会批处理更新，用 props 里的 slots 计算会互相覆盖。 */
  onChange?: Dispatch<SetStateAction<TimetableSlot[]>>;
  showBooked?: boolean;
  className?: string;
}) {
  const editable = typeof onChange === "function";

  const [weekStart, setWeekStart] = useState(() => initialView(slots, today).weekStart);
  const [windowKey, setWindowKey] = useState<WindowKey>(() => initialView(slots, today).windowKey);
  const [fillDays, setFillDays] = useState<number[]>([1, 3]);
  const [fillStart, setFillStart] = useState("14:00");
  const [fillEnd, setFillEnd] = useState("17:00");

  const bodyRef = useRef<HTMLDivElement>(null);

  /**
   * 挂载时把表格滚到第一段所在的行。
   *
   * 「全天」有 48 行、容器只有 356px 高，不滚的话回填完还是一屏空白，
   * 用户会以为时段没填进来。只在挂载时做一次，之后用户自己滚。
   */
  useEffect(() => {
    const el = bodyRef.current;
    if (!el || slots.length === 0) return;
    const first = sortSlots(slots)[0];
    const p = toShanghai(new Date(first.startAt));
    const idx = Math.floor((p.hour * 60 + p.minute - WINDOWS[windowKey].start) / 30);
    if (idx > 1) el.scrollTop = idx * 36 - 108;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDaysToDateStr(weekStart, i)),
    [weekStart],
  );

  const hours = WINDOWS[windowKey];
  const rows = useMemo(() => {
    const list: number[] = [];
    for (let m = hours.start; m + 30 <= hours.end; m += 30) list.push(m);
    return list;
  }, [hours]);

  /** 起点 → 时段；覆盖区间 → 该时段，点中间也能删 */
  const { byStart, byCover } = useMemo(() => {
    const starts = new Map<string, TimetableSlot>();
    const covers = new Map<string, TimetableSlot>();
    for (const slot of slots) {
      const start = new Date(slot.startAt);
      const end = new Date(slot.endAt);
      const startKey = `${dateOf(slot.startAt)}|${pad(toShanghai(start).hour)}:${pad(toShanghai(start).minute)}`;
      starts.set(startKey, slot);
      for (let t = start.getTime() + 30 * MINUTE_MS; t < end.getTime(); t += 30 * MINUTE_MS) {
        const iso = new Date(t).toISOString();
        covers.set(`${dateOf(iso)}|${pad(toShanghai(new Date(iso)).hour)}:${pad(toShanghai(new Date(iso)).minute)}`, slot);
      }
    }
    return { byStart: starts, byCover: covers };
  }, [slots]);

  const outsideCount = slots.filter((slot) => {
    const day = dateOf(slot.startAt);
    const hour = toShanghai(new Date(slot.startAt)).hour;
    return !days.includes(day) || hour * 60 < hours.start || hour * 60 >= hours.end;
  }).length;

  function toggle(day: string, minutes: number) {
    if (!editable || !onChange) return;

    const startIso = toShanghaiIso(day, hhmm(minutes));
    const key = `${day}|${hhmm(minutes)}`;

    // 先处理「取消」：点已选格子的起点或中间都删整段
    const exact = byStart.get(key);
    if (exact) {
      onChange((prev) => prev.filter((s) => s.startAt !== exact.startAt));
      return;
    }
    const covered = byCover.get(key);
    if (covered) {
      onChange((prev) => prev.filter((s) => s.startAt !== covered.startAt));
      return;
    }

    const startMs = new Date(startIso).getTime();
    const endMs = startMs + Math.max(5, durationMin) * MINUTE_MS;
    const overlaps = slots.some((s) => {
      const a = new Date(s.startAt).getTime();
      const b = new Date(s.endAt).getTime();
      return startMs < b && endMs > a;
    });
    if (overlaps) {
      toast("这个时间和已选的时段重叠了", "error");
      return;
    }

    // 用 updater：连点时基于最新 slots 计算，不会互相覆盖
    onChange((prev) => {
      const clash = prev.some((s) => {
        const a = new Date(s.startAt).getTime();
        const b = new Date(s.endAt).getTime();
        return startMs < b && endMs > a;
      });
      if (clash) return prev;
      return sortSlots([...prev, { startAt: startIso, endAt: new Date(endMs).toISOString(), capacity }]);
    });
  }

  function fillWeek() {
    if (!editable || !onChange) return;
    const start = Number(fillStart.slice(0, 2)) * 60 + Number(fillStart.slice(3, 5));
    const end = Number(fillEnd.slice(0, 2)) * 60 + Number(fillEnd.slice(3, 5));
    if (end <= start) return toast("结束时间要晚于开始时间", "error");
    if (fillDays.length === 0) return toast("先选周几", "error");

    const duration = Math.max(5, durationMin);
    const step = Math.max(30, Math.ceil(duration / 30) * 30);
    const next: TimetableSlot[] = [];
    for (const day of days) {
      if (!fillDays.includes(weekdayOf(day))) continue;
      for (let m = start; m + duration <= end; m += step) {
        next.push({
          startAt: toShanghaiIso(day, hhmm(m)),
          endAt: new Date(new Date(toShanghaiIso(day, hhmm(m))).getTime() + duration * MINUTE_MS).toISOString(),
          capacity,
        });
      }
    }
    if (next.length === 0) return toast("这个范围里排不下，检查起止时间", "error");

    onChange((prev) => mergeSlots(prev, next));
    toast(`本周填入 ${next.length} 个时段，重复的自动跳过`);
  }

  const isCurrentWeek = weekStart === startOfWeek(today);
  /** 名额按每段自己的容量加总：团体人数改过之后，旧时段容量可能不一致 */
  const totalSeats = slots.reduce((sum, s) => sum + s.capacity, 0);

  return (
    <div className={cn("rounded-card border border-line bg-surface p-2.5", className)}>
      {/* 周切换 */}
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
          {weekStart.slice(5).replace("-", "/")} – {addDaysToDateStr(weekStart, 6).slice(5).replace("-", "/")}
        </span>
        <div className="flex items-center">
          {!isCurrentWeek ? (
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

      {/* 时间范围：格子只画这一段，避免一屏塞 28 行 */}
      <div className="mt-1.5 flex gap-1">
        {(Object.keys(WINDOWS) as WindowKey[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setWindowKey(key)}
            className={cn(
              "h-6 flex-1 rounded-[5px] text-[11px]",
              windowKey === key
                ? "bg-moss text-white"
                : "border border-line bg-surface text-ink-soft",
            )}
          >
            {WINDOWS[key].label}
          </button>
        ))}
      </div>

      {/* 课程表 */}
      <div
        ref={bodyRef}
        className="scroll-x mt-2 max-h-[356px] overflow-y-auto rounded-[6px] border border-line"
      >
        <div
          className="grid"
          style={{ gridTemplateColumns: "34px repeat(7, minmax(0, 1fr))" }}
        >
          <div className="sticky top-0 z-10 border-b border-r border-line bg-surface" />
          {days.map((day, i) => {
            const isToday = day === today;
            return (
              <div
                key={day}
                className={cn(
                  "sticky top-0 z-10 flex flex-col items-center justify-center border-b border-r border-line bg-surface py-1 last:border-r-0",
                  isToday && "bg-moss-tint/60",
                )}
              >
                <span className={cn("text-[11px] leading-4", isToday ? "font-semibold text-moss" : "text-ink-soft")}>
                  {WEEKDAY_LABELS[i]}
                </span>
                <span className="num text-[9px] leading-3 text-ink-soft/80">{day.slice(8)}</span>
              </div>
            );
          })}

          {rows.map((minutes) => (
            <Fragment key={minutes}>
              <div
                className={cn(
                  "num flex items-start justify-end border-b border-r border-line bg-surface pr-1 pt-0.5 text-[9px] leading-3 text-ink-soft/80",
                  minutes === rows[rows.length - 1] && "border-b-0",
                )}
              >
                {hhmm(minutes)}
              </div>
              {days.map((day, dayIndex) => {
                const key = `${day}|${hhmm(minutes)}`;
                const slot = byStart.get(key);
                const cover = slot ? null : byCover.get(key);
                const startMs = new Date(toShanghaiIso(day, hhmm(minutes))).getTime();
                const past = startMs <= Date.now();
                const full = Boolean(
                  showBooked && slot && slot.bookedCount !== undefined && slot.bookedCount >= slot.capacity,
                );

                return (
                  <button
                    key={key}
                    type="button"
                    disabled={!editable || past}
                    onClick={() => toggle(day, minutes)}
                    aria-label={`${day} ${hhmm(minutes)} ${slot ? "取消这个时段" : "添加时段"}`}
                    className={cn(
                      "h-9 border-b border-r border-line/70 transition-colors",
                      dayIndex === 6 && "border-r-0",
                      minutes === rows[rows.length - 1] && "border-b-0",
                      !editable && "cursor-default",
                      slot && !full && "bg-moss",
                      slot && full && "bg-clay/80",
                      !slot && cover && "bg-moss-tint",
                      !slot && !cover && !past && editable && "bg-surface active:bg-moss-tint",
                      !slot && !cover && (!editable || past) && "bg-mist/40",
                    )}
                  >
                    {slot && !full ? (
                      <span className="mx-auto block h-1.5 w-1.5 rounded-full bg-white/85" />
                    ) : null}
                    {full ? <span className="text-[9px] leading-none text-white">满</span> : null}
                  </button>
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-ink-soft">
        {/* 只读态（编辑页的「已有时段」）不能说「可点」——那里的格子点不动 */}
        {editable ? (
          <span className="inline-flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-[2px] border border-line bg-surface" />
            可点
          </span>
        ) : null}
        <span className="inline-flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-[2px] bg-moss" />
          {editable ? "已选" : "已开时段"}
        </span>
        {showBooked ? (
          <span className="inline-flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-[2px] bg-clay/80" />
            已约满
          </span>
        ) : null}
        <span className="ml-auto">
          <span className="num text-ink">{slots.length}</span> 段 · 每段 {durationMin} 分钟
        </span>
      </div>

      {outsideCount > 0 ? (
        <p className="mt-1 text-[10px] leading-4 text-warn">
          另有 {outsideCount} 段不在当前周或时间范围里，切到「全天」或翻周可查看。
        </p>
      ) : null}

      {/* 批量填充：保留熟手路径，但填进的是同一张表 */}
      {editable ? (
        <div className="mt-2 rounded-[8px] border border-dashed border-line px-2 py-2">
          <p className="mb-1 text-[11px] text-ink-soft">按星期批量填本周</p>
          <div className="flex gap-1">
            {FILL_DAYS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() =>
                  setFillDays((prev) => (prev.includes(d) ? prev.filter((v) => v !== d) : [...prev, d]))
                }
                className={cn(
                  "h-7 flex-1 rounded-[5px] text-[11px]",
                  fillDays.includes(d)
                    ? "bg-moss text-white"
                    : "border border-line bg-surface text-ink-soft",
                )}
              >
                {WEEKDAY_LABELS[d - 1]}
              </button>
            ))}
          </div>
          <div className="mt-1.5 flex items-center gap-1.5">
            <input
              type="time"
              value={fillStart}
              onChange={(e) => setFillStart(e.target.value)}
              className="num h-8 min-w-0 flex-1 rounded-[6px] border border-line bg-surface px-1.5 text-[12px] text-ink"
            />
            <span className="text-[11px] text-ink-soft">–</span>
            <input
              type="time"
              value={fillEnd}
              onChange={(e) => setFillEnd(e.target.value)}
              className="num h-8 min-w-0 flex-1 rounded-[6px] border border-line bg-surface px-1.5 text-[12px] text-ink"
            />
            <Button size="sm" onClick={fillWeek}>
              填入
            </Button>
          </div>
        </div>
      ) : null}

      {editable && slots.length > 0 ? (
        <div className="mt-2 flex items-center justify-between text-[11px] text-ink-soft">
          <span>
            共 <span className="num text-ink">{totalSeats}</span> 个名额
          </span>
          <button type="button" onClick={() => onChange?.([])} className="text-danger">
            清空全部
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** 把草稿/接口时段转成课程表认的形状 */
export function toTimetableSlots(
  slots: { startAt: string; endAt: string; capacity: number; bookedCount?: number }[],
): TimetableSlot[] {
  return slots.map((s) => ({
    startAt: s.startAt,
    endAt: s.endAt,
    capacity: s.capacity,
    ...(s.bookedCount === undefined ? {} : { bookedCount: s.bookedCount }),
  }));
}
