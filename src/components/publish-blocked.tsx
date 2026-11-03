import Link from "next/link";
import { CalendarX2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { banDaysLeft, banUntilText } from "@/domain/experiment-rules";

/**
 * 禁发布拦截页。
 *
 * 以前这个判定只在 POST /api/experiments 里 —— 主试把标题、说明、时段全填完，
 * 点「发布」才被一句 403 顶回来，前面十几分钟白填。
 * 现在进发布页的第一屏就是这个，按钮根本不用点。
 *
 * 文案要给出三件事：为什么、到哪天、现在能做什么（申诉）。
 */
export function PublishBlocked({ bannedUntil, now }: { bannedUntil: Date; now: Date }) {
  const days = banDaysLeft(bannedUntil, now);

  return (
    <main className="shell">
      <PageHeader title="发布实验" back="/r/experiments" profile={{ role: "RESEARCHER" }} />

      <div className="px-4 pt-8">
        <div className="rounded-card border border-warn/30 bg-surface p-5">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-warn/10 text-warn">
            <CalendarX2 size={22} strokeWidth={1.9} />
          </span>

          <h2 className="mt-3 text-center text-[16px] font-semibold text-ink">
            你现在不能发布实验
          </h2>
          <p className="mt-1.5 text-center text-[13px] leading-6 text-ink-soft">
            因累计未到场，禁发布至{" "}
            <span className="num text-ink">{banUntilText(bannedUntil)}</span>
            {days > 0 ? (
              <>
                （还有 <span className="num text-ink">{days}</span> 天）
              </>
            ) : null}
            。
          </p>

          <div className="mt-3 rounded-[8px] bg-mist/70 px-3 py-2.5">
            <p className="text-[12px] leading-5 text-ink-soft">
              规则：1–3 次未到场禁 1 天，4 次起禁 7 天。禁期到点自动解除，不用另行申请。
              如果这次未到场有争议（比如临时停课、系统没提醒），可以先申诉，成立后会撤销记录。
            </p>
          </div>

          <div className="mt-4 flex gap-2">
            <Link href="/r/appeals" className="flex-1">
              <Button variant="outline" size="lg" block>
                去申诉
              </Button>
            </Link>
            <Link href="/r/experiments" className="flex-1">
              <Button size="lg" block>
                返回我的实验
              </Button>
            </Link>
          </div>
        </div>

        <p className="mt-3 px-1 text-center text-[11px] leading-5 text-ink-soft">
          已有实验的编辑、下架和预约处理不受影响，只是不能新发布实验。
        </p>
      </div>
    </main>
  );
}
