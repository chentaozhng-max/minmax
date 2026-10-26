/**
 * 验收自测脚本（直接打数据库，验证四件核心事）：
 *   1. 并发抢同一个容量 1 的时段，只有 1 个成功（防超卖）
 *   2. 三名被试被分到互不相同的时段
 *   3. 未到场累计 4 次的禁期阶梯（1/1/1/7 天）
 *   4. 主试取消实验时，≥24h 与 <24h 的预约分别结算
 *
 * 运行：npm run accept
 * 脚本自建临时数据并在结束时清理，不动 seed 出来的演示数据。
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { bookSlot } from "../src/server/appointments";
import { penalizeTx } from "../src/server/credit";
import { applyPenalty } from "../src/lib/credit";

const DAY = 24 * 3600 * 1000;
let pass = 0;
let fail = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    pass += 1;
    console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail += 1;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function cleanup(tag: string) {
  const users = await prisma.user.findMany({ where: { phone: { startsWith: tag } } });
  const ids = users.map((u) => u.id);
  if (ids.length === 0) return;
  const experiments = await prisma.experiment.findMany({ where: { researcherId: { in: ids } } });
  await prisma.appointment.deleteMany({
    where: { OR: [{ subjectId: { in: ids } }, { experimentId: { in: experiments.map((e) => e.id) } }] },
  });
  await prisma.creditEvent.deleteMany({ where: { userId: { in: ids } } });
  await prisma.chatSession.deleteMany({ where: { subjectId: { in: ids } } });
  await prisma.slot.deleteMany({ where: { experimentId: { in: experiments.map((e) => e.id) } } });
  await prisma.experiment.deleteMany({ where: { researcherId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

async function main() {
  const TAG = "1990000";
  await cleanup(TAG);

  const now = new Date();
  const researcher = await prisma.user.create({
    data: {
      phone: `${TAG}0001`,
      role: "RESEARCHER",
      name: "验收主试",
      studentVerified: true,
      creditScore: 100,
    },
  });

  const subjects: { id: string }[] = [];
  for (let i = 0; i < 4; i += 1) {
    subjects.push(
      await prisma.user.create({
        data: {
          phone: `${TAG}100${i}`,
          role: "SUBJECT",
          name: `验收被试${i + 1}`,
          studentVerified: true,
          creditScore: 100,
        },
      }),
    );
  }

  const experiment = await prisma.experiment.create({
    data: {
      researcherId: researcher.id,
      title: "验收实验",
      description: "验收脚本创建的临时实验，脚本结束会删掉。",
      location: "测试地点",
      durationMin: 30,
      rewardText: "¥1",
      type: "INDIVIDUAL",
      minCreditScore: 0,
      needsVerification: false,
      signupDeadline: new Date(now.getTime() + 1 * DAY),
      status: "PUBLISHED",
    },
  });

  const sharedSlot = await prisma.slot.create({
    data: {
      experimentId: experiment.id,
      startAt: new Date(now.getTime() + 2 * DAY),
      endAt: new Date(now.getTime() + 2 * DAY + 30 * 60000),
      capacity: 1,
    },
  });

  console.log("\n[1] 并发抢同一个容量 1 的时段");
  const attempts = await Promise.allSettled([
    bookSlot({ userId: subjects[0].id, slotId: sharedSlot.id, now }),
    bookSlot({ userId: subjects[1].id, slotId: sharedSlot.id, now }),
  ]);
  const fulfilled = attempts.filter((a) => a.status === "fulfilled").length;
  const rejected = attempts
    .filter((a): a is PromiseRejectedResult => a.status === "rejected")
    .map((a) => (a.reason instanceof Error ? a.reason.message : String(a.reason)));
  const afterShared = await prisma.slot.findUniqueOrThrow({ where: { id: sharedSlot.id } });
  check("两次并发只有 1 次成功", fulfilled === 1, `成功 ${fulfilled} 次`);
  check("bookedCount 没有超卖", afterShared.bookedCount === 1, `bookedCount=${afterShared.bookedCount}`);
  check("失败方收到可理解的提示", rejected.length === 1, rejected[0]);

  console.log("\n[2] 三名被试分到不同时段");
  const distinctSlots = [];
  for (let i = 0; i < 3; i += 1) {
    distinctSlots.push(
      await prisma.slot.create({
        data: {
          experimentId: experiment.id,
          startAt: new Date(now.getTime() + (3 + i) * DAY),
          endAt: new Date(now.getTime() + (3 + i) * DAY + 30 * 60000),
          capacity: 1,
        },
      }),
    );
  }
  const booked = [];
  for (let i = 0; i < 3; i += 1) {
    const appointment = await bookSlot({
      userId: subjects[i].id,
      slotId: distinctSlots[i].id,
      now,
    });
    booked.push(appointment.slotId);
  }
  check("三个时段互不相同", new Set(booked).size === 3, booked.join(", "));

  console.log("\n[3] 未到场禁期阶梯");
  let snapshot = { creditScore: 100, noShowCount: 0, bannedUntil: null as Date | null };
  const banDays: number[] = [];
  for (let i = 0; i < 5; i += 1) {
    const next = applyPenalty(snapshot, now);
    banDays.push(Math.round(((next.bannedUntil?.getTime() ?? 0) - now.getTime()) / DAY));
    snapshot = { creditScore: next.creditScore, noShowCount: next.noShowCount, bannedUntil: null };
  }
  check("1–3 次禁 1 天，4–5 次禁 7 天", JSON.stringify(banDays) === JSON.stringify([1, 1, 1, 7, 7]), banDays.join("/"));

  const penalized = await prisma.$transaction((tx) =>
    penalizeTx(tx, { userId: subjects[3].id, reason: "NO_SHOW", now }),
  );
  const penalizedUser = await prisma.user.findUniqueOrThrow({ where: { id: subjects[3].id } });
  check("扣分写入数据库", penalizedUser.creditScore === 98 && penalizedUser.noShowCount === 1);
  check("禁期已设置", Boolean(penalizedUser.bannedUntil) && penalized.bannedUntil !== null);

  console.log("\n[4] 主试取消实验：≥24h 与 <24h 分别结算");
  const cancelExperiment = await prisma.experiment.create({
    data: {
      researcherId: researcher.id,
      title: "取消验收实验",
      description: "用于验证逐条判断是否 < 24 小时。",
      location: "测试地点",
      durationMin: 30,
      rewardText: "¥1",
      type: "INDIVIDUAL",
      minCreditScore: 0,
      needsVerification: false,
      signupDeadline: new Date(now.getTime() + 1 * DAY),
      status: "PUBLISHED",
    },
  });
  const earlySlot = await prisma.slot.create({
    data: {
      experimentId: cancelExperiment.id,
      startAt: new Date(now.getTime() + 3 * DAY),
      endAt: new Date(now.getTime() + 3 * DAY + 30 * 60000),
      capacity: 1,
    },
  });
  const lateSlot = await prisma.slot.create({
    data: {
      experimentId: cancelExperiment.id,
      startAt: new Date(now.getTime() + 6 * 3600 * 1000),
      endAt: new Date(now.getTime() + 6 * 3600 * 1000 + 30 * 60000),
      capacity: 1,
    },
  });
  await prisma.appointment.create({
    data: {
      experimentId: cancelExperiment.id,
      slotId: earlySlot.id,
      subjectId: subjects[0].id,
      status: "CONFIRMED",
    },
  });
  await prisma.appointment.create({
    data: {
      experimentId: cancelExperiment.id,
      slotId: lateSlot.id,
      subjectId: subjects[1].id,
      status: "CONFIRMED",
    },
  });

  const beforeResearcher = await prisma.user.findUniqueOrThrow({ where: { id: researcher.id } });
  const { cancelExperimentByResearcher } = await import("../src/server/appointments");
  const result = await cancelExperimentByResearcher(cancelExperiment.id, researcher.id, now);
  const afterResearcher = await prisma.user.findUniqueOrThrow({ where: { id: researcher.id } });
  const cancelEvents = await prisma.creditEvent.count({
    where: { userId: researcher.id, reason: "RESEARCHER_CANCEL" },
  });

  check("总处理 2 条预约", result.total === 2, `total=${result.total}`);
  check("1 条计罚 / 1 条免罚", result.penalized === 1 && result.waived === 1);
  check(
    "主试只扣 2 分",
    beforeResearcher.creditScore - afterResearcher.creditScore === 2,
    `${beforeResearcher.creditScore} → ${afterResearcher.creditScore}`,
  );
  check("noShowCount 只 +1", afterResearcher.noShowCount - beforeResearcher.noShowCount === 1);
  check("只写 1 条 CreditEvent", cancelEvents === 1, `events=${cancelEvents}`);

  const earlyAppointment = await prisma.appointment.findFirstOrThrow({
    where: { slotId: earlySlot.id },
  });
  const lateAppointment = await prisma.appointment.findFirstOrThrow({
    where: { slotId: lateSlot.id },
  });
  check(
    "两条预约都被置为 CANCELLED_BY_RESEARCHER",
    earlyAppointment.status === "CANCELLED_BY_RESEARCHER" &&
      lateAppointment.status === "CANCELLED_BY_RESEARCHER",
  );

  console.log("\n[5] 一键签到 → 主试确认到场 → 双方 +1");
  const liveSlot = await prisma.slot.create({
    data: {
      experimentId: experiment.id,
      startAt: new Date(now.getTime() - 10 * 60000),
      endAt: new Date(now.getTime() + 20 * 60000),
      capacity: 1,
    },
  });
  const liveAppointment = await prisma.appointment.create({
    data: {
      experimentId: experiment.id,
      slotId: liveSlot.id,
      subjectId: subjects[2].id,
      status: "CONFIRMED",
    },
  });
  const { checkIn, verifyAttendance } = await import("../src/server/appointments");
  const checked = await checkIn(liveAppointment.id, subjects[2].id, now);
  check("签到不需要任何码，直接变成 CHECKED_IN", checked.status === "CHECKED_IN");

  const subjectBefore = await prisma.user.findUniqueOrThrow({ where: { id: subjects[2].id } });
  // 先降到 95，才能观察到 +1（满 100 时加分会被上限吃掉，这是预期行为）
  await prisma.user.update({ where: { id: subjects[2].id }, data: { creditScore: 95 } });
  const researcherBefore = await prisma.user.findUniqueOrThrow({ where: { id: researcher.id } });
  const verified = await verifyAttendance(liveAppointment.id, researcher.id, now);
  const subjectAfter = await prisma.user.findUniqueOrThrow({ where: { id: subjects[2].id } });
  const researcherAfter = await prisma.user.findUniqueOrThrow({ where: { id: researcher.id } });
  check("主试确认后置为 COMPLETED", verified.status === "COMPLETED");
  check(
    "被试 +1",
    subjectAfter.creditScore - 95 === 1,
    `95 → ${subjectAfter.creditScore}（原 ${subjectBefore.creditScore} 已是上限，先降到 95 再验）`,
  );
  check(
    "主试也 +1",
    researcherAfter.creditScore - researcherBefore.creditScore === 1,
    `${researcherBefore.creditScore} → ${researcherAfter.creditScore}`,
  );

  console.log("\n[6] 申诉 48 小时无回应 → 自动成立并结算主试");
  const appealSlot = await prisma.slot.create({
    data: {
      experimentId: experiment.id,
      startAt: new Date(now.getTime() - 5 * 3600 * 1000),
      endAt: new Date(now.getTime() - 4 * 3600 * 1000),
      capacity: 1,
      bookedCount: 1,
    },
  });
  const appealAppointment = await prisma.appointment.create({
    data: {
      experimentId: experiment.id,
      slotId: appealSlot.id,
      subjectId: subjects[3].id,
      status: "CHECKED_IN",
      checkedInAt: new Date(now.getTime() - 4.5 * 3600 * 1000),
      appealStatus: "PENDING",
      appealAt: new Date(now.getTime() - 49 * 3600 * 1000),
    },
  });
  const researcherBeforeAppeal = await prisma.user.findUniqueOrThrow({ where: { id: researcher.id } });
  const { jobAutoUpholdAppeals } = await import("../src/server/scheduler");
  const job = await jobAutoUpholdAppeals(now);
  const appealAfter = await prisma.appointment.findUniqueOrThrow({
    where: { id: appealAppointment.id },
  });
  const researcherAfterAppeal = await prisma.user.findUniqueOrThrow({ where: { id: researcher.id } });

  check("到期申诉被处理", job.affected >= 1, `affected=${job.affected}`);
  check("申诉状态置为 UPHELD", appealAfter.appealStatus === "UPHELD");
  check("预约改为 CANCELLED_BY_RESEARCHER", appealAfter.status === "CANCELLED_BY_RESEARCHER");
  check(
    "主试被扣 2 分",
    researcherBeforeAppeal.creditScore - researcherAfterAppeal.creditScore === 2,
    `${researcherBeforeAppeal.creditScore} → ${researcherAfterAppeal.creditScore}`,
  );
  check(
    "主试 noShowCount +1",
    researcherAfterAppeal.noShowCount - researcherBeforeAppeal.noShowCount === 1,
  );

  await cleanup(TAG);

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  if (fail > 0) process.exitCode = 1;
}

main()
  .catch(async (error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
