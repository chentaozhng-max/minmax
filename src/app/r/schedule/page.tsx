import Link from "next/link";
import { requirePage } from "@/lib/page-auth";
import { PageHeader } from "@/components/page-header";
import { TabBar } from "@/components/tab-bar";
import { makeDefaultScheduleQuery } from "@/adapters/db/prisma/schedule-query";
import { appointmentStatusLabel, type AppointmentStatus } from "@/lib/domain";
import { formatDayCN, formatHM } from "@/lib/time";
import { Download } from "lucide-react";

/**
 * 主试的日程总表 —— 我名下所有实验的所有时段，一屏看完。
 *
 * 以时段为基表（Slot 为行骨架）：没人报名的时段照样出现，显示「空位」。
 * 主试要的是「我哪天有空、哪天有人」，不是「谁报过名」。
 */
export default async function SchedulePage() {
  const session = await requirePage("RESEARCHER");
  const rows = await makeDefaultScheduleQuery().listSchedule({ researcherId: session.sub });

  // 按实验分组 → 组内按时段分组
  const byExperiment = new Map<
    string,
    { title: string; slots: Map<string, { startAt: Date; endAt: Date; capacity: number; rows: typeof rows }> }
  >();

  for (const row of rows) {
    let exp = byExperiment.get(row.experimentId);
    if (!exp) {
      exp = { title: row.experimentTitle, slots: new Map() };
      byExperiment.set(row.experimentId, exp);
    }
    let slot = exp.slots.get(row.slotId);
    if (!slot) {
      slot = { startAt: row.startAt, endAt: row.endAt, capacity: row.capacity, rows: [] };
      exp.slots.set(row.slotId, slot);
    }
    slot.rows.push(row);
  }

  const totalBooked = rows.filter((r) => r.appointmentId).length;

  return (
    <main className="shell tabbar-space">
      <PageHeader title="日程总表" subtitle={`${byExperiment.size} 个实验 · ${totalBooked} 人已报名`} profile={{ role: "RESEARCHER" }} />

      <div className="px-4 pt-3">
        {byExperiment.size === 0 ? (
          <p className="rounded-card border border-dashed border-line bg-surface/60 px-4 py-10 text-center text-[12px] text-ink-soft">
            还没有发布任何实验。发布后，每个时段都会出现在这里，哪怕还没人报名。
          </p>
        ) : (
          [...byExperiment.entries()].map(([experimentId, exp]) => (
            <section key={experimentId} className="mb-4">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <Link
                  href={`/r/experiments/${experimentId}`}
                  className="truncate text-[14px] font-semibold text-ink"
                >
                  {exp.title}
                </Link>
                <a
                  href={`/api/r/experiments/${experimentId}/export`}
                  className="flex shrink-0 items-center gap-1 rounded-full border border-line px-2 py-1 text-[11px] text-moss"
                >
                  <Download size={12} strokeWidth={2.2} />
                  导出
                </a>
              </div>

              <div className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
                {[...exp.slots.entries()].map(([slotId, slot]) => {
                  const filled = slot.rows.filter((r) => r.appointmentId);
                  return (
                    <div key={slotId} className="px-3 py-2.5">
                      <div className="flex items-baseline justify-between">
                        <span className="num text-[13px] font-medium text-ink">
                          {formatDayCN(slot.startAt)} {formatHM(slot.startAt)}–{formatHM(slot.endAt)}
                        </span>
                        <span className="num text-[11px] text-ink-soft">
                          {filled.length}/{slot.capacity}
                        </span>
                      </div>

                      {filled.length === 0 ? (
                        <p className="mt-1 text-[11px] text-ink-soft/70">空位</p>
                      ) : (
                        <ul className="mt-1 space-y-0.5">
                          {filled.map((r) => (
                            <li key={r.appointmentId} className="flex items-baseline justify-between gap-2">
                              <span className="truncate text-[12px] text-ink">
                                {r.subject?.name}
                                {r.subject?.school ? (
                                  <span className="ml-1 text-[11px] text-ink-soft">{r.subject.school}</span>
                                ) : null}
                              </span>
                              <span className="shrink-0 text-[11px] text-ink-soft">
                                {r.appointmentStatus
                                  ? appointmentStatusLabel[r.appointmentStatus as AppointmentStatus] ?? r.appointmentStatus
                                  : ""}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))
        )}

        <p className="mb-4 text-center text-[11px] leading-5 text-ink-soft">
          导出的 CSV 用 Excel 双击即可打开（已带 UTF-8 BOM，中文不乱码）。
        </p>
      </div>

      <TabBar role="RESEARCHER" />
    </main>
  );
}
