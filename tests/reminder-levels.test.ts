import { describe, it, expect } from "vitest";
import {
  buildReminderPrompt,
  pickReminderLevel,
  reminderFallbackText,
  reminderLevelSpec,
  REMINDER_LEVELS,
  ReminderIntent,
  ReminderLevel,
} from "@/domain/reminder-levels";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const now = new Date("2026-11-10T09:00:00+08:00");
const at = (msFromNow: number) => new Date(now.getTime() + msFromNow);

describe("pickReminderLevel", () => {
  it("距开场 4 小时 → 还没进任何档", () => {
    expect(pickReminderLevel(at(4 * HOUR), now)).toBeNull();
  });

  it("距开场正好 3 小时 → H3", () => {
    expect(pickReminderLevel(at(3 * HOUR), now)).toBe(ReminderLevel.H3);
  });

  it("距开场 2 小时 → 仍在 H3（H1 没到）", () => {
    expect(pickReminderLevel(at(2 * HOUR), now)).toBe(ReminderLevel.H3);
  });

  it("距开场 1 小时 → H1", () => {
    expect(pickReminderLevel(at(HOUR), now)).toBe(ReminderLevel.H1);
  });

  it("距开场 30 分钟 → H1", () => {
    expect(pickReminderLevel(at(30 * MINUTE), now)).toBe(ReminderLevel.H1);
  });

  it("距开场 10 分钟 → M10", () => {
    expect(pickReminderLevel(at(10 * MINUTE), now)).toBe(ReminderLevel.M10);
  });

  it("距开场 3 分钟 → 仍是 M10（不越档，最紧急的就是它）", () => {
    expect(pickReminderLevel(at(3 * MINUTE), now)).toBe(ReminderLevel.M10);
  });

  it("已经开场 → null（开场后提醒无意义）", () => {
    expect(pickReminderLevel(at(-1 * MINUTE), now)).toBeNull();
    expect(pickReminderLevel(now, now)).toBeNull();
  });

  it("服务停了 50 分钟才恢复：三档窗口都已进入，只给最紧急的 M10", () => {
    // 这条是这次设计的核心动机：不能连发三条几乎一样的话
    const startAt = at(5 * MINUTE);
    expect(pickReminderLevel(startAt, now)).toBe(ReminderLevel.M10);
  });

  it("档位定义由宽到窄排列（顺序被 pickReminderLevel 依赖）", () => {
    const ahead = REMINDER_LEVELS.map((s) => s.aheadMs);
    expect(ahead).toEqual([...ahead].sort((a, b) => b - a));
  });
});

describe("reminderLevelSpec", () => {
  it("三档都能取到定义", () => {
    for (const spec of REMINDER_LEVELS) {
      expect(reminderLevelSpec(spec.level).level).toBe(spec.level);
    }
  });

  it("非法档位抛错，不静默返回 undefined", () => {
    expect(() => reminderLevelSpec("H9" as ReminderLevel)).toThrow(/未知的提醒档位/);
  });

  it("只有 10 分钟档是签到意图", () => {
    expect(reminderLevelSpec(ReminderLevel.M10).intent).toBe(ReminderIntent.CHECKIN_OPEN);
    expect(reminderLevelSpec(ReminderLevel.H3).intent).toBe(ReminderIntent.UPCOMING);
    expect(reminderLevelSpec(ReminderLevel.H1).intent).toBe(ReminderIntent.UPCOMING);
  });
});

const facts = {
  experimentTitle: "面孔识别实验",
  location: "心理学楼 302",
  startLabel: "周三 14:00",
  remainingMin: 180,
};

describe("reminderFallbackText", () => {
  it("UPCOMING 档包含实验名、时间、地点和剩余时长", () => {
    const text = reminderFallbackText({ ...facts, level: ReminderLevel.H3 });
    expect(text).toContain("面孔识别实验");
    expect(text).toContain("周三 14:00");
    expect(text).toContain("心理学楼 302");
    expect(text).toContain("3 小时");
  });

  it("M10 档说的是签到，不是「快开始了」", () => {
    const text = reminderFallbackText({ ...facts, level: ReminderLevel.M10, remainingMin: 10 });
    // 签到入口在 startAt-30min 就开放了，此时该说来签到
    expect(text).toContain("签到");
    expect(text).not.toContain("还有 10 分钟");
  });

  it("兜底文案永远非空且不含占位符", () => {
    for (const spec of REMINDER_LEVELS) {
      const text = reminderFallbackText({ ...facts, level: spec.level });
      expect(text.length).toBeGreaterThan(10);
      expect(text).not.toContain("${");
      expect(text).not.toContain("undefined");
    }
  });
});

describe("buildReminderPrompt", () => {
  it("把事实都塞进提示词", () => {
    const prompt = buildReminderPrompt({ ...facts, level: ReminderLevel.H1, remainingMin: 60 });
    expect(prompt).toContain("面孔识别实验");
    expect(prompt).toContain("心理学楼 302");
    expect(prompt).toContain("周三 14:00");
    expect(prompt).toContain("60");
  });

  it("签到档和普通档的目标不同", () => {
    const checkin = buildReminderPrompt({ ...facts, level: ReminderLevel.M10 });
    const upcoming = buildReminderPrompt({ ...facts, level: ReminderLevel.H3 });
    expect(checkin).toContain("签到");
    expect(upcoming).not.toContain("签到入口");
  });

  it("约束了输出长度与格式（提醒不是创作）", () => {
    const prompt = buildReminderPrompt({ ...facts, level: ReminderLevel.H3 });
    expect(prompt).toContain("只输出提醒正文");
    expect(prompt).toContain("一到两句话");
  });
});
