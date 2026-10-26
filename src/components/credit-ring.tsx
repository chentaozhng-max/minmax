import { cn } from "@/lib/cn";

/**
 * 信誉分环形。分值本身就是这个产品最重要的自我认知指标，所以给了它一个独立构件，
 * 而不是塞进文字行里。
 */
export function CreditRing({
  score,
  size = 96,
  label = "信誉分",
  className,
}: {
  score: number;
  size?: number;
  label?: string;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, score));
  const stroke = size >= 80 ? 7 : 5;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped / 100);
  const tone = clamped < 60 ? "var(--danger)" : clamped < 80 ? "var(--warn)" : "var(--moss)";

  return (
    <div
      className={cn("relative shrink-0", className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${label} ${clamped} 分，满分 100`}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--line)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={tone}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset .6s cubic-bezier(.2,.7,.3,1)" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className="num font-semibold leading-none"
          style={{ fontSize: size >= 80 ? 26 : 17, color: tone }}
        >
          {clamped}
        </span>
        <span className="mt-1 text-[10px] text-ink-soft">{label}</span>
      </div>
    </div>
  );
}
