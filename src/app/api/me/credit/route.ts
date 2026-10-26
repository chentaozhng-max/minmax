import { prisma } from "@/lib/prisma";
import { ok, handle } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { isBanned } from "@/lib/credit";

export const GET = handle(async () => {
  const user = await requireUser();
  const now = new Date();
  const events = await prisma.creditEvent.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return ok({
    creditScore: user.creditScore,
    noShowCount: user.noShowCount,
    bannedUntil: user.bannedUntil?.toISOString() ?? null,
    banned: isBanned(user.bannedUntil, now),
    role: user.role,
    events: events.map((e) => ({
      id: e.id,
      delta: e.delta,
      reason: e.reason,
      note: e.note,
      createdAt: e.createdAt.toISOString(),
    })),
  });
});
