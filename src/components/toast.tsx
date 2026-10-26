"use client";

import { create } from "zustand";
import { useEffect } from "react";

type ToastItem = { id: number; text: string; tone: "ok" | "error" };

type ToastStore = {
  items: ToastItem[];
  push: (text: string, tone?: "ok" | "error") => void;
  remove: (id: number) => void;
};

export const useToast = create<ToastStore>((set, get) => ({
  items: [],
  push: (text, tone = "ok") => {
    const id = Date.now() + Math.random();
    set({ items: [...get().items, { id, text, tone }] });
    setTimeout(() => {
      set({ items: get().items.filter((i) => i.id !== id) });
    }, 2800);
  },
  remove: (id) => set({ items: get().items.filter((i) => i.id !== id) }),
}));

export function toast(text: string, tone: "ok" | "error" = "ok") {
  useToast.getState().push(text, tone);
}

export function Toaster() {
  const items = useToast((s) => s.items);

  useEffect(() => {
    // 保持订阅，避免 HMR 时丢掉监听
  }, []);

  if (items.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex flex-col items-center gap-2 px-6">
      {items.map((item) => (
        <div
          key={item.id}
          className={`animate-rise-in max-w-[360px] rounded-lg px-3.5 py-2.5 text-[13px] leading-snug shadow-lift ${
            item.tone === "error" ? "bg-danger text-white" : "bg-moss-deep text-white"
          }`}
        >
          {item.text}
        </div>
      ))}
    </div>
  );
}
