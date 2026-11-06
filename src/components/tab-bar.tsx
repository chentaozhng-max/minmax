"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  CalendarCheck,
  FlaskConical,
  House,
  MessageCircle,
  Plus,
  ShieldCheck,
  Sparkles,
  User,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useUnreadStore } from "@/lib/unread-store";

type Tab = {
  href: string;
  label: string;
  icon: LucideIcon;
  /**
   * 这颗 tab 额外认领的路径。
   *
   * 「助手」tab 指向 `/assistant/chat`（门厅），但总览页 `/assistant` 是它的
   * 子级页面（从门厅顶部摘要点进去）。不加这一条的话，进到总览页时底部
   * 一个 tab 都不高亮 —— 用户会以为自己已经离开了「助手」这一栏。
   */
  also?: string[];
  /** 主试端中间那颗凸起的"发布" */
  primary?: boolean;
  /**
   * 这颗 tab 是否显示未读红点。
   *
   * 只标在「我的」上：「我的」页里已经有「提醒（N 条未读）」入口，
   * 红点指过去用户点一下就到，不会指错路。
   * 不标在「消息」上——那是和主试的直接对话，和实验提醒是两件事，
   * 红点挂在那边会让用户点进去发现"没有新消息"，红点就失信了。
   */
  badge?: boolean;
};

const SUBJECT_TABS: Tab[] = [
  { href: "/", label: "首页", icon: House },
  { href: "/appointments", label: "我的预约", icon: CalendarCheck },
  { href: "/assistant/chat", label: "助手", icon: Sparkles, also: ["/assistant"] },
  { href: "/messages", label: "消息", icon: MessageCircle },
  { href: "/me", label: "我的", icon: User, badge: true },
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
  // 主试端没有提醒这回事，直接不订阅 store（省掉无意义的 re-render）
  const unread = useUnreadStore((s) => s.unread);
  const showBadge = role === "SUBJECT" && unread !== null && unread > 0;

  /**
   * 「点了正在去哪」。
   *
   * 这些页面都是服务端渲染的，点击到内容出现之间隔着一次网络往返；
   * 服务端冷启动时这段能有几秒。这段时间导航栏如果毫无变化，用户会以为
   * 没点上，于是反复戳同一个 tab。这里把目标 tab 立刻染成激活色 +
   * 一条呼吸中的指示条，明确「已经在路上了」。
   */
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  // 路径变了 = 到站了
  useEffect(() => {
    setPendingHref(null);
  }, [pathname]);

  // 兜底：断网 / 服务端报错时导航不会完成，别让「加载中」永远挂着
  useEffect(() => {
    if (!pendingHref) return;
    const timer = setTimeout(() => setPendingHref(null), 8000);
    return () => clearTimeout(timer);
  }, [pendingHref]);

  return (
    <nav
      data-tour="tabbar"
      className="fixed bottom-0 left-0 right-0 z-40 border-t border-line bg-surface/95 backdrop-blur"
    >
      <div className="safe-bottom mx-auto flex h-14 w-full max-w-[480px] items-stretch">
        {tabs.map((tab) => {
          const active =
            tab.href === "/"
              ? pathname === "/"
              : pathname === tab.href ||
                pathname.startsWith(`${tab.href}/`) ||
                (tab.also ?? []).some(
                  (p) => pathname === p || pathname.startsWith(`${p}/`),
                );

          const busy = !active && pendingHref === tab.href;

          if (tab.primary) {
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-label="发布实验"
                onClick={() => setPendingHref(tab.href)}
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
              aria-busy={busy || undefined}
              onClick={() => {
                if (!active) setPendingHref(tab.href);
              }}
              className={cn(
                "relative flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px]",
                // 正在去的那一颗也染成激活色：点下去立刻有回应，不用等页面到
                active || busy ? "text-moss" : "text-ink-soft",
              )}
            >
              <Icon
                size={20}
                strokeWidth={active ? 2.1 : 1.7}
                className={busy ? "animate-pulse" : undefined}
              />
              <span className={active || busy ? "font-medium" : ""}>{tab.label}</span>
              {tab.badge && showBadge ? (
                // 数字 ≤ 9 显示数字，更多就显示 9+（红点太多位数会撑破 56px 的 tab）
                <span
                  className="num absolute right-1/2 top-1 ml-3 flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-danger px-1 text-[9px] font-semibold leading-none text-white"
                  aria-label={`${unread} 条未读提醒`}
                >
                  {unread > 9 ? "9+" : unread}
                </span>
              ) : null}
              {busy ? (
                <span className="absolute top-0 h-[2px] w-7 animate-pulse rounded-full bg-moss/50" />
              ) : active ? (
                <span className="absolute top-0 h-[2px] w-7 rounded-full bg-moss" />
              ) : null}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
