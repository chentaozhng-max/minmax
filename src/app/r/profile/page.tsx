import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requirePage } from "@/lib/page-auth";
import { PageHeader } from "@/components/page-header";
import { TabBar } from "@/components/tab-bar";
import { CreditRing } from "@/components/credit-ring";
import { VerifiedBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LogoutButton } from "@/components/logout-button";
import { creditReasonLabel, type CreditReason } from "@/lib/domain";
import { formatDateTimeCN } from "@/lib/time";

export default async function ResearcherProfilePage() {
  const session = await requirePage("RESEARCHER");
  const user = await prisma.user.findUnique({ where: { id: session.sub } });
  if (!user) return null;

  const now = new Date();
  const banned = user.bannedUntil && user.bannedUntil.getTime() > now.getTime();
  const events = await prisma.creditEvent.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  const experiments = await prisma.experiment.count({ where: { researcherId: user.id } });

  return (
    <main className="shell tabbar-space">
      <PageHeader title="我的" back="auto" />

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
            <CreditRing score={user.creditScore} size={72} label="主试信誉" />
          </div>

          <div className="mt-3 grid grid-cols-3 divide-x divide-line rounded-[8px] bg-mist/60 py-2 text-center">
            <div>
              <p className="num text-[17px] font-semibold text-ink">{experiments}</p>
              <p className="mt-0.5 text-[11px] text-ink-soft">发布过</p>
            </div>
            <div>
              <p className="num text-[17px] font-semibold text-ink">{user.noShowCount}</p>
              <p className="mt-0.5 text-[11px] text-ink-soft">累计未到场</p>
            </div>
            <div>
              <p className="num text-[17px] font-semibold text-ink">{100}</p>
              <p className="mt-0.5 text-[11px] text-ink-soft">信誉上限</p>
            </div>
          </div>

          {banned ? (
            <p className="mt-3 rounded-[4px] bg-[#f9e9e6] px-2 py-1.5 text-[11px] text-danger">
              因累计未到场，禁发布至 {formatDateTimeCN(user.bannedUntil as Date)}
            </p>
          ) : null}

          {!user.studentVerified ? (
            <Link href="/r/profile/verify" className="mt-3 block">
              <Button variant="outline" size="md" block>
                完成学生认证
              </Button>
            </Link>
          ) : null}
        </div>

        <section className="mt-5">
          <div className="mb-2 flex items-baseline justify-between">
            <h3 className="section-title">信誉分变动</h3>
            <span className="text-[11px] text-ink-soft">与被试同一套规则</span>
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
          <Link href="/r/appeals" className="block">
            <Button variant="outline" size="lg" block>
              申诉处理
            </Button>
          </Link>
          <LogoutButton />
        </div>
      </div>

      <TabBar role="RESEARCHER" />
    </main>
  );
}
