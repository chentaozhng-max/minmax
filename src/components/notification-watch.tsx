"use client";

import { useEffect } from "react";
import { api } from "@/lib/api-client";
import { toast } from "@/components/toast";
import { diffUnread, unreadToastText } from "@/lib/unread-count";
import { useUnreadStore } from "@/lib/unread-store";

/** 轮询间隔。30 秒 = 演示时「等一下就弹」，同时对服务端只是每分钟 2 个 count 查询 */
const POLL_MS = 30_000;

/**
 * 站内「通知栏」：轮询未读数，**变多就弹一条 toast**，同时喂给 TabBar 的红点。
 *
 * 为什么是轮询不是 SSE：
 *   SSE 要长连接、断线重连、Next.js 额外配置，代码量十倍；
 *   这个场景 30 秒的延迟完全可以接受，省下的复杂度不值得换。
 *   （如果以后要「实时输入中」这类交互，再单独上 SSE 或 WebSocket。）
 *
 * 为什么比对放在 store 里而不是组件 state：
 *   TabBar 每个页面都会重新挂载，组件 state 会被重置，
 *   于是每次翻页都「首次加载」→ 不会误弹，但也会漏掉翻页期间到达的提醒。
 *   把上一次的值放进 store，跨页面连续。
 */
export function NotificationWatch() {
  const setUnread = useUnreadStore((s) => s.setUnread);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        const data = await api<{ unread: number }>("/api/me/notifications/unread");
        if (cancelled) return;

        const prev = useUnreadStore.getState().unread;
        const { notify, added } = diffUnread(prev, data.unread);
        if (notify) toast(unreadToastText(added));
        setUnread(data.unread);
      } catch {
        // 未登录 / 断网 / 服务重启都会走到这里。轮询失败不该弹错、
        // 也不该停掉 —— 下一轮自然重试。
      }
    };

    // 用 setTimeout 递归而不是 setInterval：请求慢的时候不会堆积。
    const loop = async () => {
      await tick();
      if (cancelled) return;
      timer = setTimeout(loop, POLL_MS);
    };
    void loop();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [setUnread]);

  return null;
}
