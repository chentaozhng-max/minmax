import { prisma } from "@/lib/prisma";
import { ok, handle } from "@/lib/http";
import { requireRole } from "@/lib/auth";

export const GET = handle(async () => {
  const researcher = await requireRole("RESEARCHER");
  const now = new Date();

  const [pending, resolved] = await Promise.all([
    prisma.appointment.findMany({
      where: {
        appealStatus: "PENDING",
        experiment: { researcherId: researcher.id },
      },
      include: { subject: true, slot: true, experiment: true },
      orderBy: { appealAt: "asc" },
    }),
    prisma.appointment.findMany({
      where: {
        appealStatus: { in: ["UPHELD", "REJECTED"] },
        experiment: { researcherId: researcher.id },
      },
      include: { subject: true, slot: true, experiment: true },
      orderBy: { appealResolvedAt: "desc" },
      take: 20,
    }),
  ]);

  const map = (a: (typeof pending)[number]) => ({
    id: a.id,
    appealStatus: a.appealStatus,
    appealAt: a.appealAt?.toISOString() ?? null,
    appealNote: a.appealNote,
    appealResolvedAt: a.appealResolvedAt?.toISOString() ?? null,
    autoResolveAt: a.appealAt ? new Date(a.appealAt.getTime() + 48 * 3600 * 1000).toISOString() : null,
    overdue: a.appealAt ? now.getTime() > a.appealAt.getTime() + 48 * 3600 * 1000 : false,
    subject: {
      id: a.subject.id,
      name: a.subject.name,
      school: a.subject.school,
      creditScore: a.subject.creditScore,
      studentVerified: a.subject.studentVerified,
      noShowCount: a.subject.noShowCount,
    },
    experiment: { id: a.experiment.id, title: a.experiment.title },
    slot: {
      startAt: a.slot.startAt.toISOString(),
      endAt: a.slot.endAt.toISOString(),
    },
  });

  return ok({ pending: pending.map(map), resolved: resolved.map(map) });
});
