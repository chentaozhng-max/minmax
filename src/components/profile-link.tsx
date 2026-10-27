import Link from "next/link";
import { User } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * 右上角「个人中心」入口。
 * 被试去 /me，主试去 /r/profile。
 */
export function ProfileLink({
  role,
  className,
}: {
  role: "SUBJECT" | "RESEARCHER";
  className?: string;
}) {
  const href = role === "RESEARCHER" ? "/r/profile" : "/me";

  return (
    <Link
      href={href}
      aria-label="个人中心"
      className={cn(
        "press mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-moss-tint text-moss",
        className,
      )}
    >
      <User size={17} strokeWidth={2} />
    </Link>
  );
}
