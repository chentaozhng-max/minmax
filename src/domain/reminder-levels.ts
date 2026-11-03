/**
 * 到时提醒的档位与文案规则 —— 领域层。
 *
 * 这里只回答两个问题：
 *   1. 现在这一刻，该发哪一档？（纯时间判断，不碰数据库）
 *   2. 这一档该说什么？（给模型的提示词 / 模型不可用时的兜底文案）
 *
 * 不做的事：不查库、不做幂等、不认识 Notification 表。
 * 「发过了没有」是持久化问题，由应用层 + 唯一键解决。
 *
 * 为什么不拆三档各写一条判断：三档是同一个规则的不同参数，
 * 拆开写必然出现「3 小时用 >=，10 分钟用 ==」这种不一致。
 */

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

export const ReminderLevel = {
  /** 提前 3 小时 */
  H3: "H3",
  /** 提前 1 小时 */
  H1: "H1",
  /** 提前 10 分钟 —— 此时已可签到（签到在 startAt-30min 开放） */
  M10: "M10",
} as const;
export type ReminderLevel = (typeof ReminderLevel)[keyof typeof ReminderLevel];

/** 这一档的意图，决定文案基调 */
export const ReminderIntent = {
  /** 还有一会儿，提醒别忘 */
  UPCOMING: "UPCOMING",
  /** 可以签到了 —— 和 UPCOMING 是完全不同的动作提示 */
  CHECKIN_OPEN: "CHECKIN_OPEN",
} as const;
export type ReminderIntent = (typeof ReminderIntent)[keyof typeof ReminderIntent];

export type ReminderLevelSpec = {
  level: ReminderLevel;
  /** 距离开场多少毫秒进入本档 */
  aheadMs: number;
  /** 文案里怎么说这个提前量 */
  label: string;
  intent: ReminderIntent;
};

/**
 * 三档定义，**由宽到窄**排列。
 *
 * 顺序是有意义的：`pickReminderLevel` 依赖「越靠后越紧急」，
 * 增加档位时插到正确位置即可，判断逻辑不用改。
 */
export const REMINDER_LEVELS: readonly ReminderLevelSpec[] = [
  { level: ReminderLevel.H3, aheadMs: 3 * HOUR, label: "3 小时", intent: ReminderIntent.UPCOMING },
  { level: ReminderLevel.H1, aheadMs: 1 * HOUR, label: "1 小时", intent: ReminderIntent.UPCOMING },
  { level: ReminderLevel.M10, aheadMs: 10 * MINUTE, label: "10 分钟", intent: ReminderIntent.CHECKIN_OPEN },
];

/**
 * 现在这一刻该发哪一档提醒？
 *
 * 规则：**只取已经进入、且最紧急的那一档**。
 *
 * 这条规则解决一个真实故障：服务停了 50 分钟，恢复时距离开场只剩 5 分钟，
 * 三档窗口都「已经进入」。如果每档都发，用户会连收三条几乎一样的话。
 * 只取最紧急的一档，用户收到的正好是当下最该看的那条。
 *
 * @returns 该发的档位；未进入任何窗口、或实验已经开始，返回 null
 */
export function pickReminderLevel(startAt: Date, now: Date): ReminderLevel | null {
  const remaining = startAt.getTime() - now.getTime();

  // 已经开场：提醒没有意义（这时该催签到，但那是另一件事，见 canCheckIn）
  if (remaining <= 0) return null;

  let picked: ReminderLevel | null = null;
  for (const spec of REMINDER_LEVELS) {
    if (remaining <= spec.aheadMs) picked = spec.level;
  }
  return picked;
}

/** 取档位定义，找不到抛错（调用方传了非法档位属于编程错误，不该静默） */
export function reminderLevelSpec(level: ReminderLevel): ReminderLevelSpec {
  const spec = REMINDER_LEVELS.find((s) => s.level === level);
  if (!spec) throw new Error(`未知的提醒档位：${level}`);
  return spec;
}

/** 生成提醒文案所需的全部事实。时间已格式化成字符串，领域层不碰时区。 */
export type ReminderFacts = {
  experimentTitle: string;
  location: string;
  /** 已格式化好的开场时间，如「周三 14:00」 */
  startLabel: string;
  level: ReminderLevel;
  /** 距开场还有多少分钟（用于文案里的具体数字） */
  remainingMin: number;
  researcherName?: string;
};

/**
 * 兜底文案 —— 模型不可用 / 超时 / 输出为空时使用。
 *
 * 必须存在且必须能读通：提醒是产品动作，不能因为 LLM 抖动就静默丢失。
 * 这条兜底也是单测里断言「降级路径不丢通知」的依据。
 */
export function reminderFallbackText(facts: ReminderFacts): string {
  const spec = reminderLevelSpec(facts.level);
  if (spec.intent === ReminderIntent.CHECKIN_OPEN) {
    return `「${facts.experimentTitle}」${facts.startLabel} 在${facts.location}开始，现在可以签到了。到了点开「我的预约」签到就行。`;
  }
  return `提醒一下，「${facts.experimentTitle}」${facts.startLabel} 在${facts.location}开始，还有 ${spec.label}。别迟到，迟到或缺席会影响信誉分。`;
}

/**
 * 给模型的提示词。输出要求写死在提示词里（一句话、口语、不超过两行），
 * 因为提醒的产出是「一句话」而不是「一段创作」——控制不住长度就会变成小作文。
 */
export function buildReminderPrompt(facts: ReminderFacts): string {
  const spec = reminderLevelSpec(facts.level);
  const goal =
    spec.intent === ReminderIntent.CHECKIN_OPEN
      ? "提醒被试现在可以签到了（签到入口在「我的预约」页）"
      : "提醒被试别忘了这场实验，并提示迟到/缺席会影响信誉分";

  return `你是「PsyMatch」的实验提醒助手。请给被试写一条站内提醒。

## 这场实验
名称：${facts.experimentTitle}
地点：${facts.location}
开场时间：${facts.startLabel}
${facts.researcherName ? `主试：${facts.researcherName}` : ""}
距开场还有：${facts.remainingMin} 分钟（${spec.label}这一档）

## 你要做的
${goal}

## 硬性要求
1. 只输出提醒正文，不要任何前缀、不要"好的"、不要引号。
2. 一到两句话，口语，像发微信消息。
3. 必须包含开场时间和地点。
4. 不要编造上文没有的信息（不要提奖励金额、不要提按钮位置以外的界面细节）。
5. 不要使用感叹号连发、不要写"亲"。`;
}
