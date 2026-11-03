import { prisma } from "@/lib/prisma";
import { clearExpiredBans, penalizeTx } from "@/server/credit";
import { makeDefaultNotificationRepository } from "@/adapters/db/prisma/notification-repo";
import { getLlm } from "@/adapters/llm";
import { sendDueReminders } from "@/application/send-reminders";

/**
 * 定时任务（等价于 BullMQ 的 repeatable job）。
 * 本地/单机部署时用进程内定时器即可；迁移到多实例时换成 BullMQ + Redis，任务体不变。
 */

const ONE_MIN = 60 * 1000;
const TEN_MIN = 10 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;

/** 定时器间隔（导出是为了让单测能断言「扫描间隔 << 最窄提醒窗口」这条不变量） */
export const SCHEDULER_INTERVALS = {
  /** 提醒扫描间隔 */
  reminders: ONE_MIN,
  /** 其余 4 个 job 的间隔 */
  heavy: TEN_MIN,
  /** 兜底全量扫描 */
  sweep: ONE_HOUR,
} as const;
const FORTY_EIGHT_H = 48 * 60 * 60 * 1000;
/** 锁定（待被试确认）保留多久，超时自动释放 */
const LOCK_TIMEOUT_MIN = 30;

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

/**
 * 4. 锁定超时释放：PENDING_SUBJECT_CONFIRM 超过 30 分钟没确认 → 自动取消并还名额。
 *    之前没有任何 job 处理这个状态，被试手滑锁完退出，那一格就永久显示已约满。
 */
export async function jobExpireStaleLocks(now = new Date()): Promise<JobResult> {
  const cutoff = new Date(now.getTime() - LOCK_TIMEOUT_MIN * 60 * 1000);
  const stale = await prisma.appointment.findMany({
    where: { status: "PENDING_SUBJECT_CONFIRM", createdAt: { lt: cutoff } },
  });

  let affected = 0;
  for (const appointment of stale) {
    await prisma.$transaction(async (tx) => {
      await tx.appointment.update({
        where: { id: appointment.id },
        data: { status: "CANCELLED_BY_SUBJECT" },
      });
      await tx.$executeRaw`
        UPDATE "Slot" SET "bookedCount" = MAX("bookedCount" - 1, 0) WHERE "id" = ${appointment.slotId}
      `;
    });
    affected += 1;
  }
  return { job: "expire-stale-locks", affected };
}
/**
 * 5. 到时提醒：提前 3 小时 / 1 小时 / 10 分钟，给被试发一条站内消息。
 *
 * 分工：**代码决定何时、给谁、哪一档**（pickReminderLevel 是纯时间判断），
 * **模型只决定那句话怎么说**，模型不可用时退回模板。
 * 所以这里没有常驻 Agent，也没有延迟任务队列 —— 每条提醒一次同步调用。
 *
 * 幂等靠 Notification 的 `(appointmentId, level)` 唯一约束，不靠任何状态字段。
 */
export async function jobSendReminders(now = new Date()) {
  return sendDueReminders(
    { notifications: makeDefaultNotificationRepository(), llm: getLlm() },
    now,
  );
}

/**
 * 只有提醒跑 1 分钟粒度，其余 job 10 分钟一次。
 *
 * 为什么分开：**扫描间隔必须显著小于最小提醒窗口**。
 * 最窄的一档是 M10（窗口 `(0, 10min]`），原来扫描也是 10 分钟一次 ——
 * 窗口宽度和间隔相等 = 零余量，setInterval 累积漂移 / 一次部署重启 /
 * 事件循环被前一个 job 卡住，任意一件发生就从「理论不漏」变成「真漏」。
 *
 * 分开跑也顺带保住了性能：4 个重 job（全表扫 CONFIRMED / PENDING）还是 10 分钟一次，
 * 1 分钟只跑一个候选窗口查询，代价很小。
 */
export async function runDueReminders(now = new Date()) {
  return jobSendReminders(now);
}

/** 除提醒外的 4 个 job，10 分钟粒度足够（最短的业务时限是锁定 30 分钟释放） */
export async function runHeavyJobs(now = new Date()) {
  const results: JobResult[] = [];
  results.push(await jobClearBans(now));
  results.push(await jobSweepConfirmed(now));
  results.push(await jobAutoUpholdAppeals(now));
  results.push(await jobExpireStaleLocks(now));
  return results;
}

/** 一次跑全部（accept 脚本 / 手动触发用；定时器走的是上面拆分后的两个） */
export async function runAllJobs(now = new Date()) {
  const results = await runHeavyJobs(now);
  results.push(await jobSendReminders(now));
  return results;
}

let started = false;

export function startScheduler() {
  if (started) return;
  if (process.env.DISABLE_SCHEDULER === "true") return;
  started = true;

  const guard = (name: string, run: () => Promise<unknown>) => async () => {
    try {
      await run();
    } catch (error) {
      console.warn(`[scheduler] ${name} 执行失败`, error);
    }
  };

  const runHeavy = () => runHeavyJobs(new Date());
  const runReminders = () => runDueReminders(new Date());

  // 启动 20 秒后先扫一遍，把「服务没起来那段时间」该发的补上
  setTimeout(guard("boot", () => runAllJobs(new Date())), 20_000);

  // 提醒：1 分钟粒度（最小窗口 M10 是 10 分钟，留 10 倍余量）
  setInterval(guard("1min-reminders", runReminders), SCHEDULER_INTERVALS.reminders);
  // 其余 job：10 分钟（最短业务时限是锁定 30 分钟释放，留 3 倍余量）
  setInterval(guard("10min-heavy", runHeavy), SCHEDULER_INTERVALS.heavy);
  // 每小时兜底跑一次全部（重活 + 提醒），防止 1 分钟定时器意外失效
  setInterval(guard("1h-sweep", () => runAllJobs(new Date())), SCHEDULER_INTERVALS.sweep);

  console.log(
    "[scheduler] 已启动：提醒 1 分钟 / 禁期清理·主试提醒·申诉自动成立·锁定超时释放 10 分钟",
  );
}
