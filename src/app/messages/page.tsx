import { prisma } from "@/lib/prisma";
import { requirePage } from "@/lib/page-auth";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { TabBar } from "@/components/tab-bar";
import { EmptyState } from "@/components/experiment-card";
import { parseMessages } from "@/lib/domain";
import { formatDateTimeCN } from "@/lib/time";
import { Button } from "@/components/ui/button";

const STATE_LABEL: Record<string, string> = {
  COLLECTING_AVAILABILITY: "在问你的空闲时间",
  PROPOSED: "已给出候选时段",
  BOOKED: "已约上",
  WAITLIST: "已登记候补",
  ESCALATED: "已给主试留言",
  CLOSED: "已结束",
};

export default async function MessagesPage() {
  const session = await requirePage("SUBJECT");
  const sessions = await prisma.chatSession.findMany({
    where: { subjectId: session.sub },
    include: { experiment: { include: { researcher: true } } },
    orderBy: { updatedAt: "desc" },
  });

  return (
    <main className="shell tabbar-space">
      <PageHeader title="消息" back="/" />
      <div className="px-4 pt-3">
        {sessions.length === 0 ? (
          <EmptyState
            title="还没有和排期助手聊过"
            description="在任一实验详情页点「立即预约」，就会开一条对话。"
            action={
              <Link href="/">
                <Button variant="outline" size="md">
                  去找实验
                </Button>
              </Link>
            }
          />
        ) : (
          <div className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
            {sessions.map((s) => {
              const messages = parseMessages(s.messages);
              const last = [...messages].reverse().find((m) => m.content.trim());
              return (
                <Link
                  key={s.id}
                  href={`/experiments/${s.experimentId}/chat`}
                  className="flex gap-3 px-3.5 py-3 active:bg-mist"
                >
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-moss-tint text-[13px] font-semibold text-moss">
                    {s.experiment.researcher.name.slice(0, 1)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[14px] font-medium text-ink">
                        {s.experiment.title}
                      </span>
                      <span className="shrink-0 text-[10px] text-ink-soft">
                        {formatDateTimeCN(s.updatedAt)}
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate text-[12px] text-ink-soft">
                      {last?.content ?? "还没有对话"}
                    </span>
                    <span className="mt-1 inline-flex items-center gap-1 text-[10px] text-moss">
                      {STATE_LABEL[s.state] ?? s.state}
                      <span className="text-line">|</span>
                      <span className="num text-ink-soft">
                        {s.experiment.durationMin} 分钟 · {s.experiment.rewardText}
                      </span>
                    </span>
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
      <TabBar role="SUBJECT" />
    </main>
  );
}
