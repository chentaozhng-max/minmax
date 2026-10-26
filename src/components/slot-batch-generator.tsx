"use client";

import { useState } from "react";
import { Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { toast } from "@/components/toast";
import { addDaysToDateStr, todayInShanghai, toShanghaiIso } from "@/lib/time";
import { cn } from "@/lib/cn";

export type SlotDraft = { startAt: string; endAt: string; capacity: number };

const WEEKDAYS = [
  { value: 1, label: "一" },
  { value: 2, label: "二" },
  { value: 3, label: "三" },
  { value: 4, label: "四" },
  { value: 5, label: "五" },
  { value: 6, label: "六" },
  { value: 0, label: "日" },
];

function toMinutes(time: string) {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function fromMinutes(total: number) {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** 批量生成时段：日期区间 × 星期 × 起止时间 × 每段分钟 × 容量 */
export function SlotBatchGenerator({
  onGenerate,
  defaultSegment,
  defaultCapacity = 1,
}: {
  onGenerate: (slots: SlotDraft[]) => void;
  defaultSegment?: number;
  defaultCapacity?: number;
}) {
  const [fromDate, setFromDate] = useState(addDaysToDateStr(todayInShanghai(), 1));
  const [toDate, setToDate] = useState(addDaysToDateStr(todayInShanghai(), 5));
  const [weekdays, setWeekdays] = useState<number[]>([1, 3]);
  const [startTime, setStartTime] = useState("14:00");
  const [endTime, setEndTime] = useState("17:00");
  const [segment, setSegment] = useState(String(defaultSegment ?? 30));
  const [capacity, setCapacity] = useState(String(defaultCapacity));

  function generate() {
    const seg = Number(segment);
    const cap = Number(capacity);
    if (!seg || seg < 5) return toast("每段至少 5 分钟", "error");
    if (!cap || cap < 1) return toast("容量至少 1", "error");
    if (endTime <= startTime) return toast("结束时间要晚于开始时间", "error");
    if (toDate < fromDate) return toast("结束日期不能早于开始日期", "error");

    const generated: SlotDraft[] = [];
    let cursor = fromDate;
    let guard = 0;
    while (cursor <= toDate && guard < 120) {
      guard += 1;
      const weekday = new Date(`${cursor}T12:00:00+08:00`).getDay();
      if (weekdays.includes(weekday)) {
        let minuteCursor = toMinutes(startTime);
        const endMinute = toMinutes(endTime);
        while (minuteCursor + seg <= endMinute) {
          generated.push({
            startAt: toShanghaiIso(cursor, fromMinutes(minuteCursor)),
            endAt: toShanghaiIso(cursor, fromMinutes(minuteCursor + seg)),
            capacity: cap,
          });
          minuteCursor += seg;
        }
      }
      cursor = addDaysToDateStr(cursor, 1);
    }

    if (generated.length === 0) {
      return toast("这个范围里没有生成时段，检查一下星期和起止时间", "error");
    }
    onGenerate(generated);
  }

  return (
    <div className="rounded-card border border-line bg-surface p-3">
      <div className="mb-2 flex items-center gap-1.5">
        <Wand2 size={14} className="text-moss" strokeWidth={2} />
        <p className="text-[13px] font-medium text-ink">批量生成</p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field label="从">
          <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </Field>
        <Field label="到">
          <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </Field>
      </div>

      <div className="mt-2">
        <span className="mb-1.5 block text-[13px] font-medium text-ink">每周哪几天</span>
        <div className="flex gap-1.5">
          {WEEKDAYS.map((d) => (
            <button
              key={d.value}
              type="button"
              onClick={() =>
                setWeekdays((prev) =>
                  prev.includes(d.value) ? prev.filter((v) => v !== d.value) : [...prev, d.value],
                )
              }
              className={cn(
                "h-8 flex-1 rounded-[6px] border text-[12px]",
                weekdays.includes(d.value)
                  ? "border-moss bg-moss text-white"
                  : "border-line bg-surface text-ink-soft",
              )}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <Field label="开始">
          <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
        </Field>
        <Field label="结束">
          <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
        </Field>
        <Field label="每段分钟">
          <Input
            inputMode="numeric"
            value={segment}
            onChange={(e) => setSegment(e.target.value.replace(/\D/g, ""))}
          />
        </Field>
        <Field label="每段容量">
          <Input
            inputMode="numeric"
            value={capacity}
            onChange={(e) => setCapacity(e.target.value.replace(/\D/g, ""))}
          />
        </Field>
      </div>

      <Button size="md" block className="mt-3" onClick={generate}>
        一键生成时段
      </Button>
    </div>
  );
}
