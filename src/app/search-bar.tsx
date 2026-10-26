"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";

export function SearchBar({ initial }: { initial: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [value, setValue] = useState(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setValue(initial);
  }, [initial]);

  function commit(next: string) {
    const query = new URLSearchParams(params.toString());
    if (next.trim()) query.set("keyword", next.trim());
    else query.delete("keyword");
    router.replace(`/?${query.toString()}`, { scroll: false });
  }

  return (
    <div className="relative">
      <Search
        size={16}
        strokeWidth={1.9}
        className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-soft"
      />
      <input
        value={value}
        onChange={(e) => {
          const next = e.target.value;
          setValue(next);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => commit(next), 320);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit(value);
        }}
        placeholder="搜实验名称、地点"
        className="h-11 w-full rounded-pill bg-[#F5F6F7] pl-9 pr-3 text-[14px] text-ink outline-none placeholder:text-[#9aa5a0] focus:bg-surface focus:ring-1 focus:ring-moss/40"
        aria-label="搜索实验"
      />
    </div>
  );
}
