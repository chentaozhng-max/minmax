"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarCheck,
  FlaskConical,
  House,
  MessageCircle,
  Plus,
  ShieldCheck,
  User,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";

type Tab = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** 主试端中间那颗凸起的"发布" */
  primary?: boolean;
};

const SUBJECT_TABS: Tab[] = [
  { href: "/", label: "首页", icon: House },
  { href: "/appointments", label: "我的预约", icon: CalendarCheck },
  { href: "/messages", label: "消息", icon: MessageCircle },
  { href: "/me", label: "我的", icon: User },
];

/** 主试端按招聘类 App 的排法：中间是凸起的发布按钮，左右各两个入口 */
const RESEARCHER_TABS: Tab[] = [
  { href: "/r/experiments", label: "实验", icon: FlaskConical },
  { href: "/r/messages", label: "消息", icon: MessageCircle },
  { href: "/r/experiments/new", label: "发布", icon: Plus, primary: true },
  { href: "/r/appeals", label: "申诉", icon: ShieldCheck },
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

          if (tab.primary) {
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-label="发布实验"
                className="group relative flex flex-1 flex-col items-center justify-end pb-2.5"
              >
                <span
                  className={cn(
                    "flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-moss text-white",
                    "shadow-[0_8px_18px_-6px_rgba(31,77,58,0.65)] ring-4 ring-surface",
                    "transition-transform duration-150 active:scale-95",
                  )}
                >
                  <Plus size={24} strokeWidth={2.4} />
                </span>
                <span className="mt-1 text-[11px] font-medium leading-none text-moss">
                  {tab.label}
                </span>
              </Link>
            );
          }

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
