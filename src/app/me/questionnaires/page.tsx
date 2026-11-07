import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { makeSubjectTodoQuery } from "@/adapters/db/prisma/page-query-subject-todo";
import { requirePage } from "@/lib/page-auth";
import { PageHeader } from "@/components/page-header";
import { TabBar } from "@/components/tab-bar";
import { EmptyState } from "@/components/experiment-card";
import { pickPendingQuestionnaires, roundToFill } from "@/domain/questionnaire-todo";
import { formatDateTimeCN } from "@/lib/time";
import { rewardLabel } from "@/lib/reward";

/**
 * 「待填问卷」列表 —— 「我的」页第四格统计点进来的落地页。
 *
 * 为什么单独一页而不是直接跳第一份：一个被试可能同时挂着 3-4 份问卷，
 * 跳第一份等于把另外几份藏起来，他填完这份也不会知道还有。
 *
 * 判据全在 `domain/questionnaire-todo.ts`（纯函数、有单测），这里只渲染。
 */
export default async function MeQuestionnairesPage() {
  const session = await requirePage("SUBJECT");
  const todoQuery = makeSubjectTodoQuery(prisma);
  const now = new Date();

  const [candidates, myRounds] = await Promise.all([
    todoQuery.listQuestionnaireCandidatesForSubject(session.sub),
    todoQuery.listMyResponseRounds(session.sub),
  ]);
  const pending = pickPendingQuestionnaires(candidates, myRounds, now);

  return (
    <main className="shell tabbar-space">
      <PageHeader title="待填问卷" back="auto" profile={{ role: "SUBJECT" }} />

      <div className="px-4 pt-3">
        {pending.length === 0 ? (
          <EmptyState
            title="没有要填的问卷"
            description="需要填问卷的实验会出现在这里。去首页看看有没有感兴趣的实验。"
            action={
              <Link href="/">
                <span className="press inline-flex items-center justify-center rounded-pill border border-line bg-surface px-4 py-2 text-[13px] text-ink">
                  去逛实验
                </span>
              </Link>
            }
          />
        ) : (
          <>
            <p className="pb-2 text-[12px] leading-5 text-ink-soft">
              有 {pending.length} 份问卷等你填。填完主试会给你结果。
            </p>
            <div className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
              {pending.map((q) => {
                const round = roundToFill(q, now);
                const isWindow = q.scheduleMode === "WINDOW";
                return (
                  <Link
                    key={q.questionnaireId}
                    href={`/experiments/${q.experimentId}/questionnaire`}
                    className="flex items-start gap-3 px-3.5 py-3 active:bg-mist"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <p className="truncate text-[14px] font-medium text-ink">{q.experimentTitle}</p>
                        {isWindow ? (
                          <span className="shrink-0 rounded-[3px] bg-moss-tint px-1.5 py-0.5 text-[10px] text-moss">
                            第 {round}/{q.repeatCount} 天
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 truncate text-[12px] text-ink-soft">
                        {q.researcherName} · {q.durationMin} 分钟 ·{" "}
                        <span className="num text-clay">{rewardLabel(q.rewardText)}</span>
                      </p>
                      <p className="mt-0.5 text-[11px] text-ink-soft">
                        {q.openAnytime ? "随时可填" : `截止 ${formatDateTimeCN(q.signupDeadline)}`}
                      </p>
                    </div>
                    <ChevronRight size={16} className="mt-1 shrink-0 text-ink-soft/60" />
                  </Link>
                );
              })}
            </div>
          </>
        )}
      </div>

      <TabBar role="SUBJECT" />
    </main>
  );
}
