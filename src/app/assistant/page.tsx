import Link from "next/link";
import { Sparkles, AlertTriangle, CalendarClock } from "lucide-react";
import { requirePage } from "@/lib/page-auth";
import { PageHeader } from "@/components/page-header";
import { TabBar } from "@/components/tab-bar";
import { Button } from "@/components/ui/button";
import { makeDefaultAssistantQuery } from "@/adapters/db/prisma/assistant-query";
import { buildAssistantBrief } from "@/application/assistant-overview";
import { ACTIVE_APPOINTMENT_STATUSES, appointmentStatusLabel, type AppointmentStatus } from "@/lib/domain";
import { formatDayCN, formatHM } from "@/lib/time";

/**
 * 助手首页 —— 这一步只「看」，不出手。
 *
 * 刻意不做的事：这里不能下单、不能改预约。原因有两个：
 *   1. 预约的最终动作应该是人点出来的（第 4 步做对话框内嵌组件）。在这里开一条
 *      「助手直接帮你约」的旁路，等于同时维护两套下单逻辑，迟早不一致。
 *   2. 先让「看」跑通零风险 —— 读错数据只是显示难看，写错数据要赔信誉分。
 *
 * 页面只做三件事：鉴权 → 调用例 → 渲染。撞车判定、排序、文案全在 application 层，
 * 这样规则有单测，页面坏了不影响规则对。
 */
export default async function AssistantPage() {
  const session = await requirePage("SUBJECT");
  const brief = await buildAssistantBrief(
    { query: makeDefaultAssistantQuery() },
    session.sub,
    [...ACTIVE_APPOINTMENT_STATUSES],
  );

  return (
    <main className="shell tabbar-space">
      <PageHeader title="助手" subtitle="我帮你盯着你的安排" profile={{ role: "SUBJECT" }} />

      <div className="px-4 pt-3">
        {/* 那一句话 —— 撞车优先，其次最近一场，最后是引导 */}
        <div className="rounded-card border border-line bg-surface px-4 py-3.5">
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-moss-tint text-moss">
              {brief.overlaps.length > 0 ? (
                <AlertTriangle size={15} strokeWidth={2.2} />
              ) : (
                <Sparkles size={15} strokeWidth={2.2} />
              )}
            </span>
            <p className="text-[13px] leading-6 text-ink">{brief.headline}</p>
          </div>
          {/* 门厅入口：只在没有任何安排时给（有安排了先让他看安排，别抢视线） */}
          {brief.upcoming.length === 0 && brief.overlaps.length === 0 ? (
            <div className="mt-2.5">
              <Link href="/assistant/chat" className="block">
                <Button size="md" block>
                  让助手帮我找实验
                </Button>
              </Link>
            </div>
          ) : null}
        </div>

        {brief.overlaps.length > 0 ? (
          <section className="mt-4">
            <h2 className="section-title mb-2">时间撞车</h2>
            <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
              {brief.overlaps.map((o, i) => (
                <li key={`${o.firstTitle}-${o.secondTitle}-${i}`} className="px-3.5 py-2.5">
                  <p className="text-[13px] text-ink">
                    「{o.firstTitle}」和「{o.secondTitle}」有重叠
                  </p>
                  <p className="num mt-0.5 text-[11px] text-ink-soft">重叠区间 {o.overlapLabel}</p>
                </li>
              ))}
            </ul>
            <p className="mt-2 px-1 text-[11px] leading-5 text-ink-soft">
              取消或改约请到「我的预约」里操作 —— 这里只提醒，不替你改。
            </p>
          </section>
        ) : null}

        <section className="mt-4">
          <h2 className="section-title mb-2">接下来的安排</h2>
          {brief.upcoming.length === 0 ? (
            <div className="rounded-card border border-dashed border-line bg-surface/60 px-4 py-8 text-center">
              <CalendarClock size={22} className="mx-auto text-ink-soft/60" strokeWidth={1.6} />
              <p className="mt-2 text-[12px] text-ink-soft">接下来是空的，去首页找几个实验吧。</p>
              <div className="mt-3">
                <Link href="/">
                  <Button variant="outline" size="md">
                    去找实验
                  </Button>
                </Link>
              </div>
            </div>
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
              {brief.upcoming.map((a) => (
                <li key={a.id}>
                  <Link
                    href={`/experiments/${a.experimentId}`}
                    className="flex items-start gap-3 px-3.5 py-3 active:bg-mist"
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-[14px] font-medium text-ink">
                        {a.experimentTitle}
                      </span>
                      <span className="num mt-0.5 text-[12px] text-moss">
                        {formatDayCN(a.startAt)} {formatHM(a.startAt)}–{formatHM(a.endAt)}
                      </span>
                      <span className="mt-0.5 truncate text-[11px] text-ink-soft">
                        {a.location}
                        {a.researcherName ? ` · ${a.researcherName}` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 rounded-full bg-mist px-2 py-0.5 text-[10px] text-ink-soft">
                      {appointmentStatusLabel[a.status as AppointmentStatus] ?? a.status}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="mt-4 mb-4 px-1 text-center text-[11px] leading-5 text-ink-soft">
          这里只帮你「看」安排。想找新实验，去
          <Link href="/assistant/chat" className="mx-0.5 text-moss underline">
            和助手聊聊
          </Link>
          。
        </p>
      </div>

      <TabBar role="SUBJECT" />
    </main>
  );
}
