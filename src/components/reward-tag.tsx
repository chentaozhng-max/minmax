import { cn } from "@/lib/cn";
import { rewardAmountText } from "@/lib/reward";

/**
 * 奖励金标。
 * 被试关心的第一件事就是"这活儿给多少钱"，所以不摆一个孤零零的数字，
 * 而是做成一张小牌子：「奖励 / ¥30」上下两行，浅赭底 + 赭石色数字。
 */
export function RewardTag({ text, className }: { text: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 flex-col items-end rounded-[7px] bg-clay-tint px-2 py-1",
        className,
      )}
    >
      <span className="text-[10px] leading-[13px] text-clay">奖励</span>
      <span className="num text-[14px] font-semibold leading-[19px] text-clay">
        {rewardAmountText(text)}
      </span>
    </span>
  );
}

/** 行内版本：「奖励 ¥30」，跟地点、时长这些信息排在一行时用 */
export function RewardInline({
  text,
  className,
  amountClassName,
}: {
  text: string;
  className?: string;
  amountClassName?: string;
}) {
  return (
    <span className={cn("inline-flex items-baseline gap-1 whitespace-nowrap", className)}>
      <span className="text-[11px] text-ink-soft">奖励</span>
      <span className={cn("num font-medium text-clay", amountClassName)}>
        {rewardAmountText(text)}
      </span>
    </span>
  );
}
