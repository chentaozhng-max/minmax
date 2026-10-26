import * as React from "react";
import { cn } from "@/lib/cn";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          "h-11 w-full rounded-[10px] border border-line bg-surface px-3 text-[15px] text-ink",
          "outline-none transition-colors placeholder:text-[#9aa5a0] focus:border-moss",
          "disabled:bg-mist disabled:text-ink-soft",
          className,
        )}
        {...props}
      />
    );
  },
);

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(
        "w-full resize-none rounded-[10px] border border-line bg-surface px-3 py-2.5 text-[15px] leading-6 text-ink",
        "outline-none transition-colors placeholder:text-[#9aa5a0] focus:border-moss",
        className,
      )}
      {...props}
    />
  );
});

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline justify-between">
        <span className="text-[13px] font-medium text-ink">{label}</span>
        {hint ? <span className="text-2xs text-ink-soft">{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}
