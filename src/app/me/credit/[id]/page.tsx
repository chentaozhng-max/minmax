import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarDays, FlaskConical, MapPin, UserRound } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requirePage } from "@/lib/page-auth";
import { PageHeader } from "@/components/page-header";
import { CreditRing } from "@/components/credit-ring";
import { StatusPill } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CREDIT } from "@/lib/credit";
import {
  appointmentStatusLabel,
  creditReasonLabel,
  type AppointmentStatus,
  type CreditReason,
} from "@/lib/domain";
import { formatDateTimeCN, formatSlotRange } from "@/lib/time";
import { cn } from "@/lib/cn";

/** 每种变动的「人话解释」：列表只给标题，详情要把为什么扣/加分讲清楚。 */
const REASON_INFO: Record<CreditReason, { summary: string; rule: string }> = {
  ATTENDED: {
    summary: "你按时到场并完成实验，主试确认后双方各加 1 分。",
    rule: "信誉分满 100 时不再加分，也不会产生多余记录。",
  },
  NO_SHOW: {
    summary: "实验开始后你没有签到，系统按未到场扣 2 分，并累计一次未到场。",
    rule: "距开始 24 小时以上取消不扣分；累计未到场 1–3 次每次限制报名 1 天，第 4 次起每次限制 7 天。",
  },
  RESEARCHER_NO_SHOW: {
    summary: "被试已签到但主试未到场，或申诉成立，系统记主试一次未到场并扣 2 分。",
    rule: "主试临近开始取消（距时段开始不足 24 小时）按同一规则扣分。",
  },
  RESEARCHER_CANCEL: {
    summary: "你在临近开始时取消了实验，该预约对应的主试信誉扣 2 分。",
    rule: "距时段开始 24 小时以上取消不扣分；取消整场实验时逐条按时段开始时间判断。",
  },
  MANUAL_ADJUST: {
    summary: "这是一条人工调整的信誉分记录。",
    rule: "人工调整会写明原因；如有疑问可在预约记录里发起申诉。",
  },
};

const APPEAL_TEXT: Record<string, string> = {
  PENDING: "申诉处理中，主试需在 48 小时内回应，逾期自动判为成立",
  UPHELD: "申诉成立",
  REJECTED: "申诉被驳回",
};

function statusTone(status: string) {
  if (status === "NO_SHOW" || status.startsWith("CANCELLED")) return "danger" as const;
  if (status === "COMPLETED" || status === "CONFIRMED" || status === "CHECKED_IN")
    return "moss" as const;
  if (status === "PENDING_SUBJECT_CONFIRM" || status === "AWAITING_RESEARCHER")
    return "warn" as const;
  return "grey" as const;
}

/**
 * 信誉分变动详情。
 * 之前个人中心里那条记录点进去只是跳到列表页锚点，且线上还漏了路由，
 * 这里给每条变动一个独立页面：本次加减、变动后分数、规则解释、关联预约。
 */
export default async function CreditEventDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requirePage();
  const { id } = await params;

  const event = await prisma.creditEvent.findUnique({ where: { id } });
  // 不是自己的记录一律当不存在，避免用 id 猜别人的信誉流水
  if (!event || event.userId !== session.sub) notFound();

  const user = await prisma.user.findUnique({ where: { id: session.sub } });
  if (!user) return null;

  const appointment = event.appointmentId
    ? await prisma.appointment.findUnique({
        where: { id: event.appointmentId },
        include: {
          experiment: { include: { researcher: true } },
          slot: true,
          subject: true,
        },
      })
    : null;

  // 变动后分数：从 100 分起按时间顺序重放所有流水（同 0–100 截断规则），
  // 这样即使后来又发生变动，也能看到"这条记录生效时"的分数。
  const allEvents = await prisma.creditEvent.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, delta: true },
  });
  // CREDIT 是 as const，直接进 Math.min 会把类型推成字面量 100，这里显式放宽
  const minScore: number = CREDIT.MIN;
  const maxScore: number = CREDIT.MAX;
  let running: number = CREDIT.INITIAL;
  let scoreAfter = user.creditScore;
  for (const item of allEvents) {
    running = Math.max(minScore, Math.min(maxScore, running + item.delta));
    if (item.id === event.id) {
      scoreAfter = running;
      break;
    }
  }

  const reason = event.reason as CreditReason;
  const info = REASON_INFO[reason] ?? REASON_INFO.MANUAL_ADJUST;
  const positive = event.delta > 0;
  const isResearcher = user.role === "RESEARCHER";
  const experimentHref = appointment
    ? isResearcher
      ? `/r/experiments/${appointment.experimentId}`
      : `/experiments/${appointment.experimentId}`
    : null;

  return (
    <main className="shell min-h-dvh pb-8">
      <PageHeader title="信誉分变动详情" back="/me/credit" />

      <div className="space-y-4 px-4 pt-4">
        <section className="rounded-card border border-line bg-surface p-4">
          <div className="flex items-center gap-4">
            <CreditRing
              score={user.creditScore}
              size={76}
              label={isResearcher ? "主试信誉" : "信誉分"}
            />
            <div className="min-w-0 flex-1">
              <p className="text-[16px] font-semibold text-ink">
                {creditReasonLabel[reason] ?? event.reason}
              </p>
              <p className="num mt-1 text-[11px] text-ink-soft">
                {formatDateTimeCN(event.createdAt)}
              </p>
              <p
                className={cn(
                  "num mt-2 text-[22px] font-semibold",
                  positive ? "text-moss" : "text-danger",
                )}
              >
                {positive ? `+${event.delta}` : event.delta}
                <span className="ml-1 text-[11px] font-normal text-ink-soft">分</span>
              </p>
            </div>
          </div>

          <dl className="mt-4 grid grid-cols-3 divide-x divide-line rounded-[8px] bg-mist/60 py-2 text-center">
            <Stat label="变动后分数" value={scoreAfter} />
            <Stat label="当前分数" value={user.creditScore} />
            <Stat label="累计未到场" value={user.noShowCount} />
          </dl>
        </section>

        <section className="rounded-card border border-line bg-surface p-4">
          <h2 className="text-[14px] font-semibold text-ink">这次是怎么回事</h2>
          <p className="mt-2 text-[13px] leading-6 text-ink">
            {event.note ?? info.summary}
          </p>
          <p className="mt-3 rounded-[6px] bg-mist/70 px-3 py-2 text-[12px] leading-5 text-ink-soft">
            {info.rule}
          </p>
        </section>

        {appointment ? (
          <section className="rounded-card border border-line bg-surface p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-[14px] font-semibold text-ink">关联预约</h2>
              <StatusPill tone={statusTone(appointment.status)}>
                {appointmentStatusLabel[appointment.status as AppointmentStatus] ??
                  appointment.status}
              </StatusPill>
            </div>

            <div className="mt-3 space-y-2 text-[12px] leading-5">
              <p className="flex items-start gap-2 text-ink">
                <FlaskConical size={15} className="mt-0.5 shrink-0 text-ink-soft" />
                <span>{appointment.experiment.title}</span>
              </p>
              <p className="num flex items-start gap-2 text-ink-soft">
                <CalendarDays size={15} className="mt-0.5 shrink-0" />
                <span>{formatSlotRange(appointment.slot.startAt, appointment.slot.endAt)}</span>
              </p>
              <p className="flex items-start gap-2 text-ink-soft">
                <MapPin size={15} className="mt-0.5 shrink-0" />
                <span>{appointment.experiment.location}</span>
              </p>
              <p className="flex items-start gap-2 text-ink-soft">
                <UserRound size={15} className="mt-0.5 shrink-0" />
                <span>
                  {isResearcher ? "被试" : "主试"}：
                  {isResearcher
                    ? appointment.subject.name
                    : appointment.experiment.researcher.name}
                </span>
              </p>
            </div>

            {appointment.appealStatus ? (
              <p className="mt-3 rounded-[6px] bg-mist px-3 py-2 text-[12px] leading-5 text-ink-soft">
                {APPEAL_TEXT[appointment.appealStatus] ?? "申诉已处理"}
              </p>
            ) : null}

            <div className="mt-3 flex gap-2">
              {experimentHref ? (
                <Link href={experimentHref} className="flex-1">
                  <Button variant="outline" size="md" block>
                    查看实验
                  </Button>
                </Link>
              ) : null}
              {isResearcher ? (
                appointment.appealStatus === "PENDING" ? (
                  <Link href="/r/appeals" className="flex-1">
                    <Button size="md" block>
                      处理申诉
                    </Button>
                  </Link>
                ) : null
              ) : reason === "NO_SHOW" && !appointment.appealStatus ? (
                <Link href="/appointments" className="flex-1">
                  <Button size="md" block>
                    去申诉
                  </Button>
                </Link>
              ) : null}
            </div>
          </section>
        ) : (
          <section className="rounded-card border border-line bg-surface p-4">
            <h2 className="text-[14px] font-semibold text-ink">关联预约</h2>
            <p className="mt-2 text-[12px] leading-5 text-ink-soft">
              这条记录没有绑定具体预约（例如人工调整或历史数据）。
            </p>
          </section>
        )}

        <section className="rounded-card border border-line bg-surface p-4">
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
          <Link
            href="/me/credit"
            className="mt-3 block border-t border-line pt-3 text-[12px] text-moss"
          >
            查看全部信誉分变动
          </Link>
        </section>
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="num text-[16px] font-semibold text-ink">{value}</p>
      <p className="mt-0.5 text-[11px] text-ink-soft">{label}</p>
    </div>
  );
}
