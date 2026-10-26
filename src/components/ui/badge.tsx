import { cn } from "@/lib/cn";

/** 学生认证徽章：所有展示姓名的位置都跟在名字后面 */
export function VerifiedBadge({
  verified,
  className,
}: {
  verified: boolean;
  className?: string;
}) {
  if (!verified) return null;
  return (
    <span
      className={cn(
        "chip border border-verify/25 bg-verify-tint text-[11px] font-medium text-verify align-middle",
        className,
      )}
      title="已完成学生认证"
    >
      已认证
    </span>
  );
}

export function StatusPill({
  tone,
  children,
}: {
  tone: "moss" | "clay" | "warn" | "danger" | "grey" | "verify";
  children: React.ReactNode;
}) {
  const map: Record<string, string> = {
    moss: "bg-moss-tint text-moss",
    clay: "bg-clay-tint text-clay",
    warn: "bg-[#f8efdd] text-warn",
    danger: "bg-[#f9e9e6] text-danger",
    grey: "bg-mist text-ink-soft",
    verify: "bg-verify-tint text-verify",
  };
  return <span className={cn("chip", map[tone])}>{children}</span>;
}
