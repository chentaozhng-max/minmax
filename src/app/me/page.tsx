import Link from "next/link";
import { ChevronRight, Compass } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { makePageQuery } from "@/adapters/db/prisma/page-query";
import { makeSubjectTodoQuery } from "@/adapters/db/prisma/page-query-subject-todo";
import { requirePage } from "@/lib/page-auth";
import { PageHeader } from "@/components/page-header";
import { TabBar } from "@/components/tab-bar";
import { CreditRing } from "@/components/credit-ring";
import { VerifiedBadge, StatusPill } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { creditReasonLabel, type CreditReason } from "@/lib/domain";
import { formatDateTimeCN } from "@/lib/time";
import { LogoutButton } from "@/components/logout-button";
import { makeDefaultNotificationRepository } from "@/adapters/db/prisma/notification-repo";
import { pickPendingQuestionnaires } from "@/domain/questionnaire-todo";
import { ReminderEntry } from "./reminder-entry";

export default async function MePage() {
  const session = await requirePage("SUBJECT");
  const pageQuery = makePageQuery(prisma);
  const todoQuery = makeSubjectTodoQuery(prisma);
  const now = new Date();

  // 这几件事都只依赖 session.sub（会话里已经带了用户 id），彼此没有先后关系，
  // 一次并发发出去。原来是「查资料 → 查统计 → 查未读」三段 await，
  // 云端每段都是一次往返，叠起来就是点进「我的」要等的那一下。
  const [user, events, counts, unread, todoCandidates, myRounds] = await Promise.all([
    pageQuery.findMeProfile(session.sub),
    pageQuery.findRecentCreditEvents(session.sub, 20),
    pageQuery.countAppointmentsByStatus(
      session.sub,
      ["COMPLETED"],
      ["PENDING_SUBJECT_CONFIRM", "AWAITING_RESEARCHER", "CONFIRMED", "CHECKED_IN"],
    ),
    // 「我的」页要显示提醒入口的未读数，只查一个 count，不拉列表
    makeDefaultNotificationRepository().countUnread(session.sub),
    todoQuery.listQuestionnaireCandidatesForSubject(session.sub),
    todoQuery.listMyResponseRounds(session.sub),
  ]);
  if (!user) return null;

  const completed = counts.completed;
  const ongoing = counts.ongoing;
  // 「现在该填几份」由领域纯函数判（长程重复测量按轮次算，窗口没开的不算待办）
  const pendingQuestionnaires = pickPendingQuestionnaires(todoCandidates, myRounds, now).length;

  const banned = user.bannedUntil && user.bannedUntil.getTime() > now.getTime();

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
            <Link href="/me/credit" aria-label="查看信誉分明细" className="press rounded-full">
              <CreditRing score={user.creditScore} size={72} />
            </Link>
          </div>

          <div className="mt-3 grid grid-cols-4 divide-x divide-line rounded-[8px] bg-mist/60 py-2 text-center">
            <Stat label="已完成" value={completed} href="/appointments?tab=done" />
            <Stat label="进行中" value={ongoing} href="/appointments?tab=active" />
            <Stat
              label="待填问卷"
              value={pendingQuestionnaires}
              href="/me/questionnaires"
              highlight={pendingQuestionnaires > 0}
            />
            <Stat label="累计未到场" value={user.noShowCount} href="/me/credit" />
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
            <Link href="/me/credit" className="flex items-center text-[11px] text-moss">
              查看详情 <ChevronRight size={13} />
            </Link>
          </div>
          <div className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
            {events.length === 0 ? (
              <p className="px-3.5 py-6 text-center text-[12px] text-ink-soft">还没有记录</p>
            ) : (
              events.map((event) => (
                <Link
                  key={event.id}
                  href={`/me/credit/${event.id}`}
                  className="flex items-center gap-3 px-3.5 py-2.5 active:bg-mist"
                >
                  <span
                    className={`num w-8 shrink-0 text-[14px] font-semibold ${
                      event.delta > 0 ? "text-moss" : "text-danger"
                    }`}
                  >
                    {event.delta > 0 ? `+${event.delta}` : event.delta}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] text-ink">
                      {creditReasonLabel[event.reason as CreditReason] ?? event.reason}                    </p>
                    <p className="truncate text-[11px] text-ink-soft">
                      {event.note ?? "—"} · {formatDateTimeCN(event.createdAt)}
                    </p>
                  </div>
                  <ChevronRight size={15} className="shrink-0 text-ink-soft/60" />
                </Link>
              ))
            )}
          </div>
        </section>

        <div className="mt-5 space-y-2">
          <ReminderEntry serverUnread={unread} />
          <Link href="/appointments" className="block">
            <Button variant="outline" size="lg" block>
              我的预约
            </Button>
          </Link>
          {/* 教程只自动弹一次，之后靠这个入口重看（和主试端 /r/profile 一致） */}
          <Link
            href="/?tour=1"
            className="flex items-center justify-between rounded-[10px] border border-line bg-surface px-4 py-3 active:bg-mist"
          >
            <span className="inline-flex items-center gap-2 text-[14px] text-ink">
              <Compass size={17} strokeWidth={1.8} className="text-ink-soft" />
              新手引导
            </span>
            <span className="inline-flex items-center gap-1 text-[11px] text-ink-soft">
              重看一遍
              <ChevronRight size={15} strokeWidth={1.8} className="text-ink-soft/60" />
            </span>
          </Link>
          <LogoutButton />
        </div>
      </div>

      <TabBar role="SUBJECT" />
    </main>
  );
}

function Stat({
  label,
  value,
  href,
  highlight,
}: {
  label: string;
  value: number;
  href: string;
  highlight?: boolean;
}) {
  return (
    <Link href={href} aria-label={`${label} ${value}，点击查看`} className="block py-1 active:bg-line/40">
      <p className={`num text-[17px] font-semibold ${highlight ? "text-clay" : "text-ink"}`}>{value}</p>
      <p className="mt-0.5 text-[11px] text-ink-soft">{label}</p>
    </Link>
  );
}
