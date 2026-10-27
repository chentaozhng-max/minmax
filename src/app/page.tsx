import { Suspense } from "react";
import Link from "next/link";
import { currentUser } from "@/lib/auth";
import { requirePage } from "@/lib/page-auth";
import { listExperimentCards } from "@/server/experiments";
import { ExperimentCard, ExperimentCardSkeleton, EmptyState } from "@/components/experiment-card";
import { TabBar } from "@/components/tab-bar";
import { BackButton } from "@/components/back-button";
import { ProfileLink } from "@/components/profile-link";
import { SearchBar } from "./search-bar";
import { FilterChips } from "./filter-chips";
import { CheckCircle2 } from "lucide-react";
import { startOfShanghaiDay } from "@/lib/time";

type Search = {
  keyword?: string;
  duration?: string;
  reward?: string;
  date?: string;
  onlyEligible?: string;
};

function resolveDate(value: string | undefined, now: Date) {
  if (value !== "today" && value !== "tomorrow") return undefined;
  const base = startOfShanghaiDay(now);
  const offset = value === "tomorrow" ? 1 : 0;
  return new Date(base.getTime() + offset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  await requirePage("SUBJECT");
  const sp = await searchParams;
  const user = await currentUser();
  const now = new Date();

  const cards = await listExperimentCards({
    viewer: user
      ? {
          id: user.id,
          creditScore: user.creditScore,
          studentVerified: user.studentVerified,
          bannedUntil: user.bannedUntil,
        }
      : null,
    keyword: sp.keyword,
    duration: sp.duration,
    reward: sp.reward,
    date: resolveDate(sp.date, now),
    onlyEligible: sp.onlyEligible === "true",
    now,
  });

  const banned = user?.bannedUntil && user.bannedUntil.getTime() > now.getTime();

  return (
    <main className="shell tabbar-space">
      <div className="flex items-center gap-1 px-4 pb-1.5 pt-1.5">
        <div className="-ml-2">
          <BackButton fallback="/" />
        </div>
        <h1 className="text-[16px] font-semibold text-ink">找实验</h1>
        <div className="ml-auto">
          <ProfileLink role="SUBJECT" />
        </div>
      </div>

      <div className="sticky top-0 z-30 bg-paper/95 px-4 pb-2 pt-2 backdrop-blur">
        <Suspense fallback={<div className="h-11 rounded-pill bg-[#F5F6F7]" />}>
          <SearchBar initial={sp.keyword ?? ""} />
        </Suspense>
        <div className="mt-2">
          <Suspense fallback={null}>
            <FilterChips />
          </Suspense>
        </div>
      </div>

      <div className="px-4 pt-3">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-[13px] font-semibold text-ink-soft">
            正在招募 <span className="num text-ink">{cards.length}</span> 个实验
          </h2>
          {user ? (
            <span className="num text-[11px] text-ink-soft">
              信誉 {user.creditScore} · {user.studentVerified ? "已认证" : "未认证"}
            </span>
          ) : null}
        </div>

        {banned ? (
          <div className="mb-3 rounded-card border border-danger/20 bg-[#f9e9e6] px-3 py-2 text-[12px] leading-5 text-danger">
            因未到场被限制报名，解禁后可继续预约。
          </div>
        ) : null}

        {user && !user.studentVerified ? (
          <Link
            href="/me/verify"
            className="mb-3 flex items-center justify-between rounded-card border border-verify/20 bg-verify-tint px-3 py-2 text-[12px] text-verify"
          >
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle2 size={14} strokeWidth={2} />
              完成学生认证后可以报名全部实验
            </span>
            <span className="shrink-0 text-[11px] underline">去认证</span>
          </Link>
        ) : null}

        {cards.length === 0 ? (
          <div className="pt-6">
            <EmptyState
              title="这个条件下还没有实验"
              description="换个筛选条件看看，或者把搜索框清空。新的实验通常在工作日下午发布。"
            />
          </div>
        ) : (
          <div className="space-y-2">
            {cards.map((card) => (
              <ExperimentCard key={card.id} card={card} />
            ))}
          </div>
        )}
      </div>

      <TabBar role="SUBJECT" />
    </main>
  );
}

