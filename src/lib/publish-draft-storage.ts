/**
 * 发布草稿的本地交接。
 *
 * 发布助手在 `/r/experiments/assistant` 生成草稿，点「填入发布表单」后
 * 跳到 `/r/experiments/new` —— 两个页面之间只隔一次客户端跳转，
 * 用 sessionStorage 交接比塞 URL（太长）或建一张草稿表（要迁移）都轻。
 *
 * 只存一次：表单读走就删，避免下次「发布实验」时莫名其妙又填回旧内容。
 */
import type { ExperimentDraft } from "@/domain/experiment-draft";

const KEY = "psymatch:publish-draft";

export function savePublishDraft(draft: ExperimentDraft): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(draft));
  } catch {
    // 隐私模式下 sessionStorage 可能不可写：那就走手工填写，不能因此卡住发布
  }
}

export function readPublishDraft(): ExperimentDraft | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const rec = parsed as Record<string, unknown>;
    if (typeof rec.title !== "string") return null;
    if (!Array.isArray(rec.slots)) return null;
    return parsed as ExperimentDraft;
  } catch {
    return null;
  }
}

export function clearPublishDraft(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // 同上：清不掉也不影响，下次覆盖写即可
  }
}
