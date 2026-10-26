import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requirePage } from "@/lib/page-auth";
import { ChatView } from "./chat-view";
import { getChatView } from "@/server/agent";

export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePage("SUBJECT");
  const { id } = await params;

  const experiment = await prisma.experiment.findUnique({
    where: { id },
    include: { researcher: true },
  });
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
        researcherName: experiment.researcher.name,
      }}
    />
  );
}
