"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/cn";

type Chip = { key: string; label: string; value: string | null };

const DURATIONS: Chip[] = [
  { key: "duration", label: "30 分钟内", value: "short" },
  { key: "duration", label: "30–60 分钟", value: "medium" },
  { key: "duration", label: "1 小时以上", value: "long" },
];

const DATES: Chip[] = [
  { key: "date", label: "今天有空位", value: "today" },
  { key: "date", label: "明天有空位", value: "tomorrow" },
];

const ELIGIBLE: Chip[] = [{ key: "onlyEligible", label: "只看我能报的", value: "true" }];

export function FilterChips() {
  const router = useRouter();
  const params = useSearchParams();

  function toggle(key: string, value: string | null) {
    const query = new URLSearchParams(params.toString());
    if (query.get(key) === value) query.delete(key);
    else query.set(key, value ?? "");
    router.replace(`/?${query.toString()}`, { scroll: false });
  }

  function renderChips(chips: Chip[], label: string) {
    return chips.map((chip) => {
      const active = params.get(chip.key) === chip.value;
      return (
        <button
          key={`${chip.key}-${chip.value}`}
          type="button"
          aria-pressed={active}
          onClick={() => toggle(chip.key, chip.value)}
          className={cn(
            "press shrink-0 rounded-[4px] border px-2 py-1 text-[12px] leading-4 transition-colors",
            active
              ? "border-moss bg-moss text-white"
              : "border-line bg-surface text-ink-soft",
          )}
        >
          {label ? `${label} · ${chip.label}` : chip.label}
        </button>
      );
    });
  }

  return (
    <div className="scroll-x flex gap-1.5 overflow-x-auto pb-0.5">
      {renderChips(ELIGIBLE, "")}
      {renderChips(DATES, "")}
      {renderChips(DURATIONS, "")}
    </div>
  );
}
