import Link from "next/link";
import { notFound } from "next/navigation";
import { MapPin, Clock3, CalendarClock, Users } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requirePage } from "@/lib/page-auth";
import { currentUser } from "@/lib/auth";
import { checkEligibility } from "@/lib/credit";
import { VerifiedBadge, StatusPill } from "@/components/ui/badge";
import { PageHeader } from "@/components/page-header";
import { SlotGrid } from "@/components/slot-grid";
import { formatDateTimeCN, formatDayCN, formatHM } from "@/lib/time";
import { remainingOf } from "@/server/experiments";
import { BookCta } from "./book-cta";

export default async function ExperimentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePage("SUBJECT");
  const { id } = await params;
  const now = new Date();

  const experiment = await prisma.experiment.findUnique({
    where: { id },
    include: { researcher: true, slots: { orderBy: { startAt: "asc" } } },
  });
  if (!experiment) notFound();

  const user = await currentUser();
  const openSlots = experiment.slots.filter(
    (s) => s.startAt.getTime() > now.getTime() && remainingOf(s) > 0,
  );
  const eligibility = user
    ? checkEligibility(
        {
          bannedUntil: user.bannedUntil,
          creditScore: user.creditScore,
          studentVerified: user.studentVerified,
          minCreditScore: experiment.minCreditScore,
          needsVerification: experiment.needsVerification,
        },
        now,
      )
    : ({ ok: false, reason: "VERIFY" as const, message: "请先登录" });

  const mine = user
    ? await prisma.appointment.findFirst({
        where: {
          experimentId: id,
          subjectId: user.id,
          status: {
            in: [
              "PENDING_SUBJECT_CONFIRM",
              "AWAITING_RESEARCHER",
              "CONFIRMED",
              "CHECKED_IN",
            ],
          },
        },
        include: { slot: true },
      })
    : null;

  const slotViews = openSlots.map((s) => ({
    id: s.id,
    startAt: s.startAt.toISOString(),
    endAt: s.endAt.toISOString(),
    capacity: s.capacity,
    bookedCount: s.bookedCount,
    remaining: remainingOf(s),
    label: `${formatDayCN(s.startAt)} ${formatHM(s.startAt)}-${formatHM(s.endAt)}`,
  }));

  const closed = experiment.status !== "PUBLISHED";
  const deadlinePassed = experiment.signupDeadline.getTime() <= now.getTime();

  return (
    <main className="shell actionbar-space">
      <PageHeader title="实验详情" back="/" />

      <div className="px-4 pt-3">
        <h2 className="text-[21px] font-semibold leading-[29px] tracking-[-0.01em] text-ink">
          {experiment.title}
        </h2>

        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink-soft">
          <Link href={`/researchers/${experiment.researcher.id}`} className="text-[13px] font-medium text-ink">
            {experiment.researcher.name}
          </Link>
          <VerifiedBadge verified={experiment.researcher.studentVerified} />
          <span className="text-line">|</span>
          <span>{experiment.researcher.school ?? "未填写学校"}</span>
          {experiment.researcher.department ? (
            <span className="text-ink-soft/80">{experiment.researcher.department}</span>
          ) : null}
          <span className="num">信誉 {experiment.researcher.creditScore}</span>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          <StatusPill tone="clay">{experiment.rewardText}</StatusPill>
          <StatusPill tone="grey">{experiment.durationMin} 分钟</StatusPill>
          <StatusPill tone="grey">
            {experiment.type === "GROUP" ? `团体 ${experiment.groupSize ?? 2} 人` : "一对一"}
          </StatusPill>
          {experiment.minCreditScore > 0 ? (
            <StatusPill tone="warn">信誉 ≥ {experiment.minCreditScore}</StatusPill>
          ) : null}
          {experiment.needsVerification ? <StatusPill tone="verify">需学生认证</StatusPill> : null}
        </div>

        <div className="mt-4 space-y-2 rounded-card border border-line bg-surface p-3.5">
          <Row icon={<MapPin size={13} strokeWidth={1.8} />} label="地点" value={experiment.location} />
          <Row
            icon={<CalendarClock size={13} strokeWidth={1.8} />}
            label="报名截止"
            value={formatDateTimeCN(experiment.signupDeadline)}
          />
          <Row
            icon={<Clock3 size={13} strokeWidth={1.8} />}
            label="剩余时段"
            value={`${openSlots.length} 段可约`}
          />
          <Row
            icon={<Users size={13} strokeWidth={1.8} />}
            label="剩余名额"
            value={`${openSlots.reduce((n, s) => n + remainingOf(s), 0)} 个`}
          />
        </div>

        <section className="mt-5">
          <h3 className="section-title mb-2">实验说明</h3>
          <p className="whitespace-pre-line text-[14px] leading-[24px] text-ink">
            {experiment.description}
          </p>
        </section>

        {experiment.requirements ? (
          <section className="mt-4">
            <h3 className="section-title mb-2">参加要求</h3>
            <p className="text-[14px] leading-[24px] text-ink">{experiment.requirements}</p>
          </section>
        ) : null}

        <section className="mt-5">
          <div className="mb-2 flex items-baseline justify-between">
            <h3 className="section-title">可选时段</h3>
            <span className="text-[11px] text-ink-soft">
              约时间请点下面的「立即预约」和排期助手聊
            </span>
          </div>
          <SlotGrid
            slots={slotViews}
            value={[]}
            readOnly
            emptyHint="所有时段都已约满，可以到对话页登记候补"
          />
        </section>

        {!eligibility.ok ? (
          <div className="mt-4 rounded-card border border-danger/20 bg-[#f9e9e6] px-3 py-2.5 text-[12px] leading-5 text-danger">
            {eligibility.message}
            {eligibility.reason === "VERIFY" ? (
              <Link href="/me/verify" className="ml-1 underline">
                去认证
              </Link>
            ) : null}
          </div>
        ) : null}

        {closed ? (
          <p className="mt-3 text-[12px] text-ink-soft">该实验已关闭，不再接受新的报名。</p>
        ) : deadlinePassed ? (
          <p className="mt-3 text-[12px] text-ink-soft">报名已截止。</p>
        ) : null}
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-line bg-surface">
        <div className="safe-bottom mx-auto flex h-16 w-full max-w-[480px] items-center gap-3 px-4">
          <div className="min-w-0">
            <p className="num text-[17px] font-semibold leading-5 text-clay">{experiment.rewardText}</p>
            <p className="text-[11px] text-ink-soft">
              {mine ? `已约 ${formatDayCN(mine.slot.startAt)} ${formatHM(mine.slot.startAt)}` : "选时段后确认"}
            </p>
          </div>
          <div className="flex-1">
            <BookCta
              experimentId={experiment.id}
              disabled={!eligibility.ok || openSlots.length === 0 || closed || deadlinePassed}
              disabledReason={
                closed
                  ? "实验已关闭"
                  : deadlinePassed
                    ? "报名已截止"
                    : openSlots.length === 0
                      ? "已约满，可到对话页登记候补"
                      : eligibility.ok
                        ? undefined
                        : eligibility.message
              }
              existingAppointmentId={mine?.id ?? null}
            />
          </div>
        </div>
      </div>
    </main>
  );
}

function Row({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2 text-[13px]">
      <span className="mt-[3px] text-ink-soft">{icon}</span>
      <span className="w-[60px] shrink-0 text-ink-soft">{label}</span>
      <span className="flex-1 text-right text-ink">{value}</span>
    </div>
  );
}
