import Link from "next/link";
import { CalendarDays, ChevronRight, FlaskConical, ShieldCheck } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requirePage } from "@/lib/page-auth";
import { PageHeader } from "@/components/page-header";
import { CreditRing } from "@/components/credit-ring";
import {
  appointmentStatusLabel,
  creditReasonLabel,
  type AppointmentStatus,
  type CreditReason,
} from "@/lib/domain";
import { formatDateTimeCN, formatSlotRange } from "@/lib/time";

export default async function CreditDetailPage() {
  const session = await requirePage();
  const user = await prisma.user.findUnique({ where: { id: session.sub } });
  if (!user) return null;

  const events = await prisma.creditEvent.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const appointmentIds = events
    .map((event) => event.appointmentId)
    .filter((id): id is string => Boolean(id));
  const appointments = appointmentIds.length
    ? await prisma.appointment.findMany({
        where: { id: { in: appointmentIds } },
        include: { experiment: true, slot: true },
      })
    : [];
  const appointmentMap = new Map(appointments.map((appointment) => [appointment.id, appointment]));
  const banned = user.bannedUntil && user.bannedUntil.getTime() > Date.now();

  return (
    <main className="shell min-h-dvh pb-8">
      <PageHeader title="信誉分明细" back="auto" />

      <div className="px-4 pt-4">
        <section className="rounded-card border border-line bg-surface p-4">
          <div className="flex items-center gap-4">
            <CreditRing
              score={user.creditScore}
              size={88}
              label={user.role === "RESEARCHER" ? "主试信誉" : "信誉分"}
            />
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-semibold text-ink">当前信誉良好度</p>
              <p className="mt-1 text-[12px] leading-5 text-ink-soft">
                满分 100 分。按时完成实验可加分，未到场或临近开始取消会扣分。
              </p>
              <p className="num mt-2 text-[12px] text-ink-soft">
                累计未到场 {user.noShowCount} 次
              </p>
            </div>
          </div>
          {banned ? (
            <p className="mt-3 rounded-[6px] bg-[#f9e9e6] px-3 py-2 text-[12px] leading-5 text-danger">
              当前处于限制期，{formatDateTimeCN(user.bannedUntil as Date)} 后解除。
            </p>
          ) : null}
        </section>

        <section className="mt-5">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="section-title">全部变动</h2>
            <span className="num text-[11px] text-ink-soft">共 {events.length} 条</span>
          </div>

          {events.length === 0 ? (
            <div className="rounded-card border border-line bg-surface px-4 py-10 text-center">
              <ShieldCheck size={28} strokeWidth={1.5} className="mx-auto text-moss" />
              <p className="mt-3 text-[14px] font-medium text-ink">还没有信誉分变动</p>
              <p className="mt-1 text-[12px] text-ink-soft">完成实验或发生取消后，记录会显示在这里</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {events.map((event) => {
                const appointment = event.appointmentId
                  ? appointmentMap.get(event.appointmentId)
                  : undefined;
                return (
                  <Link
                    id={`event-${event.id}`}
                    key={event.id}
                    href={`/me/credit/${event.id}`}
                    className="block scroll-mt-16 rounded-card border border-line bg-surface p-3.5 active:bg-mist"
                  >
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <h3 className="text-[14px] font-semibold text-ink">
                          {creditReasonLabel[event.reason as CreditReason] ?? event.reason}
                        </h3>
                        <p className="num mt-1 text-[11px] text-ink-soft">
                          {formatDateTimeCN(event.createdAt)}
                        </p>
                      </div>
                      <span
                        className={`num shrink-0 text-[20px] font-semibold ${
                          event.delta > 0 ? "text-moss" : "text-danger"
                        }`}
                      >
                        {event.delta > 0 ? `+${event.delta}` : event.delta}
                      </span>
                    </div>

                    <p className="mt-3 rounded-[6px] bg-mist/70 px-3 py-2 text-[12px] leading-5 text-ink-soft">
                      {event.note ?? "系统根据本次实验的履约情况自动结算"}
                    </p>

                    {appointment ? (
                      <div className="mt-3 space-y-2 border-t border-line pt-3">
                        <p className="flex items-start gap-2 text-[12px] leading-5 text-ink">
                          <FlaskConical size={15} className="mt-0.5 shrink-0 text-ink-soft" />
                          <span>{appointment.experiment.title}</span>
                        </p>
                        <p className="num flex items-start gap-2 text-[12px] leading-5 text-ink-soft">
                          <CalendarDays size={15} className="mt-0.5 shrink-0" />
                          <span>{formatSlotRange(appointment.slot.startAt, appointment.slot.endAt)}</span>
                        </p>
                        <p className="text-[11px] text-ink-soft">
                          预约状态：{appointmentStatusLabel[appointment.status as AppointmentStatus] ?? appointment.status}
                        </p>
                      </div>
                    ) : null}

                    <p className="mt-3 flex items-center justify-end gap-1 text-[11px] text-moss">
                      查看详情 <ChevronRight size={13} />
                    </p>
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        <section className="mt-5 rounded-card border border-line bg-surface p-4">
          <h2 className="text-[14px] font-semibold text-ink">信誉分规则</h2>
          <dl className="mt-3 space-y-2.5 text-[12px] leading-5">
            <div className="flex justify-between gap-4">
              <dt className="text-ink-soft">按时到场并完成实验</dt>
              <dd className="num font-semibold text-moss">+1</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-soft">未到场或主试临近开始取消</dt>
              <dd className="num font-semibold text-danger">-2</dd>
            </div>
          </dl>
          <p className="mt-3 border-t border-line pt-3 text-[11px] leading-5 text-ink-soft">
            距实验开始 24 小时以上取消不扣分。累计未到场 1–3 次，每次限制报名 1 天；第 4 次起每次限制 7 天。对未到场记录有异议，可在预约记录中发起申诉。
          </p>
        </section>
      </div>
    </main>
  );
}
