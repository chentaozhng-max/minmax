import { prisma } from "@/lib/prisma";
import { clearExpiredBans, penalizeTx } from "@/server/credit";

/**
 * 定时任务（等价于 BullMQ 的 repeatable job）。
 * 本地/单机部署时用进程内定时器即可；迁移到多实例时换成 BullMQ + Redis，任务体不变。
 */

const TEN_MIN = 10 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;
const FORTY_EIGHT_H = 48 * 60 * 60 * 1000;

type JobResult = { job: string; affected: number };

/** 1. 清理过期禁期（noShowCount 保留） */
export async function jobClearBans(now = new Date()): Promise<JobResult> {
  const count = await clearExpiredBans(now);
  return { job: "clear-expired-bans", affected: count };
}

/**
 * 2. 实验结束 48h 仍为 CONFIRMED → 提醒主试（写 remindedAt）；
 *    提醒后再次 48h 仍未处理 → 自动置 COMPLETED，不扣分不加分。
 */
export async function jobSweepConfirmed(now = new Date()): Promise<JobResult> {
  const candidates = await prisma.appointment.findMany({
    where: { status: "CONFIRMED" },
    include: { slot: true },
  });

  let affected = 0;
  for (const appointment of candidates) {
    const endedAt = appointment.slot.endAt.getTime();
    if (endedAt + FORTY_EIGHT_H > now.getTime()) continue;

    if (!appointment.remindedAt) {
      await prisma.appointment.update({
        where: { id: appointment.id },
        data: { remindedAt: now },
      });
      affected += 1;
      continue;
    }

    if (appointment.remindedAt.getTime() + FORTY_EIGHT_H <= now.getTime()) {
      await prisma.appointment.update({
        where: { id: appointment.id },
        data: { status: "COMPLETED" },
      });
      affected += 1;
    }
  }
  return { job: "sweep-confirmed", affected };
}

/** 3. 申诉 48h 无回应 → 自动 UPHELD，并按规则结算主试 */
export async function jobAutoUpholdAppeals(now = new Date()): Promise<JobResult> {
  const pending = await prisma.appointment.findMany({
    where: { appealStatus: "PENDING" },
  });

  let affected = 0;
  for (const appointment of pending) {
    if (!appointment.appealAt) continue;
    if (appointment.appealAt.getTime() + FORTY_EIGHT_H > now.getTime()) continue;

    await prisma.$transaction(async (tx) => {
      await tx.appointment.update({
        where: { id: appointment.id },
        data: {
          status: "CANCELLED_BY_RESEARCHER",
          appealStatus: "UPHELD",
          appealResolvedAt: now,
        },
      });
      const experiment = await tx.experiment.findUnique({
        where: { id: appointment.experimentId },
        select: { researcherId: true, title: true },
      });
      if (experiment) {
        await penalizeTx(tx, {
          userId: experiment.researcherId,
          reason: "RESEARCHER_NO_SHOW",
          appointmentId: appointment.id,
          note: `${experiment.title} 申诉超时未处理，自动成立`,
          now,
        });
      }
    });
    affected += 1;
  }
  return { job: "auto-uphold-appeals", affected };
}

export async function runAllJobs(now = new Date()) {
  const results: JobResult[] = [];
  results.push(await jobClearBans(now));
  results.push(await jobSweepConfirmed(now));
  results.push(await jobAutoUpholdAppeals(now));
  return results;
}

let started = false;

export function startScheduler() {
  if (started) return;
  if (process.env.DISABLE_SCHEDULER === "true") return;
  started = true;

  const guard = (name: string) => async () => {
    try {
      await runAllJobs();
    } catch (error) {
      console.warn(`[scheduler] ${name} 执行失败`, error);
    }
  };

  // 启动 20 秒后跑一次，然后每 10 分钟
  setTimeout(guard("boot"), 20_000);
  setInterval(guard("10min"), TEN_MIN);
  // 每小时补一次（覆盖上诉 48h / 主试提醒）
  setInterval(guard("1h"), ONE_HOUR);
  console.log("[scheduler] 已启动：禁期清理 / 主试提醒 / 申诉自动成立");
}
