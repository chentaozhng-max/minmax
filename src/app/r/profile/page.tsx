import Link from "next/link";
import {
  CalendarCheck,
  ChevronRight,
  FlaskConical,
  MessageCircle,
  Plus,
  ShieldCheck,
} from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requirePage } from "@/lib/page-auth";
import { PageHeader } from "@/components/page-header";
import { TabBar } from "@/components/tab-bar";
import { CreditRing } from "@/components/credit-ring";
import { VerifiedBadge, StatusPill } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LogoutButton } from "@/components/logout-button";
import { creditReasonLabel, type CreditReason } from "@/lib/domain";
import { formatDateTimeCN } from "@/lib/time";

/**
 * 主试的个人中心。刻意和被试的「我的」长得不一样：
 * 被试关心的是「我的信誉、我的预约」，主试关心的是「我发了几个实验、有几个人等我确认」，
 * 所以这里第一屏是发布入口和待办，信誉明细放后面。
 */
export default async function ResearcherProfilePage() {
  const session = await requirePage("RESEARCHER");
  const user = await prisma.user.findUnique({ where: { id: session.sub } });
  if (!user) return null;

  const now = new Date();
  const banned = user.bannedUntil && user.bannedUntil.getTime() > now.getTime();

  const [events, experiments, published, awaiting, appeals] = await Promise.all([
    prisma.creditEvent.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.experiment.count({ where: { researcherId: user.id } }),
    prisma.experiment.count({ where: { researcherId: user.id, status: "PUBLISHED" } }),
    prisma.appointment.count({
      where: {
        experiment: { researcherId: user.id },
        status: { in: ["AWAITING_RESEARCHER", "CHECKED_IN"] },
      },
    }),
    prisma.appointment.count({
      where: { experiment: { researcherId: user.id }, appealStatus: "PENDING" },
    }),
  ]);

  return (
    <main className="shell tabbar-space">
      <PageHeader title="我的" back="auto" />

      <div className="px-4 pt-3">
        {/* 身份卡 */}
        <div className="rounded-card border border-line bg-surface p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-moss-tint text-[17px] font-semibold text-moss">
              {user.name.slice(0, 1)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[17px] font-semibold text-ink">{user.name}</span>
                <StatusPill tone="moss">主试</StatusPill>
                <VerifiedBadge verified={user.studentVerified} />
              </div>
              <p className="mt-0.5 truncate text-[12px] text-ink-soft">
                {user.school ?? "未填写学校"}
                {user.department ? ` · ${user.department}` : ""}
              </p>
              <p className="num mt-0.5 text-[11px] text-ink-soft">{user.phone}</p>
            </div>
            <CreditRing score={user.creditScore} size={72} label="主试信誉" />
          </div>

          <div className="mt-3 grid grid-cols-3 divide-x divide-line rounded-[8px] bg-mist/60 py-2 text-center">
            <Stat label="发布过" value={experiments} />
            <Stat label="招募中" value={published} />
            <Stat label="待我确认" value={awaiting} highlight={awaiting > 0} />
          </div>

          {banned ? (
            <p className="mt-3 rounded-[4px] bg-[#f9e9e6] px-2 py-1.5 text-[11px] text-danger">
              因累计未到场，禁发布至 {formatDateTimeCN(user.bannedUntil as Date)}
            </p>
          ) : null}

          {!user.studentVerified ? (
            <Link href="/r/profile/verify" className="mt-3 block">
              <Button variant="outline" size="md" block>
                完成主试认证
              </Button>
            </Link>
          ) : null}
        </div>

        {/* 发布入口：主试进到自己的页面，第一件事应该是能发实验 */}
        <div className="mt-3 rounded-card border border-moss/20 bg-moss-tint p-4">
          <p className="text-[15px] font-semibold text-moss-deep">发布新实验</p>
          <p className="mt-1 text-[12px] leading-5 text-moss/85">
            写清实验信息，开放你能来的时段，被试直接挑时段报名，不用来回对时间。
          </p>
          <Link href="/r/experiments/new" className="mt-3 block">
            <Button size="lg" block>
              <Plus size={17} strokeWidth={2.4} />
              发布实验
            </Button>
          </Link>
        </div>

        {/* 待办：有人报名了但还没确认，这是主试最该先处理的事 */}
        {awaiting > 0 ? (
          <Link
            href="/r/experiments"
            className="mt-3 flex items-center gap-3 rounded-card border border-clay/25 bg-clay-tint px-3.5 py-3"
          >
            <CalendarCheck size={18} strokeWidth={1.9} className="text-clay" />
            <span className="flex-1 text-[13px] text-clay">
              有 <span className="num font-semibold">{awaiting}</span> 条报名等你确认
            </span>
            <ChevronRight size={16} strokeWidth={1.9} className="text-clay" />
          </Link>
        ) : null}

        {/* 快捷入口 */}
        <div className="mt-3 divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
          <Row
            href="/r/experiments"
            icon={<FlaskConical size={17} strokeWidth={1.8} />}
            label="我的实验"
            meta={`${experiments} 个`}
          />
          <Row
            href="/r/messages"
            icon={<MessageCircle size={17} strokeWidth={1.8} />}
            label="消息"
          />
          <Row
            href="/r/appeals"
            icon={<ShieldCheck size={17} strokeWidth={1.8} />}
            label="申诉处理"
            meta={appeals > 0 ? `${appeals} 条待处理` : undefined}
            highlight={appeals > 0}
          />
        </div>

        {/* 信誉分 */}
        <section className="mt-5">
          <div className="mb-2 flex items-baseline justify-between">
            <h3 className="section-title">信誉分变动</h3>
            <span className="text-[11px] text-ink-soft">取消、未到场、申诉都会记在这里</span>
          </div>
          <div className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
            {events.length === 0 ? (
              <p className="px-3.5 py-6 text-center text-[12px] text-ink-soft">还没有记录</p>
            ) : (
              events.map((event) => (
                <div key={event.id} className="flex items-center gap-3 px-3.5 py-2.5">
                  <span
                    className={`num w-8 shrink-0 text-[14px] font-semibold ${
                      event.delta > 0 ? "text-moss" : "text-danger"
                    }`}
                  >
                    {event.delta > 0 ? `+${event.delta}` : event.delta}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] text-ink">
                      {creditReasonLabel[event.reason as CreditReason] ?? event.reason}
                    </p>
                    <p className="truncate text-[11px] text-ink-soft">
                      {event.note ?? "—"} · {formatDateTimeCN(event.createdAt)}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <div className="mt-5 space-y-2">
          <LogoutButton />
        </div>
      </div>

      <TabBar role="RESEARCHER" />
    </main>
  );
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <div>
      <p
        className={`num text-[17px] font-semibold ${highlight ? "text-clay" : "text-ink"}`}
      >
        {value}
      </p>
      <p className="mt-0.5 text-[11px] text-ink-soft">{label}</p>
    </div>
  );
}

function Row({
  href,
  icon,
  label,
  meta,
  highlight,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  meta?: string;
  highlight?: boolean;
}) {
  return (
    <Link href={href} className="flex items-center gap-3 px-3.5 py-3 active:bg-mist">
      <span className="text-ink-soft">{icon}</span>
      <span className="flex-1 text-[14px] text-ink">{label}</span>
      {meta ? (
        <span className={`num text-[11px] ${highlight ? "text-clay" : "text-ink-soft"}`}>
          {meta}
        </span>
      ) : null}
      <ChevronRight size={16} strokeWidth={1.8} className="text-ink-soft/60" />
    </Link>
  );
}
