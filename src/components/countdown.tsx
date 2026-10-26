"use client";

import { useEffect, useState } from "react";
import { formatCountdownClock } from "@/lib/time";
import { cn } from "@/lib/cn";

/** 倒计时。首帧不渲染数值，避免服务端/客户端时间差导致 hydration 不一致 */
export function Countdown({
  target,
  prefix = "",
  className,
}: {
  target: string;
  prefix?: string;
  className?: string;
}) {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    const tick = () => {
      const diff = new Date(target).getTime() - Date.now();
      setText(formatCountdownClock(diff));
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [target]);

  return (
    <span className={cn("num tabular-nums", className)}>
      {prefix}
      {text ?? "--:--:--"}
    </span>
  );
}
