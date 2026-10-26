/**
 * 种子数据。
 * 场景是刻意设计的：
 *  - 主试 陈砚（信誉 100）：10 个容量 1 的时段，用来验证"三个人被分到不同时段"
 *  - 主试 谢秋池（信誉 55）：用来验证列表降权（置末尾 + 灰标）
 *  - 被试 林知夏 100 / 周叙 100 / 许一然 72（用来验证 minCreditScore=80 的拦截）
 *  - 被试 沈栗 已累计 3 次未到场，处于禁报名期
 *  - 一条 CHECKED_IN 的预约 + PENDING 申诉，用来验证 /r/appeals
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SHANGHAI_OFFSET = 8 * 60 * 60 * 1000;

/** 以"上海时区某天某点"构造 UTC Date */
function shanghai(dayOffset: number, hour: number, minute = 0) {
  const now = new Date();
  const shifted = new Date(now.getTime() + SHANGHAI_OFFSET);
  const midnightUtc =
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - SHANGHAI_OFFSET;
  return new Date(midnightUtc + dayOffset * 24 * 60 * 60 * 1000 + hour * 3600000 + minute * 60000);
}

async function main() {
  console.log("清理旧数据…");
  await prisma.creditEvent.deleteMany();
  await prisma.appointment.deleteMany();
  await prisma.chatSession.deleteMany();
  await prisma.slot.deleteMany();
  await prisma.experiment.deleteMany();
  await prisma.verifyCode.deleteMany();
  await prisma.user.deleteMany();

  console.log("创建用户…");
  const chen = await prisma.user.create({
    data: {
      phone: "13800000001",
      role: "RESEARCHER",
      name: "陈砚",
      school: "华东师范大学",
      department: "心理与认知科学学院",
      studentVerified: true,
      studentId: "2022110101",
      eduEmail: "chenyan@psy.ecnu.edu.cn",
      verifiedAt: new Date(),
      creditScore: 100,
    },
  });

  const xie = await prisma.user.create({
    data: {
      phone: "13800000002",
      role: "RESEARCHER",
      name: "谢秋池",
      school: "上海师范大学",
      department: "教育学院心理系",
      studentVerified: false,
      creditScore: 55,
      noShowCount: 4,
      bannedUntil: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
    },
  });

  const lin = await prisma.user.create({
    data: {
      phone: "13900000001",
      role: "SUBJECT",
      name: "林知夏",
      school: "华东师范大学",
      department: "心理学（师范）",
      studentVerified: true,
      studentId: "2023110205",
      eduEmail: "linzhixia@stu.ecnu.edu.cn",
      verifiedAt: new Date(),
      creditScore: 100,
    },
  });

  const zhou = await prisma.user.create({
    data: {
      phone: "13900000002",
      role: "SUBJECT",
      name: "周叙",
      school: "复旦大学",
      department: "社会学",
      studentVerified: true,
      studentId: "22301010012",
      eduEmail: "zhouxu@fudan.edu.cn",
      verifiedAt: new Date(),
      creditScore: 100,
    },
  });

  const xu = await prisma.user.create({
    data: {
      phone: "13900000003",
      role: "SUBJECT",
      name: "许一然",
      school: "上海交通大学",
      department: "电子信息",
      studentVerified: false,
      creditScore: 72,
    },
  });

  const shen = await prisma.user.create({
    data: {
      phone: "13900000004",
      role: "SUBJECT",
      name: "沈栗",
      school: "同济大学",
      department: "建筑学",
      studentVerified: true,
      studentId: "2152000331",
      eduEmail: "shenli@tongji.edu.cn",
      verifiedAt: new Date(),
      creditScore: 94,
      noShowCount: 3,
      bannedUntil: new Date(Date.now() + 18 * 60 * 60 * 1000),
    },
  });

  console.log("创建实验 1：面孔识别（10 个容量 1 的时段）…");
  const exp1 = await prisma.experiment.create({
    data: {
      researcherId: chen.id,
      title: "面孔吸引力判断实验",
      description:
        "本实验研究人们如何在 500 毫秒内对面孔吸引力做出判断。你需要在电脑前对 120 组面孔打分，全程约 40 分钟，中途可休息。数据仅用于学术研究，匿名处理。",
      location: "俊秀楼 305 认知实验室",
      durationMin: 40,
      rewardText: "¥30",
      type: "INDIVIDUAL",
      requirements: "矫正视力正常；近三个月未参加过同类面孔实验。",
      minCreditScore: 0,
      needsVerification: true,
      signupDeadline: shanghai(3, 23, 59),
      status: "PUBLISHED",
    },
  });

  // 三个下午，每天 4 个 40 分钟时段（14:00 / 14:50 / 15:40 / 16:30），容量 1
  const slotStarts: Date[] = [];
  for (const day of [1, 2, 3]) {
    for (const hour of [14, 15, 16]) {
      slotStarts.push(shanghai(day, hour, 0));
      slotStarts.push(shanghai(day, hour, 50));
    }
  }
  for (const startAt of slotStarts.slice(0, 10)) {
    await prisma.slot.create({
      data: {
        experimentId: exp1.id,
        startAt,
        endAt: new Date(startAt.getTime() + 40 * 60 * 1000),
        capacity: 1,
      },
    });
  }

  console.log("创建实验 2：团体决策（容量 3）…");
  const exp2 = await prisma.experiment.create({
    data: {
      researcherId: chen.id,
      title: "团体决策中的从众行为",
      description:
        "5-6 人一组完成一项投资决策任务，需要现场讨论。全程约 60 分钟，实验结束后现场发放报酬。",
      location: "俊秀楼 210 社会心理实验室",
      durationMin: 60,
      rewardText: "¥50",
      type: "GROUP",
      groupSize: 3,
      requirements: "无。欢迎不同专业同学参加。",
      minCreditScore: 80,
      needsVerification: true,
      signupDeadline: shanghai(4, 20, 0),
      status: "PUBLISHED",
    },
  });
  await prisma.slot.create({
    data: {
      experimentId: exp2.id,
      startAt: shanghai(4, 19, 0),
      endAt: shanghai(4, 20, 0),
      capacity: 3,
    },
  });

  console.log("创建实验 3：睡眠与情绪（长时段）…");
  const exp3 = await prisma.experiment.create({
    data: {
      researcherId: chen.id,
      title: "睡眠质量与情绪调节问卷",
      description:
        "填写一组标准化问卷并完成 15 分钟的电脑任务，用于研究睡眠质量对情绪调节策略的影响。",
      location: "线上（腾讯会议）",
      durationMin: 25,
      rewardText: "1 学分",
      type: "INDIVIDUAL",
      minCreditScore: 0,
      needsVerification: false,
      signupDeadline: shanghai(6, 23, 59),
      status: "PUBLISHED",
    },
  });
  for (const hour of [10, 11, 15, 16, 20]) {
    await prisma.slot.create({
      data: {
        experimentId: exp3.id,
        startAt: shanghai(2, hour, 0),
        endAt: shanghai(2, hour, 25),
        capacity: 2,
      },
    });
  }

  console.log("创建实验 4：低信誉主试的实验（列表降权）…");
  const exp4 = await prisma.experiment.create({
    data: {
      researcherId: xie.id,
      title: "青少年同伴关系访谈",
      description: "一对一访谈，围绕同伴关系与自我认同展开，约 30 分钟。",
      location: "教苑楼 407",
      durationMin: 30,
      rewardText: "¥20",
      type: "INDIVIDUAL",
      minCreditScore: 0,
      needsVerification: false,
      signupDeadline: shanghai(5, 23, 59),
      status: "PUBLISHED",
    },
  });
  await prisma.slot.create({
    data: {
      experimentId: exp4.id,
      startAt: shanghai(5, 14, 0),
      endAt: shanghai(5, 14, 30),
      capacity: 1,
    },
  });

  console.log("创建一条已完成的历史预约…");
  const doneSlot = await prisma.slot.create({
    data: {
      experimentId: exp1.id,
      startAt: shanghai(-5, 14, 0),
      endAt: shanghai(-5, 14, 40),
      capacity: 1,
      bookedCount: 1,
    },
  });
  await prisma.appointment.create({
    data: {
      experimentId: exp1.id,
      slotId: doneSlot.id,
      subjectId: lin.id,
      status: "COMPLETED",
      confirmedAt: shanghai(-6, 20, 0),
      checkedInAt: shanghai(-5, 14, 3),
    },
  });

  console.log("创建一条待处理申诉…");
  const pastSlot = await prisma.slot.create({
    data: {
      experimentId: exp3.id,
      startAt: shanghai(-1, 15, 0),
      endAt: shanghai(-1, 15, 25),
      capacity: 1,
      bookedCount: 1,
    },
  });
  await prisma.appointment.create({
    data: {
      experimentId: exp3.id,
      slotId: pastSlot.id,
      subjectId: lin.id,
      status: "CHECKED_IN",
      checkedInAt: shanghai(-1, 15, 5),
      appealStatus: "PENDING",
      appealAt: shanghai(-1, 15, 50),
      appealNote: "到场后等了 20 分钟没有见到主试，实验室门是锁的。",
    },
  });

  console.log("写入信誉分明细…");
  const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);
  await prisma.creditEvent.createMany({
    data: [
      { userId: lin.id, delta: 1, reason: "ATTENDED", note: "面孔吸引力判断实验 按时到场", createdAt: daysAgo(5) },
      { userId: lin.id, delta: 1, reason: "ATTENDED", note: "情绪词汇判断 按时到场", createdAt: daysAgo(18) },
      { userId: shen.id, delta: -2, reason: "NO_SHOW", note: "记忆编码实验 未到场", createdAt: daysAgo(3) },
      { userId: shen.id, delta: -2, reason: "NO_SHOW", note: "决策实验 未到场", createdAt: daysAgo(9) },
      { userId: shen.id, delta: -2, reason: "NO_SHOW", note: "阅读眼动实验 未到场", createdAt: daysAgo(16) },
      { userId: xu.id, delta: -2, reason: "NO_SHOW", note: "注意瞬脱实验 未到场", createdAt: daysAgo(12) },
      { userId: xie.id, delta: -2, reason: "RESEARCHER_CANCEL", note: "临时取消，距开始不足 24 小时", createdAt: daysAgo(7) },
    ],
  });

  console.log("\n完成。演示账号（验证码统一 123456）：");
  console.log("  主试 陈砚   13800000001   信誉 100");
  console.log("  主试 谢秋池 13800000002   信誉 55（列表降权样例）");
  console.log("  被试 林知夏 13900000001   信誉 100（有 1 条待处理申诉）");
  console.log("  被试 周叙   13900000002   信誉 100");
  console.log("  被试 许一然 13900000003   信誉 72（报不了要求 80 的实验）");
  console.log("  被试 沈栗   13900000004   信誉 94 · 禁报名中（累计 3 次未到场）");
  console.log(`\n可报名实验：${[exp1.title, exp2.title, exp3.title, exp4.title].join(" / ")}`);
  console.log(`被试 许一然 id=${xu.id}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
