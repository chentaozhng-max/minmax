import { requirePage } from "@/lib/page-auth";
import { currentUser } from "@/lib/auth";
import { todayInShanghai } from "@/lib/time";
import { NewExperimentForm } from "./new-experiment-form";

/**
 * 发布实验页。
 *
 * 禁期与「今天」都在服务端算好再交给表单：
 *   - 禁期判定放在这里，点「发布」之前就能看到拦截页
 *   - 日期由服务端给，客户端和服务端不会因为跨零点渲染出不同的周
 */
export default async function NewExperimentPage() {
  await requirePage("RESEARCHER");
  const user = await currentUser();

  return (
    <NewExperimentForm
      today={todayInShanghai()}
      nowIso={new Date().toISOString()}
      bannedUntil={user?.bannedUntil?.toISOString() ?? null}
    />
  );
}
