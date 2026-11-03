import { requirePage } from "@/lib/page-auth";
import { getAssistantChatView } from "@/server/assistant-agent";
import { AssistantChatView } from "./chat-view";

/**
 * 门厅页 —— 「你想参加什么实验？」
 *
 * 与 `/assistant` 的分工：
 *   /assistant      只读总览（我的安排、撞车）
 *   /assistant/chat 对话找实验（本页）
 *
 * 为什么另开一页而不是塞进 /assistant：
 * 总览页是 server component，信息密度已经很高；375 宽的手机上再加一个输入框，
 * 两件事都做不好。分开之后各自都能演进。
 */
export default async function AssistantChatPage() {
  const session = await requirePage("SUBJECT");
  const initial = await getAssistantChatView(session.sub);

  return <AssistantChatView initial={initial} />;
}
