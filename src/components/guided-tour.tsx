"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Tour, type TourStep } from "@/components/tour";

/**
 * 把「什么时候弹」和「弹几步」两件事拆开。
 *
 * `Tour` 只负责画（高亮 + 气泡），不管这个人该不该看。
 * 主试端三处是各写一遍 `useEffect` + `localStorage`，因为它们的页面本身就是
 * 客户端组件；被试端的两个页面（找实验、实验详情）都是服务端组件，
 * 只能把这段逻辑收进一个客户端小壳里。
 *
 * 行为刻意和主试端逐条对齐：
 *   1. `storageKey` 存 localStorage，看过一次就不再自动弹
 *   2. 带 `?tour=1` 进来强制弹一次（「我的」里的重看入口靠这个）
 *   3. 关掉时把 `?tour=1` 从地址里抹掉 —— 否则刷新又弹一次
 *   4. 抹参数时保留其它查询参数（首页可能有 keyword/date 筛选，不能顺手清掉）
 */
export function GuidedTour({
  steps,
  storageKey,
  tourRequested,
}: {
  steps: TourStep[];
  storageKey: string;
  tourRequested?: boolean;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (tourRequested) {
      setOpen(true);
      return;
    }
    if (localStorage.getItem(storageKey)) return;
    // 等一帧再开：服务端渲染的锚点虽然已经在 HTML 里，
    // 但字体/样式落定前量出来的位置会有偏差，Tour 自己也会在 400ms 后重新筛一遍。
    const timer = window.setTimeout(() => setOpen(true), 300);
    return () => window.clearTimeout(timer);
  }, [tourRequested, storageKey]);

  const close = useCallback(() => {
    setOpen(false);
    localStorage.setItem(storageKey, "1");
    if (!tourRequested) return;
    /**
     * 只摘掉 tour，其余查询参数原样带回。
     *
     * 这里刻意用 `history.replaceState` 而不是 `router.replace`：
     * `router.replace` 在「新 URL 只比旧 URL 少一个参数」时**可能不落地**
     * （实测 `/?tour=1` → `/` 地址栏纹丝不动，5 秒都不动，而
     * `/?date=today&tour=1` → `/?date=today` 是正常的）。
     * 而这件事根本不需要重新渲染页面 —— 引导已经关了、key 也写了，
     * 只是把地址栏擦干净，避免用户刷新或分享时又弹一次。
     * 浏览器原生的 replaceState 同步生效，也没有多一次 RSC 往返。
     */
    const query = new URLSearchParams(window.location.search);
    query.delete("tour");
    const qs = query.toString();
    window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
  }, [storageKey, tourRequested, pathname]);

  return <Tour steps={steps} open={open} onDone={close} />;
}
