"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useUnreadStore } from "@/lib/unread-store";

/**
 * 「我的」页里的提醒入口。
 *
 * 为什么要做成 client 组件：页面是 server component，`unread` 在服务端渲出后就固定了。
 * 而 NotificationWatch 每 30 秒更新一次未读数 —— 不同步的话会出现
 * 「tab 红点已经 1，按钮还写着『提醒』」的错位，用户会以为红点点错了地方。
 *
 * 取数优先级：**store 里有值就用 store，没有才回落到服务端给的值**。
 * 这样首屏（store 还没加载完）不会闪一下「无未读」，之后又能实时跟上。
 */
export function ReminderEntry({ serverUnread }: { serverUnread: number }) {
  const storeUnread = useUnreadStore((s) => s.unread);
  const unread = storeUnread ?? serverUnread;

  return (
    <Link href="/me/notifications" className="block">
      <Button variant="outline" size="lg" block>
        提醒{unread > 0 ? `（${unread} 条未读）` : ""}
      </Button>
    </Link>
  );
}
