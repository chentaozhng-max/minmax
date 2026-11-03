import { requirePage } from "@/lib/page-auth";
import { currentUser } from "@/lib/auth";
import { PublishBlocked } from "@/components/publish-blocked";
import { PublishAssistant } from "./publish-assistant";

/**
 * 发布助手 —— 主试侧「一句话写成招募信息」。
 *
 * 禁期里不必让人白聊一轮：进来直接是拦截页，和 /r/experiments/new 一致。
 */
export default async function PublishAssistantPage() {
  const session = await requirePage("RESEARCHER");
  const user = await currentUser();
  const now = new Date();

  if (user?.bannedUntil && user.bannedUntil.getTime() > now.getTime()) {
    return <PublishBlocked bannedUntil={user.bannedUntil} now={now} />;
  }

  return <PublishAssistant researcherName={session.name} />;
}
