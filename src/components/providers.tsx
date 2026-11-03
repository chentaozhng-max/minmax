"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { NotificationWatch } from "@/components/notification-watch";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            refetchOnWindowFocus: false,
            staleTime: 10_000,
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      {/*
        挂在 Provider 里而不是某个页面里：提醒要跨页面持续轮询，
        挂到页面上的话每次路由切换都会重新挂载 → 计时器重置 → 翻页期间来的提醒会漏。
        未登录时它只会拿到 401（静默吃掉），不产生任何可见副作用。
      */}
      <NotificationWatch />
      {children}
    </QueryClientProvider>
  );
}
