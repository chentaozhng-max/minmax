import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/cn";
import { BackButton } from "@/components/back-button";
import { ProfileLink } from "@/components/profile-link";

export function PageHeader({
  title,
  back,
  right,
  sticky = true,
  subtitle,
  profile,
}: {
  title: string;
  /** 传路径走 Link，传 "auto" 走浏览器历史 */
  back?: string;
  right?: React.ReactNode;
  sticky?: boolean;
  subtitle?: string;
  /** 右上角的个人中心入口 */
  profile?: { role: "SUBJECT" | "RESEARCHER" };
}) {
  return (
    <header
      className={cn(
        "z-30 flex h-12 items-center gap-1 border-b border-line bg-paper/95 px-2 backdrop-blur",
        sticky && "sticky top-0",
      )}
    >
      {back === "auto" ? (
        <BackButton />
      ) : back ? (
        <Link
          href={back}
          aria-label="返回"
          className="press flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink"
        >
          <ChevronLeft size={22} strokeWidth={1.9} />
        </Link>
      ) : (
        <span className="w-2" />
      )}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[16px] font-semibold leading-6 text-ink">{title}</h1>
        {subtitle ? <p className="truncate text-[11px] text-ink-soft">{subtitle}</p> : null}
      </div>
      {right ? <div className="flex shrink-0 items-center gap-1 pr-1">{right}</div> : null}
      {profile ? <ProfileLink role={profile.role} /> : null}
    </header>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/30 sm:items-center">
      <div className="absolute inset-0" onClick={onClose} aria-hidden />
      <div className="animate-rise-in relative w-full max-w-[480px] rounded-t-[16px] bg-surface px-4 pb-[calc(16px+env(safe-area-inset-bottom))] pt-4 sm:rounded-[16px] sm:pb-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-[13px] text-ink-soft"
            aria-label="关闭"
          >
            关闭
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
