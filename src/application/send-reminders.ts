/**
 * 生成到时提醒 —— 应用层。
 *
 * 分工是刻意的，也是这次设计的核心：
 *   - **代码决定「何时、给谁、哪一档」**：pickReminderLevel 是纯时间判断
 *   - **模型只决定「怎么说」**：一句话，写进一个字段
 *   - **模型挂了用模板兜底**：提醒是产品动作，不能因为 LLM 抖动就静默丢失
 *
 * 所以这个用例没有「长时间占用」这回事：每条提醒一次同步调用，输出一句话。
 * 没有常驻进程，没有延迟任务队列，没有后台 Agent。
 */

import type { LlmPort } from "@/domain/ports/llm";
import type {
  NotificationRepository,
  ReminderCandidate,
} from "@/domain/ports/notification-repo";
import {
  buildReminderPrompt,
  pickReminderLevel,
  reminderFallbackText,
  ReminderLevel,
  REMINDER_LEVELS,
} from "@/domain/reminder-levels";
import { formatDayCN, formatHM } from "@/lib/time";

/** 最宽的一档；扫描窗口在它上面再加余量，避免刚好跨过边界时漏掉 */
const WIDEST_LEVEL_MS = Math.max(...REMINDER_LEVELS.map((s) => s.aheadMs));

export type ReminderDeps = {
  notifications: NotificationRepository;
  llm: LlmPort;
};

export type ReminderJobResult = {
  job: "send-reminders";
  /** 本次新写入的提醒条数 */
  affected: number;
  /** 命中窗口但已经发过（唯一键挡住）的条数 —— 用于断言幂等真的生效 */
  skipped: number;
  /** 模型失败退化成模板的条数 */
  fallback: number;
};

/**
 * 扫一遍该发的提醒并落库。
 *
 * 幂等由 `(appointmentId, level)` 唯一约束保证：
 * 重复调用时 createReminder 返回 created=false，计入 skipped，不重发。
 *
 * 服务停了很久才恢复也不会漏：pickReminderLevel 只取「已进入且最紧急」的一档，
 * 所以恢复时最多补发一条（当下最该看的那条），不会补发三条历史存档。
 */
export async function sendDueReminders(
  deps: ReminderDeps,
  now: Date = new Date(),
): Promise<ReminderJobResult> {
  const candidates = await deps.notifications.findReminderCandidates(
    now,
    WIDEST_LEVEL_MS,
  );

  let affected = 0;
  let skipped = 0;
  let fallback = 0;

  for (const candidate of candidates) {
    const level = pickReminderLevel(candidate.startAt, now);
    if (!level) continue;

    // 先查再生成：已经发过的这一档不该再花一次模型调用。
    // 唯一约束仍是最终防线（两次检查之间可能并发插入），这里只是省掉无用功。
    if (await deps.notifications.hasReminder(candidate.appointmentId, level)) {
      skipped += 1;
      continue;
    }

    const { content, usedFallback } = await composeReminder(deps.llm, candidate, level, now);
    if (usedFallback) fallback += 1;

    const result = await deps.notifications.createReminder({
      userId: candidate.subjectId,
      appointmentId: candidate.appointmentId,
      experimentId: candidate.experimentId,
      level,
      content,
      createdAt: now,
    });

    if (result.created) affected += 1;
    else skipped += 1;
  }

  return { job: "send-reminders", affected, skipped, fallback };
}

/**
 * 让模型写那一句话；任何失败都退回模板。
 *
 * 判失败的三种情况都要处理：
 *   1. LLM 没配置（无 key）→ 直接模板，不发请求
 *   2. 调用抛错 / 超时 → 模板
 *   3. 返回空串 / 只有空白 → 模板（模型偶尔会这么干）
 */
export async function composeReminder(
  llm: LlmPort,
  candidate: ReminderCandidate,
  level: ReminderLevel,
  now: Date,
): Promise<{ content: string; usedFallback: boolean }> {
  const facts = {
    experimentTitle: candidate.experimentTitle,
    location: candidate.location,
    startLabel: `${formatDayCN(candidate.startAt)} ${formatHM(candidate.startAt)}`,
    level,
    remainingMin: Math.max(0, Math.round((candidate.startAt.getTime() - now.getTime()) / 60000)),
    researcherName: candidate.researcherName || undefined,
  };

  const fallbackText = () => ({ content: reminderFallbackText(facts), usedFallback: true });

  if (!llm.configured()) return fallbackText();

  try {
    const reply = await llm.chat({
      messages: [
        { role: "system", content: "你是一个简洁的提醒文案助手。" },
        { role: "user", content: buildReminderPrompt(facts) },
      ],
      tools: [],
      temperature: 0.3,
    });

    const text = reply.content.trim();
    if (!text) return fallbackText();
    return { content: text, usedFallback: false };
  } catch {
    // 提醒不能因为模型抖动就丢失 —— 这条是产品底线，不是容错细节
    return fallbackText();
  }
}
