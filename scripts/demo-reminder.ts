/**
 * Demo 用：**10 秒内造出一条「刚到点」的提醒**，不用在台上干等。
 *
 * 做什么：
 *   1. 找一门已发布的实验（没有就报错，让你先 seed）
 *   2. 造一个「现在 + 20 分钟」开场的时段
 *   3. 给一个 demo 被试建一条已确认的预约
 *   4. 立刻跑一次 sendDueReminders
 *   5. 打印写进 Notification 的那句话
 *
 * 之后打开浏览器（用同一个被试登录），30 秒内底部会弹 toast、「我的」出现红点。
 *
 * 运行：npm run demo:reminder
 * 清理由下次 `npm run db:reset` 或手动删 phone 前缀 1990000999 的用户完成。
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { sendDueReminders } from "../src/application/send-reminders";
import { makeDefaultNotificationRepository } from "../src/adapters/db/prisma/notification-repo";
import { getLlm } from "../src/adapters/llm";

const TAG = "1990000999";
/** 开场时间设在多久之后：落在 M10 这一档（10 分钟窗口）里才有提醒 */
const AHEAD_MIN = 8;

async function main() {
  const experiment = await prisma.experiment.findFirst({
    where: { status: "PUBLISHED" },
    orderBy: { createdAt: "desc" },
  });
  if (!experiment) {
    console.error("没有已发布的实验，先跑 npm run db:seed");
    process.exitCode = 1;
    return;
  }

  const subject = await prisma.user.upsert({
    where: { phone: `${TAG}01` },
    update: {},
    create: {
      phone: `${TAG}01`,
      role: "SUBJECT",
      name: "演示被试",
      studentVerified: true,
      creditScore: 100,
    },
  });

  const now = new Date();
  const startAt = new Date(now.getTime() + AHEAD_MIN * 60 * 1000);

  const slot = await prisma.slot.create({
    data: {
      experimentId: experiment.id,
      startAt,
      endAt: new Date(startAt.getTime() + experiment.durationMin * 60 * 1000),
      capacity: 1,
      bookedCount: 1,
    },
  });

  const appointment = await prisma.appointment.create({
    data: {
      experimentId: experiment.id,
      slotId: slot.id,
      subjectId: subject.id,
      status: "CONFIRMED",
    },
  });

  console.log(`实验：${experiment.title}（${experiment.location}）`);
  console.log(`开场：${startAt.toLocaleString("zh-CN", { hour12: false })}（还有 ${AHEAD_MIN} 分钟）`);
  console.log(`被试：${subject.name} / 手机号 ${subject.phone}`);

  const llm = getLlm();
  console.log(`LLM：${llm.configured() ? "已配置（真模型写文案）" : "未配置（用模板兜底）"}`);

  const result = await sendDueReminders(
    { notifications: makeDefaultNotificationRepository(), llm },
    now,
  );
  console.log(
    `扫描结果：新增 ${result.affected} 条 / 跳过 ${result.skipped} 条 / 兜底 ${result.fallback} 条`,
  );

  const saved = await prisma.notification.findFirst({
    where: { appointmentId: appointment.id },
    orderBy: { createdAt: "desc" },
  });
  if (!saved) {
    console.error("⚠️ 没生成提醒 —— 检查开场时间是否落在某一档窗口里");
    process.exitCode = 1;
    return;
  }

  console.log(`\n档位：${saved.level}`);
  console.log(`文案：${saved.content}`);
  console.log(
    "\n下一步：浏览器用「演示被试」登录，任意页面上等 30 秒 → 弹 toast +「我的」tab 出红点。",
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
