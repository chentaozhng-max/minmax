import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { makeExperimentPageQuery } from "@/adapters/db/prisma/page-query-experiment";
import { requirePage } from "@/lib/page-auth";
import { currentUser } from "@/lib/auth";
import { checkEligibility } from "@/lib/credit";
import { VerifiedBadge } from "@/components/ui/badge";
import { PageHeader } from "@/components/page-header";
import { rewardAmountText, rewardLabel } from "@/lib/reward";
import { SlotGrid } from "@/components/slot-grid";
import { formatDateTimeCN, formatDayCN, formatDayKey, formatHM } from "@/lib/time";
import { remainingOf } from "@/server/experiments";
import { getSubjectState } from "@/server/questionnaire-service";
import { cn } from "@/lib/cn";
import { Bot, ChevronRight } from "lucide-react";
import { BookCta } from "./book-cta";
import { ContactCard } from "./contact-card";

/**
 * 实验详情页。信息结构参照招聘类 App 的职位详情：
 * 标题 + 奖励金额同行 → 元信息 → 发布者卡 → 信息表 → 正文 → 可选时段 → 底部固定 CTA。
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

  const query = makeExperimentPageQuery(prisma);
  const experiment = await query.findExperimentPageDetail(id);
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
    ? await query.findMyAppointment(id, user.id, [
        "PENDING_SUBJECT_CONFIRM",
        "AWAITING_RESEARCHER",
        "CONFIRMED",
        "CHECKED_IN",
      ])
    : null;

  const researcher = experiment.researcher;
  const researchCount = await query.countPublishedExperiments(researcher.id);

  // 需要问卷的实验：三种状态决定底部按钮（未发布 / 没填 / 没通过）
  const qState = experiment.needsQuestionnaire
    ? await getSubjectState(experiment.id, user?.id ?? null)
    : null;

  const ctaOverride = qState
    ? !qState.published
      ? { label: "问卷准备中", disabled: true, reason: "主试还在编辑问卷，稍后再来" }
      : !qState.submitted
        ? { label: "先填写问卷", href: `/experiments/${experiment.id}/questionnaire` }
        : !qState.passed
          ? { label: "等待主试筛选", disabled: true, reason: "通过后主试会给你发消息，届时就能预约" }
          : experiment.mode === "ONLINE"
            ? { label: "问卷已完成", disabled: true, reason: "线上实验提交问卷即完成" }
            : null
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
  const remainingSeats = openSlots.reduce((n, s) => n + remainingOf(s), 0);

  // 问卷入口也要受截止时间约束：过了截止还在收答卷，主试的筛选就没意义了
  const finalOverride =
    ctaOverride && ctaOverride.href && (closed || deadlinePassed)
      ? {
          label: closed ? "实验已关闭" : "问卷已截止",
          disabled: true,
          reason: closed ? "该实验已关闭" : "已过报名截止时间",
        }
      : ctaOverride;

  return (
    <main className="shell actionbar-space bg-surface">
      <PageHeader title="实验详情" back="auto" tone="surface" profile={{ role: "SUBJECT" }} />

      {/* 标题 + 奖励金额 */}
      <section className="px-4 pb-3.5 pt-4">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-[21px] font-semibold leading-[29px] tracking-[-0.01em] text-ink">
            {experiment.title}
          </h2>
          <div className="shrink-0 text-right">
            <p className="text-[10px] leading-[13px] text-ink-soft">奖励金额</p>
            <p className="num text-[20px] font-semibold leading-[26px] text-clay">
              {rewardAmountText(experiment.rewardText)}
            </p>
          </div>
        </div>

        <p className="mt-1.5 text-[13px] leading-5 text-ink-soft">
          {experiment.durationMin} 分钟 · {experiment.location}
        </p>

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <Tag>{experiment.type === "GROUP" ? `团体 ${experiment.groupSize ?? 2} 人` : "一对一"}</Tag>
          <Tag>
            {experiment.mode === "ONLINE"
              ? "线上完成"
              : remainingSeats > 0
                ? `剩 ${remainingSeats} 位`
                : "已约满"}
          </Tag>
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
          <InfoRow label={experiment.mode === "ONLINE" ? "参与方式" : "剩余时段"} value={experiment.mode === "ONLINE" ? "填写问卷" : `${openSlots.length} 段`} />
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

      {/* 可选时段 —— 线上实验没有时段，整块不渲染 */}
      {experiment.mode === "ONLINE" ? null : (
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
            experimentType={experiment.type}
            emptyHint="所有时段都已约满，可以给主试留言问问有没有人取消"
          />
        </div>
        <p className="mt-3 text-[11px] leading-5 text-ink-soft">
          点下方「立即预约」，选一个你能来的时段就行。
        </p>
      </section>
      )}

      {/* AI 入口 —— 每个实验都留一个，进来就能让助手帮你挑时段。
          实验已关闭/报名已截止时不显示：这时候进去也约不了，等于给个死路。
          但资格不符（信誉/认证/禁期）时仍然显示 —— 进去能看到原因，也顺带拿到「去约别的实验」的出口。 */}
      {!closed && !deadlinePassed && experiment.mode !== "ONLINE" ? (
        <section className="px-4 pb-4">
          <Link
            href={`/experiments/${experiment.id}/chat`}
            className={cn(
              "flex items-center gap-3 rounded-card border border-moss/25 bg-moss-tint/60 px-3.5 py-3",
              "active:bg-moss-tint",
            )}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-moss text-white">
              <Bot size={18} strokeWidth={2.1} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-medium text-ink">让 AI 助手帮我挑时段</span>
              <span className="mt-0.5 block text-[11px] leading-4 text-ink-soft">
                说「周三下午有空」，它会从这门实验的时段里给你挑
              </span>
            </span>
            <ChevronRight size={16} className="shrink-0 text-moss/70" strokeWidth={2.2} />
          </Link>
        </section>
      ) : null}

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
          <div className="w-[104px] shrink-0">
            <p className="text-[10px] leading-[13px] text-ink-soft">奖励金额</p>
            <p className="num truncate text-[17px] font-semibold leading-6 text-clay">
              {rewardAmountText(experiment.rewardText)}
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
              override={finalOverride}
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
