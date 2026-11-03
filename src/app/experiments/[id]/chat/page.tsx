import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { makePageQuery } from "@/adapters/db/prisma/page-query";
import { requirePage } from "@/lib/page-auth";
import { ChatView } from "./chat-view";
import { getChatView } from "@/server/agent";

export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePage("SUBJECT");
  const { id } = await params;

  const experiment = await makePageQuery(prisma).findChatHeaderExperiment(id);
  if (!experiment) notFound();

  const initial = await getChatView(id, session.sub);

  return (
    <ChatView
      experimentId={experiment.id}
      initial={initial}
      experiment={{
        title: experiment.title,
        durationMin: experiment.durationMin,
        location: experiment.location,
        rewardText: experiment.rewardText,
        researcherName: experiment.researcherName,
      }}
    />
  );
}
