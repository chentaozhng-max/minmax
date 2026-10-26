import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const buttonVariants = cva(
  "press inline-flex items-center justify-center gap-1.5 whitespace-nowrap font-medium transition-colors disabled:pointer-events-none disabled:opacity-45",
  {
    variants: {
      variant: {
        primary: "bg-moss text-white hover:bg-moss-deep",
        clay: "bg-clay text-white hover:bg-[#8f4726]",
        outline: "border border-line bg-surface text-ink hover:bg-mist",
        ghost: "text-ink-soft hover:bg-mist",
        danger: "border border-danger/30 bg-surface text-danger hover:bg-danger/5",
        quiet: "bg-mist text-ink hover:bg-line",
      },
      size: {
        lg: "h-11 rounded-pill px-5 text-[15px]",
        md: "h-9 rounded-lg px-3.5 text-[13px]",
        sm: "h-7 rounded-md px-2.5 text-xs",
        icon: "h-9 w-9 rounded-full",
      },
      block: { true: "w-full", false: "" },
    },
    defaultVariants: { variant: "primary", size: "md", block: false },
  },
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & { loading?: boolean };

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, block, loading, children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size, block }), className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <span className="text-[13px] opacity-80">处理中…</span> : children}
    </button>
  );
});
