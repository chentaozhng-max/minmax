import { loadThread } from "@/server/dm";

/** 给页面用的包装：出错时返回 null（页面转 404），避免把 ApiError 抛到渲染层 */
export async function initThreadView(userId: string, threadId: string) {
  try {
    return await loadThread(userId, threadId);
  } catch {
    return null;
  }
}
