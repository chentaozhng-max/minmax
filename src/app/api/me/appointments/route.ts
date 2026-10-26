import { prisma } from "@/lib/prisma";
import { ok, handle } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { appointmentGroupOf } from "@/server/experiments";
import { ACTIVE_APPOINTMENT_STATUSES, type AppointmentStatus } from "@/lib/domain";

export const GET = handle(async () => {
  const user = await requireUser();
  const now = new Date();
  const appointments = await prisma.appointment.findMany({
    where: { subjectId: user.id },
    include: { slot: true, experiment: { include: { researcher: true } } },
    orderBy: { slot: { startAt: "asc" } },
  });

  return ok(
    appointments.map((a) => ({
      id: a.id,
      status: a.status,
      group: appointmentGroupOf(a.status as AppointmentStatus),
      appealStatus: a.appealStatus,
      appealAt: a.appealAt?.toISOString() ?? null,
      checkedInAt: a.checkedInAt?.toISOString() ?? null,
      conflict: false,
      canCheckIn:
        a.status === "CONFIRMED" &&
        now.getTime() >= a.slot.startAt.getTime() - 30 * 60 * 1000 &&
        now.getTime() <= a.slot.endAt.getTime(),
      canCancel:
        ACTIVE_APPOINTMENT_STATUSES.includes(a.status as AppointmentStatus) &&
        a.slot.startAt.getTime() - now.getTime() >= 12 * 60 * 60 * 1000,
      canAppeal:
        a.status === "CHECKED_IN" &&
        !a.appealStatus &&
        (a.checkedInAt?.getTime() ?? 0) + 24 * 60 * 60 * 1000 >= now.getTime(),
      slot: {
        id: a.slot.id,
        startAt: a.slot.startAt.toISOString(),
        endAt: a.slot.endAt.toISOString(),
      },
      experiment: {
        id: a.experiment.id,
        title: a.experiment.title,
        location: a.experiment.location,
        rewardText: a.experiment.rewardText,
        durationMin: a.experiment.durationMin,
        researcher: {
          id: a.experiment.researcher.id,
          name: a.experiment.researcher.name,
          school: a.experiment.researcher.school,
        },
      },
    })),
  );
});
