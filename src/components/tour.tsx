"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

/**
 * 新手引导：高亮一个元素、说一句它是干什么的、点「下一步」移到下一个。
 *
 * 自己写而不引 driver.js / intro.js：
 *   1. 这两个库的样式是固定的灰蓝，跟「砚青 + 纸底」不搭，改起来比自己写还费劲
 *   2. 中文文案、移动端 375 宽下的气泡位置都要单独调
 *   3. 我们只需要「高亮 + 气泡 + 上一步/下一步」，一百多行就够
 *
 * 高亮用 `box-shadow: 0 0 0 9999px` 造遮罩，不用真的挖洞 —— 省掉一层 SVG mask。
 */

export type TourStep = {
  /** 目标元素的 CSS 选择器；找不到就跳过这一步 */
  target: string;
  title: string;
  body: string;
  /** 气泡在目标上方还是下方；不给就自动判断 */
  placement?: "top" | "bottom";
};

type Box = { top: number; left: number; width: number; height: number };

const PAD = 6;
const GAP = 10;
const BUBBLE_MAX = 320;

export function Tour({
  steps,
  open,
  onDone,
}: {
  steps: TourStep[];
  open: boolean;
  onDone: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const [bubbleHeight, setBubbleHeight] = useState(0);

  const step = steps[index];
  const last = index === steps.length - 1;

  /** 找目标、算位置。找不到就往后跳一步（页面结构变了不该把教程卡死） */
  const measure = useCallback(() => {
    if (!open || !step) return;
    const el = document.querySelector(step.target);
    if (!el) {
      // 这一屏没有这个元素，直接跳到下一步；已经在最后一步就结束
      if (index < steps.length - 1) setIndex((i) => i + 1);
      else onDone();
      return;
    }
    const rect = el.getBoundingClientRect();
    setBox({
      top: rect.top - PAD,
      left: rect.left - PAD,
      width: rect.width + PAD * 2,
      height: rect.height + PAD * 2,
    });
  }, [open, step, index, steps.length, onDone]);

  // 换步时把目标滚到视野中间，否则高亮框可能在屏幕外
  useEffect(() => {
    if (!open || !step) return;
    const el = document.querySelector(step.target);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
    // 滚动是动画，等它稳定再量
    const timer = window.setTimeout(measure, 320);
    return () => window.clearTimeout(timer);
  }, [open, step, measure]);

  useEffect(() => {
    if (!open) return;
    const onResize = () => measure();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
    };
  }, [open, measure]);

  // 气泡高度要量出来，才敢决定放上面还是下面
  useLayoutEffect(() => {
    if (bubbleRef.current) setBubbleHeight(bubbleRef.current.offsetHeight);
  }, [index, open]);

  useEffect(() => {
    if (open) setIndex(0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDone();
      if (e.key === "Enter") {
        if (last) onDone();
        else setIndex((i) => Math.min(steps.length - 1, i + 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, last, steps.length, onDone]);

  if (!open || !step) return null;
  if (!box) {
    // 还没量到位置：先铺满遮罩，避免闪一下没有引导的页面
    return <div className="fixed inset-0 z-[80] bg-[rgba(20,30,26,0.55)]" />;
  }

  const viewportW = typeof window === "undefined" ? 390 : window.innerWidth;
  const viewportH = typeof window === "undefined" ? 844 : window.innerHeight;
  const bubbleW = Math.min(BUBBLE_MAX, viewportW - 32);

  // 下方放不下就翻到上方
  const spaceBelow = viewportH - (box.top + box.height);
  const wantBottom = step.placement ? step.placement === "bottom" : spaceBelow > bubbleHeight + GAP + 24;
  const putBelow = wantBottom || bubbleHeight === 0;

  const left = Math.min(Math.max(16, box.left + box.width / 2 - bubbleW / 2), viewportW - bubbleW - 16);

  return (
    <div className="fixed inset-0 z-[80]" role="dialog" aria-modal="true" aria-label={step.title}>
      {/* 高亮框本身就是遮罩：巨大的外阴影把周围压暗 */}
      <div
        className="pointer-events-none absolute rounded-[10px] ring-2 ring-moss transition-all duration-200"
        style={{
          top: box.top,
          left: box.left,
          width: box.width,
          height: box.height,
          boxShadow: "0 0 0 9999px rgba(20,30,26,0.55)",
        }}
      />

      {/* 点空白处不关，避免误触；只认「跳过」和 Esc */}
      <div className="absolute inset-0" onClick={(e) => e.stopPropagation()} />

      <div
        ref={bubbleRef}
        className="absolute rounded-[12px] border border-line bg-surface p-3.5 shadow-lg"
        style={{
          width: bubbleW,
          left,
          ...(putBelow
            ? { top: box.top + box.height + GAP }
            : { bottom: viewportH - box.top + GAP }),
        }}
      >
        <div className="flex items-start justify-between gap-2">
          <p className="text-[13px] font-medium text-ink">{step.title}</p>
          <button
            type="button"
            onClick={onDone}
            aria-label="关闭引导"
            className="-mr-1 -mt-0.5 rounded-full p-1 text-ink-soft"
          >
            <X size={14} />
          </button>
        </div>

        <p className="mt-1.5 text-[12px] leading-5 text-ink-soft">{step.body}</p>

        <div className="mt-3 flex items-center justify-between">
          <span className="num text-[11px] text-ink-soft">
            {index + 1} / {steps.length}
          </span>
          <div className="flex items-center gap-2">
            {index > 0 ? (
              <button
                type="button"
                onClick={() => setIndex((i) => Math.max(0, i - 1))}
                className="text-[12px] text-ink-soft"
              >
                上一步
              </button>
            ) : (
              <button type="button" onClick={onDone} className="text-[12px] text-ink-soft">
                跳过
              </button>
            )}
            <Button
              size="sm"
              onClick={() => (last ? onDone() : setIndex((i) => Math.min(steps.length - 1, i + 1)))}
              className={cn(last && "px-4")}
            >
              {last ? "知道了" : "下一步"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
