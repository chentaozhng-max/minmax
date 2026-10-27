import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requirePage } from "@/lib/page-auth";
import { currentUser } from "@/lib/auth";
import { checkEligibility } from "@/lib/credit";
import { VerifiedBadge } from "@/components/ui/badge";
import { PageHeader } from "@/components/page-header";
import { SlotGrid } from "@/components/slot-grid";
import { formatDateTimeCN, formatDayCN, formatDayKey, formatHM } from "@/lib/time";
import { remainingOf } from "@/server/experiments";
import { cn } from "@/lib/cn";
import { BookCta } from "./book-cta";
import { ContactCard } from "./contact-card";

/**
 * 实验详情页。信息结构参照招聘类 App 的职位详情：
 * 标题 + 报酬同行 → 元信息 → 发布者卡 → 信息表 → 正文 → 可选时段 → 底部固定 CTA。
 * 白底 + 细分隔线 + 高信息密度，不再用一堆描边卡片。
 */
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

  const researcher = experiment.researcher;
  const researchCount = await prisma.experiment.count({
    where: { researcherId: researcher.id, status: "PUBLISHED" },
  });

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
  const remainingSeats = openSlots.reduce((n, s) => n + remainingOf(s), 0);

  return (
    <main className="shell actionbar-space bg-surface">
      <PageHeader title="实验详情" back="auto" tone="surface" profile={{ role: "SUBJECT" }} />

      {/* 标题 + 报酬 */}
      <section className="px-4 pb-3.5 pt-4">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-[21px] font-semibold leading-[29px] tracking-[-0.01em] text-ink">
            {experiment.title}
          </h2>
          <span className="num shrink-0 text-[20px] font-semibold leading-[29px] text-clay">
            {experiment.rewardText}
          </span>
        </div>

        <p className="mt-1.5 text-[13px] leading-5 text-ink-soft">
          {experiment.durationMin} 分钟 · {experiment.location}
        </p>

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <Tag>{experiment.type === "GROUP" ? `团体 ${experiment.groupSize ?? 2} 人` : "一对一"}</Tag>
          <Tag>{remainingSeats > 0 ? `剩 ${remainingSeats} 位` : "已约满"}</Tag>
          {experiment.minCreditScore > 0 ? (
            <Tag tone="warn">信誉 ≥ {experiment.minCreditScore}</Tag>
          ) : null}
          {experiment.needsVerification ? <Tag tone="verify">需学生认证</Tag> : null}
        </div>
      </section>

      <Divider />

      {/* 发布者：点头像直接开私信 */}
      <ContactCard
        experimentId={experiment.id}
        researcher={{
          id: researcher.id,
          name: researcher.name,
          school: researcher.school,
          department: researcher.department,
          studentVerified: researcher.studentVerified,
          creditScore: researcher.creditScore,
        }}
      />
      <p className="num px-4 pb-3 text-[11px] leading-5 text-ink-soft">
        信誉 {researcher.creditScore} · 在招 {researchCount} 个实验
      </p>

      <Divider />

      {/* 实验信息 */}
      <section className="px-4 py-4">
        <h3 className="text-[15px] font-semibold text-ink">实验信息</h3>
        <dl className="mt-2.5 space-y-2 text-[13px] leading-5">
          <InfoRow label="地点" value={experiment.location} />
          <InfoRow label="报名截止" value={formatDateTimeCN(experiment.signupDeadline)} />
          <InfoRow label="剩余时段" value={`${openSlots.length} 段`} />
          <InfoRow
            label="最早可约"
            value={openSlots[0] ? formatDateTimeCN(openSlots[0].startAt) : "暂无"}
          />
        </dl>
      </section>

      <Divider />

      {/* 正文 */}
      <section className="px-4 py-4">
        <h3 className="text-[15px] font-semibold text-ink">实验说明</h3>
        <p className="mt-2 whitespace-pre-line text-[14px] leading-[24px] text-ink">
          {experiment.description}
        </p>

        {experiment.requirements ? (
          <>
            <h3 className="mt-4 text-[15px] font-semibold text-ink">参加要求</h3>
            <p className="mt-2 text-[14px] leading-[24px] text-ink">{experiment.requirements}</p>
          </>
        ) : null}
      </section>

      <Divider />

      {/* 可选时段 */}
      <section className="px-4 py-4">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-[15px] font-semibold text-ink">可选时段</h3>
          <span className="num text-[12px] text-ink-soft">
            {openSlots.length > 0 ? `共 ${openSlots.length} 段 · 半小时一档` : "暂无可约时段"}
          </span>
        </div>
        <div className="mt-3">
          <SlotGrid
            slots={slotViews}
            value={[]}
            readOnly
            emptyHint="所有时段都已约满，可以给主试留言问问有没有人取消"
          />
        </div>
        <p className="mt-3 text-[11px] leading-5 text-ink-soft">
          点下方「立即预约」，选一个你能来的时段就行。
        </p>
      </section>

      {!eligibility.ok ? (
        <div className="mx-4 mb-4 rounded-[6px] bg-[#f9e9e6] px-3 py-2.5 text-[12px] leading-5 text-danger">
          {eligibility.message}
          {eligibility.reason === "VERIFY" ? (
            <Link href="/me/verify" className="ml-1 underline">
              去认证
            </Link>
          ) : null}
        </div>
      ) : null}

      {closed ? (
        <p className="px-4 pb-4 text-[12px] text-ink-soft">该实验已关闭，不再接受新的报名。</p>
      ) : deadlinePassed ? (
        <p className="px-4 pb-4 text-[12px] text-ink-soft">报名已截止。</p>
      ) : (
        <div className="h-4" />
      )}

      {/* 底部固定操作条 */}
      <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-line bg-surface">
        <div className="safe-bottom mx-auto flex h-16 w-full max-w-[480px] items-center gap-3 px-4">
          <div className="w-[92px] shrink-0">
            <p className="num truncate text-[18px] font-semibold leading-6 text-clay">
              {experiment.rewardText}
            </p>
            <p className="num truncate text-[11px] leading-4 text-ink-soft">
              {mine
                ? `已约 ${formatDayKey(mine.slot.startAt)} ${formatHM(mine.slot.startAt)}`
                : `${experiment.durationMin} 分钟`}
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

function Divider() {
  return <div className="h-2 bg-mist" aria-hidden />;
}

function Tag({
  children,
  tone = "grey",
}: {
  children: React.ReactNode;
  tone?: "grey" | "warn" | "verify";
}) {
  const toneClass = {
    grey: "bg-[#F4F5F2] text-ink-soft",
    warn: "bg-[#f8efdd] text-warn",
    verify: "bg-verify-tint text-verify",
  }[tone];

  return (
    <span className={cn("rounded-[3px] px-1.5 py-0.5 text-[11px] leading-4", toneClass)}>
      {children}
    </span>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-[64px] shrink-0 text-ink-soft">{label}</dt>
      <dd className="min-w-0 flex-1 text-ink">{value}</dd>
    </div>
  );
}
