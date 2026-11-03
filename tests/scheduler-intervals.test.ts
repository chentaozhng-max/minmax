import { describe, expect, it } from "vitest";
import { SCHEDULER_INTERVALS } from "@/server/scheduler";
import { REMINDER_LEVELS, pickReminderLevel, ReminderLevel } from "@/domain/reminder-levels";

/**
 * 扫描粒度不变量。
 *
 * 这条测试守的是一个**曾经真实存在的设计疏忽**：扫描间隔（10 分钟）
 * 和最窄的提醒窗口（M10，10 分钟）刚好相等 —— 数学上没有重叠，但零余量。
 * setInterval 累积漂移、一次部署重启、事件循环被前一个 job 卡住，
 * 任意一件发生就从「理论不漏」变成「真漏」。
 *
 * 所以断言的不是具体数字，是**比例**：间隔必须显著小于最窄窗口。
 * 这样以后有人加一档「提前 30 秒」的提醒，这个测试会立刻提醒他把间隔也调小。
 */

/** 固定种子的伪随机（线性同余）：测试必须可复现，不能用 Math.random */
function seededRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

/**
 * 模拟「定时器带抖动地跑」，统计 M10 这一档被漏掉的概率。
 *
 * 为什么要模拟：窗口宽度 = 间隔时，数学上刚好每次都命中；
 * 一旦每次 tick 有 ±30 秒抖动，那个「刚好」就会失效。
 * 这个函数就是把这个失效过程跑出来，好让「1 分钟」这个选择有证据，
 * 而不是凭感觉。
 */
function missedRate(intervalMs: number, jitterMs: number, trials: number): number {
  const rand = seededRandom(20261102);
  const windowMs = Math.min(...REMINDER_LEVELS.map((s) => s.aheadMs));
  let missed = 0;

  for (let t = 0; t < trials; t += 1) {
    const startAt = 0;
    let hit = false;
    // 从窗口前 4 倍处开始扫，一直到开场
    for (let time = -windowMs * 4; time <= startAt; time += intervalMs) {
      // 每个 tick 有 ±jitter 的抖动（模拟 setInterval 漂移 + 事件循环延迟）
      const actual = time + (rand() * 2 - 1) * jitterMs;
      const level = pickReminderLevel(new Date(startAt), new Date(actual));
      if (level === ReminderLevel.M10) {
        hit = true;
        break;
      }
    }
    if (!hit) missed += 1;
  }
  return missed / trials;
}

describe("scheduler 扫描粒度", () => {
  const narrowestWindow = Math.min(...REMINDER_LEVELS.map((s) => s.aheadMs));

  it("提醒扫描间隔至少比最窄的提醒窗口小 5 倍", () => {
    expect(narrowestWindow / SCHEDULER_INTERVALS.reminders).toBeGreaterThanOrEqual(5);
  });

  it("提醒间隔比重型 job 间隔更密（提醒是唯一有秒级时效要求的）", () => {
    expect(SCHEDULER_INTERVALS.reminders).toBeLessThan(SCHEDULER_INTERVALS.heavy);
  });

  it("兜底全量扫描不快于重型 job（它只是保险，不该多跑）", () => {
    expect(SCHEDULER_INTERVALS.sweep).toBeGreaterThanOrEqual(SCHEDULER_INTERVALS.heavy);
  });

  it("★ 10 分钟扫描 + ±30 秒抖动 → M10 有相当概率整档漏掉", () => {
    const rate = missedRate(10 * 60 * 1000, 30_000, 400);
    // 不是「偶尔漏」，是「将近一半漏」——因为窗口和间隔等宽，
    // 抖到窗口前面一点就再也没有下一次机会了
    expect(rate).toBeGreaterThan(0.1);
  });

  it("★ 1 分钟扫描 + ±30 秒抖动 → 400 次模拟里一次都没漏", () => {
    expect(missedRate(SCHEDULER_INTERVALS.reminders, 30_000, 400)).toBe(0);
  });

  it("窗口内任意时刻扫描都能命中 M10（1 分钟粒度覆盖整段窗口）", () => {
    const startAt = new Date(0);
    for (let offsetMin = 9; offsetMin >= 1; offsetMin -= 1) {
      const now = new Date(-offsetMin * 60 * 1000);
      expect(pickReminderLevel(startAt, now)).toBe(ReminderLevel.M10);
    }
  });
});
