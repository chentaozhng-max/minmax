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
  await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
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

  console.log("\n[7] 团体实验：容量被强制改成 groupSize，第 groupSize+1 人被拒");
  const { publishExperiment } = await import("../src/application/publish-experiment");
  const { makeDefaultPublishRepository } = await import(
    "../src/adapters/db/prisma/experiment-publish-repo"
  );

  // +8 天，避开前面 +2/+3/+4/+5/+6 天的已占用时段，防止撞上时间冲突规则
  const groupStart = new Date(now.getTime() + 8 * DAY);
  const published = await publishExperiment(
    {
      userId: researcher.id,
      title: "团体验收实验",
      description: "验证团体实验容量强制等于 groupSize。",
      location: "测试地点",
      durationMin: 30,
      rewardText: "¥1",
      type: "GROUP",
      groupSize: 3,
      minCreditScore: 0,
      needsVerification: false,
      signupDeadline: new Date(now.getTime() + 4 * DAY).toISOString(),
      // ★ 主试故意填 capacity: 1 —— 应被改写成 3
      slots: [
        { startAt: groupStart.toISOString(), endAt: new Date(groupStart.getTime() + 30 * 60000).toISOString(), capacity: 1 },
      ],
      publish: true,
      now,
    },
    {
      repo: makeDefaultPublishRepository(),
      loadPublisher: async (id: string) => ({ id, bannedUntil: null }),
    },
  );

  const groupSlot = await prisma.slot.findFirstOrThrow({
    where: { experimentId: published.id },
  });
  check("主试填 capacity:1 被纠正为 groupSize=3", groupSlot.capacity === 3, `capacity=${groupSlot.capacity}`);

  // 前面几节已经给 subjects[0..3] 建了预约、还给 subjects[3] 加了禁期，
  // 团体这节用 4 个干净的被试，避免撞上时间冲突与封禁规则。
  const groupSubjects: { id: string }[] = [];
  for (let i = 0; i < 4; i += 1) {
    groupSubjects.push(
      await prisma.user.create({
        data: {
          phone: `${TAG}200${i}`,
          role: "SUBJECT",
          name: `团体验收被试${i + 1}`,
          studentVerified: true,
          creditScore: 100,
        },
      }),
    );
  }

  const groupTries = await Promise.allSettled([
    bookSlot({ userId: groupSubjects[0].id, slotId: groupSlot.id, now }),
    bookSlot({ userId: groupSubjects[1].id, slotId: groupSlot.id, now }),
    bookSlot({ userId: groupSubjects[2].id, slotId: groupSlot.id, now }),
    bookSlot({ userId: groupSubjects[3].id, slotId: groupSlot.id, now }),
  ]);
  const groupOk = groupTries.filter((r) => r.status === "fulfilled").length;
  const groupAfter = await prisma.slot.findUniqueOrThrow({ where: { id: groupSlot.id } });
  check("恰好 3 人成团", groupOk === 3, `成功 ${groupOk} 次`);
  check("第 4 人被拒且不超卖", groupAfter.bookedCount === 3, `bookedCount=${groupAfter.bookedCount}`);

  console.log("\n[8] 到时提醒：3 小时前发一条，重复执行不重发");
  const { sendDueReminders } = await import("../src/application/send-reminders");
  const { makeDefaultNotificationRepository } = await import(
    "../src/adapters/db/prisma/notification-repo"
  );

  // 用假 LLM（未配置）锁死降级路径：验收要的是「不丢通知」，不是「模型文案好不好」。
  // 真打网络会让验收多一个不确定源，且慢。
  const stubLlm = {
    configured: () => false,
    chat: async () => {
      throw new Error("验收里不该真的调用模型");
    },
  };

  const reminderStart = new Date(now.getTime() + 3 * 3600 * 1000);
  const reminderSlot = await prisma.slot.create({
    data: {
      experimentId: published.id,
      startAt: reminderStart,
      endAt: new Date(reminderStart.getTime() + 30 * 60000),
      capacity: 3,
    },
  });
  const reminderAppointment = await prisma.appointment.create({
    data: {
      experimentId: published.id,
      slotId: reminderSlot.id,
      subjectId: groupSubjects[0].id,
      status: "CONFIRMED",
    },
  });

  const reminderDeps = {
    notifications: makeDefaultNotificationRepository(),
    llm: stubLlm,
  };
  const firstRun = await sendDueReminders(reminderDeps, now);
  const mine = await prisma.notification.findMany({
    where: { appointmentId: reminderAppointment.id },
  });

  check("3 小时前的预约生成了提醒", mine.length === 1, `count=${mine.length}`);
  check("档位是 H3", mine[0]?.level === "H3", `level=${mine[0]?.level}`);
  check(
    "模型不可用时用模板兜底，文案非空且带实验名",
    Boolean(mine[0]?.content) && mine[0].content.includes("团体验收实验"),
  );
  check("默认未读", mine[0]?.readAt === null);

  const secondRun = await sendDueReminders(reminderDeps, now);
  const afterSecond = await prisma.notification.count({
    where: { appointmentId: reminderAppointment.id },
  });

  check("重复执行不重发（幂等）", afterSecond === 1, `count=${afterSecond}`);
  check("重复的那次计入 skipped", secondRun.skipped >= 1, `skipped=${secondRun.skipped}`);
  check(
    "两次都没走模型（未配置 LLM → 全模板）",
    firstRun.fallback >= 1 && secondRun.fallback === 0,
    `first.fallback=${firstRun.fallback} second.fallback=${secondRun.fallback}`,
  );

  const unreadBefore = await makeDefaultNotificationRepository().countUnread(groupSubjects[0].id);
  const marked = await makeDefaultNotificationRepository().markAllRead(
    groupSubjects[0].id,
    new Date(now.getTime() + 1000),
  );
  const unreadAfter = await makeDefaultNotificationRepository().countUnread(groupSubjects[0].id);

  check("未读数在标记已读后归零", unreadBefore >= 1 && unreadAfter === 0, `${unreadBefore} → ${unreadAfter}`);
  check("标记已读返回受影响条数", marked === unreadBefore, `marked=${marked}`);

  console.log("\n[9] 日程表：以 Slot 为基表，0 人报名也有行；导出 CSV 可被 Excel 打开");
  const { makeDefaultScheduleQuery } = await import("../src/adapters/db/prisma/schedule-query");
  const { buildScheduleCsv } = await import("../src/application/export-schedule");

  // 造一个「没有任何预约」的实验：这是「打墙」场景的直接验证
  const emptyStart = new Date(now.getTime() + 9 * DAY);
  const emptyExperiment = await prisma.experiment.create({
    data: {
      researcherId: researcher.id,
      title: "空日程验收实验",
      description: "用来验证 0 人报名时日程表仍有行骨架。",
      location: "测试地点",
      durationMin: 30,
      rewardText: "¥1",
      type: "GROUP",
      groupSize: 2,
      minCreditScore: 0,
      needsVerification: false,
      signupDeadline: new Date(now.getTime() + 5 * DAY),
      status: "PUBLISHED",
    },
  });
  await prisma.slot.create({
    data: {
      experimentId: emptyExperiment.id,
      startAt: emptyStart,
      endAt: new Date(emptyStart.getTime() + 30 * 60000),
      capacity: 2,
    },
  });

  const emptyRows = await makeDefaultScheduleQuery().listSchedule({
    experimentId: emptyExperiment.id,
    researcherId: researcher.id,
  });

  check("0 人报名时日程表仍有 1 行（不是空表）", emptyRows.length === 1, `rows=${emptyRows.length}`);
  check("那行没有预约但有时段信息", emptyRows[0]?.appointmentId === null && Boolean(emptyRows[0]?.slotId));
  check("团体实验的 groupSize 透出来了", emptyRows[0]?.groupSize === 2, `groupSize=${emptyRows[0]?.groupSize}`);

  const csv = buildScheduleCsv(emptyRows);
  check("CSV 以 UTF-8 BOM 开头（Excel 中文不乱码）", csv.startsWith("\uFEFF"));
  check("CSV 用 CRLF 行尾", csv.includes("\r\n"));
  check("空时段在 CSV 里写成「空位」", csv.includes("空位"));
  check("导出时间带年份", csv.includes(String(now.getFullYear())));

  // 归属检查：换个 researcherId 查同一个实验 → 查不到（这正是导出路由的安全边界）
  const foreignRows = await makeDefaultScheduleQuery().listSchedule({
    experimentId: emptyExperiment.id,
    researcherId: "someone-else",
  });
  check("换主试查同一个实验 → 0 行（越权拿不到数据）", foreignRows.length === 0, `rows=${foreignRows.length}`);

  console.log("\n[10] 助手页：跨实验看自己的安排，撞车要点出来");
  const { makeAssistantQuery } = await import("../src/adapters/db/prisma/assistant-query");
  const { buildAssistantBrief } = await import("../src/application/assistant-overview");
  const { ACTIVE_APPOINTMENT_STATUSES } = await import("../src/lib/domain");

  // ⚠️ 必须用专属被试：前面几节已经给 subjects[0] 造了未来预约，
  // 复用他会让「3 场」变成「4 场」—— 这是测试数据隔离问题，不是产品 bug。
  const asstSubject = await prisma.user.create({
    data: {
      phone: `${TAG}9001`,
      role: "SUBJECT",
      name: "助手验收被试",
      studentVerified: true,
      creditScore: 100,
    },
  });
  const asstBase = new Date(now.getTime() + 7 * DAY);
  asstBase.setUTCMinutes(0, 0, 0);

  // 三个实验：甲 15:00-16:00、乙 15:30-16:30（撞甲）、丙 18:00-19:00（不撞）
  const asstPlan = [
    { title: "助手甲", offsetMin: 0, status: "CONFIRMED" },
    { title: "助手乙", offsetMin: 30, status: "CONFIRMED" },
    { title: "助手丙", offsetMin: 180, status: "CONFIRMED" },
  ];
  for (const plan of asstPlan) {
    const startAt = new Date(asstBase.getTime() + plan.offsetMin * 60000);
    const exp = await prisma.experiment.create({
      data: {
        researcherId: researcher.id,
        title: plan.title,
        description: "助手验收用",
        location: "验收楼 101",
        durationMin: 60,
        rewardText: "¥1",
        minCreditScore: 0,
        needsVerification: false,
        signupDeadline: new Date(now.getTime() + 3 * DAY),
        status: "PUBLISHED",
      },
    });
    const slot = await prisma.slot.create({
      data: { experimentId: exp.id, startAt, endAt: new Date(startAt.getTime() + 60 * 60000), capacity: 1, bookedCount: 1 },
    });
    await prisma.appointment.create({
      data: { experimentId: exp.id, slotId: slot.id, subjectId: asstSubject.id, status: plan.status },
    });
  }

  const brief = await buildAssistantBrief(
    { query: makeAssistantQuery(prisma as never), now },
    asstSubject.id,
    [...ACTIVE_APPOINTMENT_STATUSES],
  );

  check("助手能看到 3 场安排（跨 3 个实验）", brief.upcoming.length === 3, `count=${brief.upcoming.length}`);
  check("★ 撞车只报 1 组（甲 vs 乙，丙无关）", brief.overlaps.length === 1, `overlaps=${brief.overlaps.length}`);
  check("撞车的正是甲和乙", brief.overlaps[0]?.firstTitle === "助手甲" && brief.overlaps[0]?.secondTitle === "助手乙");
  check("★ 撞车优先上头条（不是「最近一场」）", brief.headline.includes("撞车") && !brief.headline.includes("最近一场"));
  check("按开始时间升序（甲 < 乙 < 丙）", brief.upcoming[0]?.experimentTitle === "助手甲" && brief.upcoming[2]?.experimentTitle === "助手丙");

  // 换一个「什么都不算占用」的状态列表 → 空，且不打库
  const emptyBrief = await buildAssistantBrief(
    { query: makeAssistantQuery(prisma as never), now },
    asstSubject.id,
    [],
  );
  check("状态列表为空 → 助手显示「没有安排」", emptyBrief.upcoming.length === 0 && emptyBrief.headline.includes("没有安排"));

  console.log("\n[11] 约不了时给出口：能换实验的给按钮，禁期不给；换实验 = 新 session");
  const { isExperimentScopedBlock } = await import("../src/domain/credit");
  const { getOrCreateSession } = await import("../src/server/agent");

  check("★ 信誉门槛是实验级的 → 给「去约别的实验」", isExperimentScopedBlock("CREDIT"));
  check("★ 学生认证是实验级的 → 给「去约别的实验」", isExperimentScopedBlock("VERIFY"));
  check("★ 禁期是用户级的 → 不给按钮（换了也白换）", !isExperimentScopedBlock("BANNED"));

  // 换实验就是新 session：这正是「约不了就换场，不用重置旧会话」的技术依据
  const switchSubject = await prisma.user.create({
    data: {
      phone: `${TAG}9002`,
      role: "SUBJECT",
      name: "换场验收被试",
      studentVerified: true,
      creditScore: 100,
    },
  });
  const expA = await prisma.experiment.create({
    data: {
      researcherId: researcher.id,
      title: "换场实验A",
      description: "验收用",
      location: "验收楼 202",
      durationMin: 30,
      rewardText: "¥1",
      minCreditScore: 0,
      needsVerification: false,
      signupDeadline: new Date(now.getTime() + 3 * DAY),
      status: "PUBLISHED",
    },
  });
  const expB = await prisma.experiment.create({
    data: {
      researcherId: researcher.id,
      title: "换场实验B",
      description: "验收用",
      location: "验收楼 202",
      durationMin: 30,
      rewardText: "¥1",
      minCreditScore: 0,
      needsVerification: false,
      signupDeadline: new Date(now.getTime() + 3 * DAY),
      status: "PUBLISHED",
    },
  });

  const sessionA = await getOrCreateSession(expA.id, switchSubject.id);
  const sessionA2 = await getOrCreateSession(expA.id, switchSubject.id);
  const sessionB = await getOrCreateSession(expB.id, switchSubject.id);

  check("★ 换一门实验 → 拿到另一条 session（不是复用旧的）", sessionA.id !== sessionB.id);
  check("同一门实验再进 → 还是同一条 session（不重复建）", sessionA.id === sessionA2.id);
  check(
    "两条 session 各挂各的实验（上下文不会串）",
    sessionA.experimentId === expA.id && sessionB.experimentId === expB.id,
  );

  console.log("\n[12] 站内「通知栏」：未读数变化能被前端轮询感知到");
  const { diffUnread, unreadToastText } = await import("../src/lib/unread-count");
  const { SCHEDULER_INTERVALS } = await import("../src/server/scheduler");
  const { REMINDER_LEVELS } = await import("../src/domain/reminder-levels");

  // 复用一个专属被试，避免和 §8 的未读计数串味
  const watchSubject = await prisma.user.create({
    data: {
      phone: `${TAG}9003`,
      role: "SUBJECT",
      name: "轮询验收被试",
      studentVerified: true,
      creditScore: 100,
    },
  });
  const watchRepo = makeDefaultNotificationRepository();

  const watchBase = await watchRepo.countUnread(watchSubject.id);
  const firstPoll = diffUnread(null, watchBase);
  check("★ 首屏轮询（prev=null）不弹 —— 历史未读不算新消息", !firstPoll.notify);

  const watchSlot = await prisma.slot.create({
    data: {
      experimentId: published.id,
      startAt: new Date(now.getTime() + 8 * 60000),
      endAt: new Date(now.getTime() + 38 * 60000),
      capacity: 1,
    },
  });
  const watchAppointment = await prisma.appointment.create({
    data: {
      experimentId: published.id,
      slotId: watchSlot.id,
      subjectId: watchSubject.id,
      status: "CONFIRMED",
    },
  });
  await watchRepo.createReminder({
    userId: watchSubject.id,
    appointmentId: watchAppointment.id,
    experimentId: published.id,
    level: "M10",
    content: "轮询验收：还有 8 分钟开场。",
    createdAt: now,
  });

  const watchAfter = await watchRepo.countUnread(watchSubject.id);
  const secondPoll = diffUnread(watchBase, watchAfter);
  check("★ 未读数变多 → 该弹 toast", secondPoll.notify && secondPoll.added === 1, `added=${secondPoll.added}`);
  check("toast 文案带条数", unreadToastText(secondPoll.added).includes("1 条"));

  const thirdPoll = diffUnread(watchAfter, watchAfter);
  check("数字没变 → 不弹（轮询大多数时候必须安静）", !thirdPoll.notify);

  await watchRepo.markAllRead(watchSubject.id, now);
  const watchCleared = await watchRepo.countUnread(watchSubject.id);
  const fourthPoll = diffUnread(watchAfter, watchCleared);
  check("★ 点「全部已读」后数字变小 → 不弹", !fourthPoll.notify);
  check("已读后未读归零", watchCleared === 0, `unread=${watchCleared}`);

  // 扫描粒度：间隔必须显著小于最窄提醒窗口，否则窗口和间隔等宽 = 零容错
  const narrowest = Math.min(...REMINDER_LEVELS.map((s: { aheadMs: number }) => s.aheadMs));
  check(
    "★ 提醒扫描间隔比最窄窗口小 5 倍以上（有容错余量）",
    narrowest / SCHEDULER_INTERVALS.reminders >= 5,
    `最窄窗口 ${narrowest / 60000} 分钟 / 间隔 ${SCHEDULER_INTERVALS.reminders / 60000} 分钟`,
  );
  check(
    "重型 job 仍是 10 分钟粒度（没被连带拖成 1 分钟）",
    SCHEDULER_INTERVALS.heavy === 10 * 60000,
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
