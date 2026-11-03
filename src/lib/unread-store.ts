"use client";

import { create } from "zustand";

/**
 * 未读数的最小共享状态。
 *
 * 为什么用 store 而不是 props / context：
 *   1. 写的人（NotificationWatch 轮询）和读的人（TabBar 红点）在**组件树的两处**，
 *      中间隔着若干个 server component，props 传不下去
 *   2. TabBar 被 14 个页面调用，改签名 = 改 14 处；store 让它一行都不用动
 *
 * 只放一个数字。**不缓存列表**——列表归 react-query 管，
 * 两边都缓存同一份数据就会出现「红点清了但列表还显示未读」。
 */
type UnreadStore = {
  /** null = 还没拿到过（首屏渲染时不该闪一下红点） */
  unread: number | null;
  setUnread: (n: number) => void;
};

export const useUnreadStore = create<UnreadStore>((set) => ({
  unread: null,
  setUnread: (unread) => set({ unread }),
}));

/** 供非组件代码读取当前值 */
export function currentUnread(): number | null {
  return useUnreadStore.getState().unread;
}
