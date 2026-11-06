/**
 * 越界计数的存放处 —— 内存里，按会话。
 *
 * ## 为什么必须挂在会话上，而不是「这一次请求」
 *
 * 一次请求里只会有**一个**用户消息、只跑一次范围判断 —— 如果计数跟着单次请求走，
 * 它就永远是 0，`> 1` 这个条件永远不成立，「连续第二次越界升硬话术」这条
 * 需求根本无法生效。所以「本轮」在这里的物理含义是**本次会话**。
 *
 * 这也是二二那句「总不能他一开始只是玩玩，弄得新开 session 都没法预约实验了」
 * 的自然读法：新开会话 = 新 key = 从 0 开始。
 *
 * ## 为什么不落库
 *
 * 二二明确「不加 schema 列」。而且落库本身就是错的 —— 一次好奇的试探
 * 会永久污染账号，而这条计数服务的是**体验**（别一直陪聊），
 * 不是安全边界。进程重启丢掉它没有任何后果。
 *
 * ## 为什么要有上限
 *
 * 这是模块级 Map，会话 id 只增不减会一路涨到内存里去。
 * 超过上限按插入顺序丢最旧的（`Map` 保证迭代顺序 = 插入顺序），
 * 够用且不需要引第三方 LRU。
 */

import type { StrikeCounter } from "@/domain/scope-guard";

/** 最多记多少个会话的计数。再多说明是长期跑着没重启，丢掉旧的也不影响体验 */
const MAX_ENTRIES = 500;

const store = new Map<string, StrikeCounter>();

/** 取某个会话当前的计数（没有就从 0 开始） */
export function getStrike(sessionId: string): StrikeCounter {
  return store.get(sessionId) ?? { outOfScope: 0 };
}

/** 写回某个会话的计数 */
export function setStrike(sessionId: string, counter: StrikeCounter): void {
  // 先删再插，让这个 key 变成「最新」—— 否则活跃会话会因为插入早而被优先淘汰
  store.delete(sessionId);
  store.set(sessionId, counter);

  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next();
    if (oldest.done) break;
    store.delete(oldest.value);
  }
}

/**
 * 清掉某个会话的计数。
 *
 * 用户**成功**做了一件正事（搜到实验、约上），说明他就是正常用户。
 * 这时候不该再留着「他刚才试探过两次」的记录。
 */
export function clearStrike(sessionId: string): void {
  store.delete(sessionId);
}

/** 测试用：清空整个存储 */
export function resetStrikeStore(): void {
  store.clear();
}

/** 测试用：当前记录了多少个会话 */
export function strikeStoreSize(): number {
  return store.size;
}
