import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requirePage } from "@/lib/page-auth";
import { PageHeader } from "@/components/page-header";
import { CreditRing } from "@/components/credit-ring";
import { VerifiedBadge } from "@/components/ui/badge";
import { formatShortDayCN } from "@/lib/time";

export default async function ResearcherPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePage();
  const { id } = await params;
  const researcher = await prisma.user.findUnique({
    where: { id },
    include: {
      experiments: {
        where: { status: "PUBLISHED" },
        include: { slots: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!researcher || researcher.role !== "RESEARCHER") notFound();

  const hostedCount = await prisma.creditEvent.count({
    where: { userId: researcher.id, reason: "ATTENDED" },
  });

  const now = new Date();
  const openExperiments = researcher.experiments
    .map((e) => ({
      id: e.id,
      title: e.title,
      rewardText: e.rewardText,
      durationMin: e.durationMin,
      location: e.location,
      seats: e.slots
        .filter((s) => s.startAt.getTime() > now.getTime())
        .reduce((n, s) => n + Math.max(0, s.capacity - s.bookedCount), 0),
      nextAt: e.slots
        .filter((s) => s.startAt.getTime() > now.getTime())
        .map((s) => s.startAt)
        .sort((a, b) => a.getTime() - b.getTime())[0],
    }))
    .filter((e) => e.seats > 0);

  return (
    <main className="shell pb-10">
      <PageHeader title="主试主页" back="auto" profile={{ role: "SUBJECT" }} />
      <div className="px-4 pt-3">
        <div className="rounded-card border border-line bg-surface p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-moss-tint text-[17px] font-semibold text-moss">
              {researcher.name.slice(0, 1)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[17px] font-semibold text-ink">{researcher.name}</span>
                <VerifiedBadge verified={researcher.studentVerified} />
              </div>
              <p className="mt-0.5 truncate text-[12px] text-ink-soft">
                {researcher.school ?? "未填写学校"}
                {researcher.department ? ` · ${researcher.department}` : ""}
              </p>
              <p className="mt-1 text-[11px] text-ink-soft">
                {researcher.experiments.length > 0 ? "正在招募被试" : "暂未发布实验"}
              </p>
            </div>
            <CreditRing score={researcher.creditScore} size={72} label="主试信誉" />
          </div>

          <div className="mt-3 grid grid-cols-3 divide-x divide-line rounded-[8px] bg-mist/60 py-2 text-center">
            <div>
              <p className="num text-[15px] font-semibold text-ink">{researcher.experiments.length}</p>
              <p className="text-[11px] text-ink-soft">在招实验</p>
            </div>
            <div>
              <p className="num text-[15px] font-semibold text-ink">{hostedCount}</p>
              <p className="text-[11px] text-ink-soft">按时主持</p>
            </div>
            <div>
              <p className="num text-[15px] font-semibold text-ink">{researcher.noShowCount}</p>
              <p className="text-[11px] text-ink-soft">累计未到场</p>
            </div>
          </div>

          {researcher.creditScore < 60 ? (
            <p className="mt-3 rounded-[4px] bg-[#f9e9e6] px-2 py-1.5 text-[11px] text-danger">
              该主试信誉分较低，报名前建议先确认对方的实验安排是否稳定。
            </p>
          ) : null}
        </div>

        <section className="mt-5">
          <h3 className="section-title mb-2">在招实验</h3>
          {openExperiments.length === 0 ? (
            <p className="rounded-card border border-dashed border-line bg-surface/60 px-4 py-8 text-center text-[12px] text-ink-soft">
              暂时没有在招的实验
            </p>
          ) : (
            <div className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
              {openExperiments.map((e) => (
                <Link
                  key={e.id}
                  href={`/experiments/${e.id}`}
                  className="block px-3.5 py-3 active:bg-mist"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[14px] font-medium text-ink">{e.title}</span>
                    <span className="num shrink-0 text-[13px] text-clay">{e.rewardText}</span>
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-ink-soft">{e.location}</p>
                  <p className="num mt-0.5 text-[11px] text-ink-soft">
                    {e.durationMin} 分钟 · 剩 {e.seats} 位
                    {e.nextAt ? ` · 最近 ${formatShortDayCN(e.nextAt)}` : ""}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
