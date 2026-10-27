"use client";

import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";

/** 左上角返回：优先走浏览器历史，没有历史就退到 fallback */
export function BackButton({ fallback = "/" }: { fallback?: string }) {
  const router = useRouter();

  return (
    <button
      type="button"
      aria-label="返回"
      onClick={() => {
        if (typeof window !== "undefined" && window.history.length > 1) router.back();
        else router.push(fallback);
      }}
      className="press flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink"
    >
      <ChevronLeft size={22} strokeWidth={1.9} />
    </button>
  );
}
