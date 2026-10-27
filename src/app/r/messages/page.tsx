import Link from "next/link";
import { requirePage } from "@/lib/page-auth";
import { listThreads } from "@/server/dm";
import { PageHeader } from "@/components/page-header";
import { TabBar } from "@/components/tab-bar";
import { EmptyState } from "@/components/experiment-card";
import { formatDateTimeCN } from "@/lib/time";
import { ThreadList } from "@/app/messages/thread-list";

export default async function ResearcherMessagesPage() {
  const session = await requirePage("RESEARCHER");
  const threads = await listThreads(session.sub, "RESEARCHER");

  return (
    <main className="shell tabbar-space">
      <PageHeader title="消息" back="auto" profile={{ role: "RESEARCHER" }} />

      <div className="px-4 pt-3">
        {threads.length === 0 ? (
          <EmptyState
            title="还没有被试找你"
            description="被试在实验详情页点你的头像就能直接发消息，消息会出现在这里。"
          />
        ) : (
          <ThreadList threads={threads} hrefBase="/messages" emptyText="还没有消息，点开打个招呼" />
        )}

        <p className="mt-4 text-center text-[11px] leading-5 text-ink-soft">
          这里是被试和你的直接对话。排期撮合在实验详情页的「立即预约」里，由助手完成。
        </p>
      </div>

      <TabBar role="RESEARCHER" />
    </main>
  );
}
