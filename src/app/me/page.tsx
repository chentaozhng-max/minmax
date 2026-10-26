import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requirePage } from "@/lib/page-auth";
import { PageHeader } from "@/components/page-header";
import { TabBar } from "@/components/tab-bar";
import { CreditRing } from "@/components/credit-ring";
import { VerifiedBadge, StatusPill } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { creditReasonLabel, type CreditReason } from "@/lib/domain";
import { formatDateTimeCN } from "@/lib/time";
import { LogoutButton } from "@/components/logout-button";

export default async function MePage() {
  const session = await requirePage("SUBJECT");
  const user = await prisma.user.findUnique({ where: { id: session.sub } });
  if (!user) return null;

  const now = new Date();
  const banned = user.bannedUntil && user.bannedUntil.getTime() > now.getTime();
  const events = await prisma.creditEvent.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  const stats = await prisma.appointment.groupBy({
    by: ["status"],
    where: { subjectId: user.id },
    _count: { _all: true },
  });
  const completed = stats.find((s) => s.status === "COMPLETED")?._count._all ?? 0;

  return (
    <main className="shell tabbar-space">
      <PageHeader title="我的" back="/" />

      <div className="px-4 pt-3">
        <div className="rounded-card border border-line bg-surface p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-moss-tint text-[17px] font-semibold text-moss">
              {user.name.slice(0, 1)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[17px] font-semibold text-ink">{user.name}</span>
                <VerifiedBadge verified={user.studentVerified} />
              </div>
              <p className="mt-0.5 truncate text-[12px] text-ink-soft">
                {user.school ?? "未填写学校"}
                {user.department ? ` · ${user.department}` : ""}
              </p>
              <p className="num mt-0.5 text-[11px] text-ink-soft">{user.phone}</p>
            </div>
            <CreditRing score={user.creditScore} size={72} />
          </div>

          <div className="mt-3 grid grid-cols-3 divide-x divide-line rounded-[8px] bg-mist/60 py-2 text-center">
            <Stat label="完成实验" value={completed} />
            <Stat label="累计未到场" value={user.noShowCount} />
            <Stat label="信誉上限" value={100} />
          </div>

          {banned ? (
            <p className="mt-3 rounded-[4px] bg-[#f9e9e6] px-2 py-1.5 text-[11px] text-danger">
              因未到场被限制报名，{formatDateTimeCN(user.bannedUntil as Date)} 后解除
            </p>
          ) : null}

          {!user.studentVerified ? (
            <Link href="/me/verify" className="mt-3 block">
              <Button variant="outline" size="md" block>
                完成学生认证
              </Button>
            </Link>
          ) : null}
        </div>

        <section className="mt-5">
          <div className="mb-2 flex items-baseline justify-between">
            <h3 className="section-title">信誉分变动</h3>
            <span className="text-[11px] text-ink-soft">满分 100，不会清零</span>
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
          <Link href="/appointments" className="block">
            <Button variant="outline" size="lg" block>
              我的预约
            </Button>
          </Link>
          <LogoutButton />
        </div>
      </div>

      <TabBar role="SUBJECT" />
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="num text-[17px] font-semibold text-ink">{value}</p>
      <p className="mt-0.5 text-[11px] text-ink-soft">{label}</p>
    </div>
  );
}
