import { describe, expect, it } from "vitest";
import {
  assertExperimentDraft,
  banDaysLeft,
  banUntilText,
  capacityForSlot,
  isGroupFormed,
  slotCapacityText,
  type ExperimentDraftInput,
} from "@/domain/experiment-rules";
import { ExperimentType } from "@/domain/constants";

const NOW = new Date("2026-03-01T10:00:00+08:00");
const day = (n: number) => new Date(NOW.getTime() + n * 24 * 3600 * 1000);

function draft(over: Partial<ExperimentDraftInput> = {}): ExperimentDraftInput {
  return {
    title: "团体决策中的从众行为",
    type: ExperimentType.GROUP,
    groupSize: 3,
    signupDeadline: day(1),
    slots: [
      { startAt: day(2), endAt: new Date(day(2).getTime() + 60 * 60 * 1000), capacity: 1 },
    ],
    now: NOW,
    ...over,
  };
}

describe("capacityForSlot —— 团体容量由 groupSize 派生", () => {
  it("团体实验忽略主试填的容量，强制等于 groupSize", () => {
    expect(capacityForSlot(ExperimentType.GROUP, 3, 1)).toBe(3);
    expect(capacityForSlot(ExperimentType.GROUP, 5, 2)).toBe(5);
  });

  it("团体实验没填 groupSize 时兜底 2（schema 已拦，这里是第二道）", () => {
    expect(capacityForSlot(ExperimentType.GROUP, null, 7)).toBe(2);
  });

  it("一对一实验用主试填的容量", () => {
    expect(capacityForSlot(ExperimentType.INDIVIDUAL, null, 1)).toBe(1);
    expect(capacityForSlot(ExperimentType.INDIVIDUAL, 3, 4)).toBe(4);
  });
});

describe("assertExperimentDraft —— 共用校验", () => {
  it("合法草稿返回 null", () => {
    expect(assertExperimentDraft(draft())).toBeNull();
  });

  it("截止时间格式非法", () => {
    const r = assertExperimentDraft(draft({ signupDeadline: new Date("nope") }));
    expect(r?.message).toContain("格式不正确");
  });

  it("截止时间已过去 → 拒绝", () => {
    const r = assertExperimentDraft(draft({ signupDeadline: day(-1) }));
    expect(r?.status).toBe(400);
    expect(r?.message).toContain("晚于现在");
  });

  it("没有时段 → 拒绝", () => {
    expect(assertExperimentDraft(draft({ slots: [] }))?.message).toContain("至少需要一个时段");
  });

  it("时段结束早于开始 → 拒绝", () => {
    const r = assertExperimentDraft(
      draft({ slots: [{ startAt: day(2), endAt: day(2), capacity: 3 }] }),
    );
    expect(r?.message).toContain("结束时间必须晚于开始时间");
  });

  it("截止时间晚于最早时段 → 拒绝", () => {
    const r = assertExperimentDraft(draft({ signupDeadline: day(3) }));
    expect(r?.message).toContain("早于最早时段");
  });

  it("时段重叠 → 拒绝（乱序输入也要判出来）", () => {
    const r = assertExperimentDraft(
      draft({
        slots: [
          // 乱序：晚的那个写在前面，且与早的有 1 小时重叠
          { startAt: new Date(day(2).getTime() + 3600_000), endAt: new Date(day(2).getTime() + 7200_000), capacity: 3 },
          { startAt: day(2), endAt: new Date(day(2).getTime() + 7200_000), capacity: 3 },
        ],
      }),
    );
    expect(r?.message).toContain("重叠");
  });

  it("时段首尾相接不算重叠", () => {
    const a = { startAt: day(2), endAt: new Date(day(2).getTime() + 3600_000), capacity: 3 };
    const b = { startAt: a.endAt, endAt: new Date(a.endAt.getTime() + 3600_000), capacity: 3 };
    expect(assertExperimentDraft(draft({ slots: [a, b] }))).toBeNull();
  });
});

describe("assertExperimentDraft —— 团体专属", () => {
  it("团体实验没填人数 → 拒绝", () => {
    expect(assertExperimentDraft(draft({ groupSize: null }))?.message).toContain("团体人数");
  });

  it("团体人数 < 2 → 拒绝", () => {
    expect(assertExperimentDraft(draft({ groupSize: 1 }))?.message).toContain("团体人数");
  });

  it("团体人数超过上限 → 拒绝", () => {
    expect(assertExperimentDraft(draft({ groupSize: 31 }))?.message).toContain("最多 30 人");
  });

  it("一对一实验不校验 groupSize", () => {
    expect(
      assertExperimentDraft(draft({ type: ExperimentType.INDIVIDUAL, groupSize: null })),
    ).toBeNull();
  });
});

describe("slotCapacityText —— 同一数字两种语义", () => {
  it("团体：0 人是待成团，不是已约满", () => {
    const t = slotCapacityText({ type: ExperimentType.GROUP, capacity: 3, bookedCount: 0 });
    expect(t).toBe("待成团 0/3 人");
  });

  it("团体：有 1 人是「已成团 1/3」，不能说成「剩 2 个名额」", () => {
    const t = slotCapacityText({ type: ExperimentType.GROUP, capacity: 3, bookedCount: 1 });
    expect(t).toBe("已成团 1/3 人");
  });

  it("一对一：说名额", () => {
    expect(slotCapacityText({ type: ExperimentType.INDIVIDUAL, capacity: 2, bookedCount: 1 })).toBe(
      "剩 1 个名额",
    );
    expect(slotCapacityText({ type: ExperimentType.INDIVIDUAL, capacity: 2, bookedCount: 2 })).toBe(
      "已约满",
    );
  });

  it("团体凑满时仍然报成团数，不写「已约满」", () => {
    expect(slotCapacityText({ type: ExperimentType.GROUP, capacity: 3, bookedCount: 3 })).toBe(
      "已成团 3/3 人",
    );
  });
});

describe("isGroupFormed", () => {
  it("团体凑满才 true", () => {
    expect(isGroupFormed(ExperimentType.GROUP, 3, 3)).toBe(true);
    expect(isGroupFormed(ExperimentType.GROUP, 3, 2)).toBe(false);
  });

  it("一对一永远 false（不适用成团概念）", () => {
    expect(isGroupFormed(ExperimentType.INDIVIDUAL, 1, 1)).toBe(false);
  });
});

describe("禁期文案", () => {
  it("banUntilText 只输出日期", () => {
    expect(banUntilText(new Date("2026-03-05T12:00:00+08:00"))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(banUntilText(null)).toBe("");
  });

  it("banDaysLeft 向上取整，过期归零", () => {
    expect(banDaysLeft(day(2), NOW)).toBe(2);
    expect(banDaysLeft(new Date(NOW.getTime() + 3600_000), NOW)).toBe(1);
    expect(banDaysLeft(day(-1), NOW)).toBe(0);
    expect(banDaysLeft(null, NOW)).toBe(0);
  });
});
