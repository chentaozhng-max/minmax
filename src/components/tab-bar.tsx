"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarCheck, FlaskConical, House, Inbox, MessageCircle, PlusCircle, User } from "lucide-react";
import { cn } from "@/lib/cn";

const SUBJECT_TABS = [
  { href: "/", label: "首页", icon: House },
  { href: "/appointments", label: "我的预约", icon: CalendarCheck },
  { href: "/messages", label: "消息", icon: MessageCircle },
  { href: "/me", label: "我的", icon: User },
];

const RESEARCHER_TABS = [
  { href: "/r/experiments", label: "我的实验", icon: FlaskConical },
  { href: "/r/experiments/new", label: "发布", icon: PlusCircle },
  { href: "/r/messages", label: "消息", icon: MessageCircle },
  { href: "/r/profile", label: "我的", icon: User },
];

export function TabBar({ role }: { role: "SUBJECT" | "RESEARCHER" }) {
  const pathname = usePathname();
  const tabs = role === "RESEARCHER" ? RESEARCHER_TABS : SUBJECT_TABS;

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-line bg-surface/95 backdrop-blur">
      <div className="safe-bottom mx-auto flex h-14 w-full max-w-[480px] items-stretch">
        {tabs.map((tab) => {
          const active =
            tab.href === "/"
              ? pathname === "/"
              : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px]",
                active ? "text-moss" : "text-ink-soft",
              )}
            >
              <Icon size={20} strokeWidth={active ? 2.1 : 1.7} />
              <span className={active ? "font-medium" : ""}>{tab.label}</span>
              {active ? (
                <span className="absolute top-0 h-[2px] w-7 rounded-full bg-moss" />
              ) : null}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
