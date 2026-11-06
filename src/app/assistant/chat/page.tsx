import { requirePage } from "@/lib/page-auth";
import { getAssistantChatView } from "@/server/assistant-agent";
import { makeDefaultAssistantQuery } from "@/adapters/db/prisma/assistant-query";
import { buildAssistantBrief } from "@/application/assistant-overview";
import { ACTIVE_APPOINTMENT_STATUSES } from "@/lib/domain";
import { AssistantChatView } from "./chat-view";

/**
 * 门厅页 —— 「你想参加什么实验？」
 *
 * 这是被试端「助手」tab 的落点（方案 A：tab 直接进门厅）。
 *
 * 原先 tab 指向 /assistant（只读总览），门厅要再点一次才到 ——
 * 而总览页通往门厅的按钮只在「没有任何安排」时才渲染，结果约过一场的人
 * 反而找不到入口，只剩页脚一行 11px 小字。现在：
 *   助手 tab → 门厅（本页，顶部一条安排摘要，点开才是总览）
 *   撞车提醒  → 搬到「我的预约」（它本来就该在那儿）
 *
 * 摘要在这里算（服务端）：门厅是 tab 根页，列表数据本来就在服务端。
 * 只把「一句话 + 有没有撞车」传给客户端，不把整份预约塞进 props ——
 * 那会让每次对话重渲染都带着一堆用不到的时间对象。
 */
export default async function AssistantChatPage() {
  const session = await requirePage("SUBJECT");
  const [initial, brief] = await Promise.all([
    getAssistantChatView(session.sub),
    buildAssistantBrief(
      { query: makeDefaultAssistantQuery() },
      session.sub,
      [...ACTIVE_APPOINTMENT_STATUSES],
    ),
  ]);

  return (
    <AssistantChatView
      initial={initial}
      scheduleSummary={{
        headline: brief.headline,
        overlapCount: brief.overlaps.length,
        upcomingCount: brief.upcoming.length,
      }}
    />
  );
}
