/**
 * 未读数的「变化判定」—— 纯函数。
 *
 * 为什么单独拿出来：轮询每 30 秒回来一次，但**只有变多才该打扰用户**。
 * 这个判断有两个容易写错的边界，都靠单测钉住：
 *   1. 首次加载 prev 为 null —— 不能把已有的历史未读当成「刚来的新消息」弹一遍
 *   2. 用户点了「全部已读」后数字变小 —— 更不能弹
 *
 * 组件里只负责「什么时候调用」，不负责「调用完该不该响」，两件事分开才能测。
 */

export type UnreadTransition = {
  /** 是否应该弹提示 */
  notify: boolean;
  /** 比上次多了几条（notify 为 false 时恒为 0） */
  added: number;
};

/**
 * 比较上一次和这一次的未读数。
 *
 * @param prev 上一次的值；null 表示还没加载过
 * @param next 这一次的值
 */
export function diffUnread(prev: number | null, next: number): UnreadTransition {
  if (prev === null) return { notify: false, added: 0 };
  const added = next - prev;
  if (added <= 0) return { notify: false, added: 0 };
  return { notify: true, added };
}

/**
 * 提示文案。
 *
 * 刻意不说「你有 N 条新提醒」以外的信息：用户点进去就能看到内容，
 * toast 只是「有东西来了」的信号，不该抢正文的活。
 */
export function unreadToastText(added: number): string {
  return added === 1 ? "你有 1 条新的实验提醒" : `你有 ${added} 条新的实验提醒`;
}
