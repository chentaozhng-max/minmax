import { prisma } from "@/lib/prisma";
import { ok, handle } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { parseMessages } from "@/lib/domain";

/** 被试的 Agent 会话列表（按实验分组） */
export const GET = handle(async () => {
  const user = await requireUser();
  const sessions = await prisma.chatSession.findMany({
    where: { subjectId: user.id },
    include: { experiment: { include: { researcher: true } } },
    orderBy: { updatedAt: "desc" },
  });

  return ok(
    sessions.map((s) => {
      const messages = parseMessages(s.messages);
      const last = [...messages].reverse().find((m) => m.content.trim().length > 0);
      return {
        id: s.id,
        experimentId: s.experimentId,
        state: s.state,
        updatedAt: s.updatedAt.toISOString(),
        lastMessage: last?.content ?? "还没有对话",
        lastRole: last?.role ?? "assistant",
        experiment: {
          id: s.experiment.id,
          title: s.experiment.title,
          rewardText: s.experiment.rewardText,
          durationMin: s.experiment.durationMin,
          location: s.experiment.location,
          researcherName: s.experiment.researcher.name,
        },
        messageCount: messages.length,
      };
    }),
  );
});
