import { describe, expect, it } from "vitest";
import {
  addDraftDays,
  composeDraftFromBrief,
  draftStartOfWeek,
  draftToday,
  draftWeekday,
  hasBlockingDraftIssues,
  isPlaceholderLocation,
  normalizeExperimentDraft,
  planSlots,
  prunePastSlots,
  reviewExperimentDraft,
  suggestSignupDeadline,
  type ExperimentDraft,
} from "@/domain/experiment-draft";
import { ExperimentType } from "@/domain/constants";
import { publisherBanRejection } from "@/domain/experiment-rules";

/** 2026-11-03 是周二；明天 = 11-04 周三 */
const NOW = new Date("2026-11-03T10:00:00+08:00");
const ANCHOR = "2026-11-04";

const at = (date: string, time: string) => new Date(`${date}T${time}:00+08:00`).toISOString();

function baseDraft(over: Partial<ExperimentDraft> = {}): ExperimentDraft {
  return {
    title: "面孔吸引力判断实验",
    description: "在实验室完成一段电脑任务，全程约 30 分钟，报酬当场结算。",
    location: "俊秀楼 305",
    durationMin: 30,
    rewardYuan: 30,
    type: ExperimentType.INDIVIDUAL,
    groupSize: null,
    requirements: "矫正视力正常",
    minCreditScore: 0,
    needsVerification: true,
    slots: [{ startAt: at("2026-11-04", "14:00"), endAt: at("2026-11-04", "14:30"), capacity: 1 }],
    slotPlan: null,
    ...over,
  };
}

describe("日期工具（上海日历日）", () => {
  it("today / 加减天数不跨错月", () => {
    expect(draftToday(NOW)).toBe("2026-11-03");
    expect(addDraftDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDraftDays("2024-02-28", 1)).toBe("2024-02-29");
  });

  it("星期与周一", () => {
    expect(draftWeekday("2026-11-04")).toBe(3);
    expect(draftWeekday("2026-11-08")).toBe(7);
    expect(draftStartOfWeek("2026-11-04")).toBe("2026-11-02");
    expect(draftStartOfWeek("2026-11-08")).toBe("2026-11-02");
  });
});

describe("planSlots —— 模型只给星期，日期由系统算", () => {
  it("明天起、每周三下午，按半小时铺满", () => {
    const slots = planSlots(
      { weekdays: [3], startTime: "14:00", endTime: "17:00", weeks: 1, anchor: "TOMORROW" },
      { anchorDate: ANCHOR, durationMin: 30, capacity: 1 },
    );

    expect(slots).toHaveLength(6);
    expect(slots[0].startAt).toBe(at("2026-11-04", "14:00"));
    expect(slots[0].endAt).toBe(at("2026-11-04", "14:30"));
    expect(slots[5].startAt).toBe(at("2026-11-04", "16:30"));
  });

  it("anchor=NEXT_WEEK 从下周一开始，不是从明天开始", () => {
    const slots = planSlots(
      { weekdays: [3], startTime: "14:00", endTime: "15:00", weeks: 1, anchor: "NEXT_WEEK" },
      { anchorDate: ANCHOR, durationMin: 30, capacity: 3 },
    );

    expect(slots).toHaveLength(2);
    expect(new Date(slots[0].startAt).getTime()).toBe(new Date(at("2026-11-11", "14:00")).getTime());
    expect(slots[0].capacity).toBe(3);
  });

  it("时长不是 30 的整数倍时，步长向上取整到半小时", () => {
    const slots = planSlots(
      { weekdays: [3], startTime: "14:00", endTime: "17:00", weeks: 1, anchor: "TOMORROW" },
      { anchorDate: ANCHOR, durationMin: 40, capacity: 1 },
    );

    // 14:00、15:00、16:00 —— 每段 40 分钟，间隔 60 分钟，不会重叠
    expect(slots).toHaveLength(3);
    expect(slots.map((s) => new Date(s.startAt).getUTCHours())).toEqual([6, 7, 8]);
  });

  it("上限与非法输入", () => {
    const capped = planSlots(
      { weekdays: [1, 2, 3, 4, 5, 6, 7], startTime: "09:00", endTime: "18:00", weeks: 4, anchor: "TOMORROW" },
      { anchorDate: ANCHOR, durationMin: 30, capacity: 1, maxSlots: 20 },
    );
    expect(capped).toHaveLength(20);

    expect(
      planSlots(
        { weekdays: [], startTime: "14:00", endTime: "17:00", weeks: 1, anchor: "TOMORROW" },
        { anchorDate: ANCHOR, durationMin: 30, capacity: 1 },
      ),
    ).toEqual([]);

    expect(
      planSlots(
        { weekdays: [3], startTime: "17:00", endTime: "14:00", weeks: 1, anchor: "TOMORROW" },
        { anchorDate: ANCHOR, durationMin: 30, capacity: 1 },
      ),
    ).toEqual([]);
  });
});

describe("normalizeExperimentDraft —— 模型乱写也不能把页面带崩", () => {
  it("数值越界被夹回合法区间", () => {
    const { draft } = normalizeExperimentDraft(
      {
        title: "  一个标题  ",
        description: "够长的说明文字，用来通过最小长度检查。",
        location: "俊秀楼 305",
        durationMin: 9999,
        rewardYuan: 0,
        type: "GROUP",
        groupSize: 99,
        slotPlan: { weekdays: [3], startTime: "14:00", endTime: "15:00", weeks: 1, anchor: "TOMORROW" },
      },
      { now: NOW, anchorDate: ANCHOR },
    );

    expect(draft.title).toBe("一个标题");
    expect(draft.durationMin).toBe(480);
    expect(draft.rewardYuan).toBe(1);
    expect(draft.groupSize).toBe(30);
    expect(draft.slots.every((s) => s.capacity === 30)).toBe(true);
  });

  it("槽位重叠时只保留先开始的那一段", () => {
    const { draft } = normalizeExperimentDraft(
      {
        title: "重叠时段测试实验",
        description: "说明文字足够长，可以过最小长度检查。",
        location: "俊秀楼 305",
        slots: [
          { startAt: at("2026-11-04", "14:00"), endAt: at("2026-11-04", "15:00"), capacity: 1 },
          { startAt: at("2026-11-04", "14:30"), endAt: at("2026-11-04", "15:30"), capacity: 1 },
        ],
      },
      { now: NOW, anchorDate: ANCHOR },
    );

    expect(draft.slots).toHaveLength(1);
    expect(draft.slots[0].startAt).toBe(at("2026-11-04", "14:00"));
  });

  it("乱传类型不抛异常，退化成空草稿 + blocking", () => {
    const result = normalizeExperimentDraft("这不是对象", { now: NOW, anchorDate: ANCHOR });
    expect(result.draft.title).toBe("");
    expect(hasBlockingDraftIssues(result.issues)).toBe(true);
  });
});

describe("reviewExperimentDraft —— 发布前体检", () => {
  it("完整的草稿没有 blocking", () => {
    const issues = reviewExperimentDraft(baseDraft(), { now: NOW });
    expect(issues.filter((i) => i.level === "block")).toEqual([]);
  });

  it("地点留占位词就拦住", () => {
    const issues = reviewExperimentDraft(baseDraft({ location: "待补充" }), { now: NOW });
    expect(issues.some((i) => i.field === "location" && i.level === "block")).toBe(true);
  });

  it("没时段、说明太短都拦住", () => {
    const issues = reviewExperimentDraft(
      baseDraft({ slots: [], description: "太短" }),
      { now: NOW },
    );
    expect(issues.some((i) => i.field === "slots" && i.level === "block")).toBe(true);
    expect(issues.some((i) => i.field === "description" && i.level === "block")).toBe(true);
  });

  it("团体人数与时长越界拦住", () => {
    const issues = reviewExperimentDraft(
      baseDraft({ type: ExperimentType.GROUP, groupSize: null, durationMin: 0, rewardYuan: 0 }),
      { now: NOW },
    );
    expect(issues.some((i) => i.field === "groupSize" && i.level === "block")).toBe(true);
    expect(issues.some((i) => i.field === "durationMin" && i.level === "block")).toBe(true);
    expect(issues.some((i) => i.field === "rewardYuan" && i.level === "block")).toBe(true);
  });

  it("部分时段已开始只提醒，不阻塞", () => {
    const issues = reviewExperimentDraft(
      baseDraft({
        slots: [
          { startAt: at("2026-11-01", "14:00"), endAt: at("2026-11-01", "14:30"), capacity: 1 },
          { startAt: at("2026-11-04", "14:00"), endAt: at("2026-11-04", "14:30"), capacity: 1 },
        ],
      }),
      { now: NOW },
    );
    expect(issues.some((i) => i.field === "slots" && i.level === "warn")).toBe(true);
    expect(issues.some((i) => i.level === "block")).toBe(false);
  });

  it("全部时段都开始了就阻塞 —— 否则会发一个谁都约不到的实验", () => {
    const issues = reviewExperimentDraft(
      baseDraft({
        slots: [{ startAt: at("2026-11-01", "14:00"), endAt: at("2026-11-01", "14:30"), capacity: 1 }],
      }),
      { now: NOW },
    );
    const issue = issues.find((i) => i.field === "slots" && i.level === "block");
    expect(issue?.message).toBe("所有时段都已经开始了，回上一步重新排");
  });

  it("截止时间只跟还没开始的时段比 —— 过去时段不能把截止时间锁死", () => {
    // 回归：曾用 sorted[0]（含过去时段）当上界，导致「必须晚于现在」和
    // 「必须早于最早时段」永远同时成立不了，一键改好也救不回来
    const issues = reviewExperimentDraft(
      baseDraft({
        slots: [
          { startAt: at("2026-11-01", "14:00"), endAt: at("2026-11-01", "14:30"), capacity: 1 },
          { startAt: at("2026-11-04", "14:00"), endAt: at("2026-11-04", "14:30"), capacity: 1 },
        ],
      }),
      { now: NOW, signupDeadline: at("2026-11-03", "18:00") },
    );
    expect(issues.some((i) => i.field === "signupDeadline")).toBe(false);
  });

  it("报名截止晚于最早时段就拦住 —— 与发布接口同一条文案", () => {
    const issues = reviewExperimentDraft(baseDraft(), {
      now: NOW,
      // 最早时段是 11-04 14:00，截止落到同一天 15:00
      signupDeadline: at("2026-11-04", "15:00"),
    });
    const issue = issues.find((i) => i.field === "signupDeadline");
    expect(issue?.level).toBe("block");
    expect(issue?.message).toBe("报名截止时间必须早于最早时段的开始时间");
  });

  it("报名截止刚好等于最早时段也算冲突（接口用 >= 判）", () => {
    const issues = reviewExperimentDraft(baseDraft(), {
      now: NOW,
      signupDeadline: at("2026-11-04", "14:00"),
    });
    expect(issues.some((i) => i.field === "signupDeadline" && i.level === "block")).toBe(true);
  });

  it("报名截止已经过去就拦住", () => {
    const issues = reviewExperimentDraft(baseDraft(), {
      now: NOW,
      signupDeadline: at("2026-11-03", "09:00"),
    });
    expect(issues.some((i) => i.field === "signupDeadline" && i.level === "block")).toBe(true);
  });

  it("不传截止时间就不检查（助手草稿没有这个字段）", () => {
    const issues = reviewExperimentDraft(baseDraft(), { now: NOW });
    expect(issues.some((i) => i.field === "signupDeadline")).toBe(false);
  });

  it("地点占位词识别：待补充 / TBD 算，真实房间不算", () => {
    expect(isPlaceholderLocation("待补充")).toBe(true);
    expect(isPlaceholderLocation("  待定 ")).toBe(true);
    expect(isPlaceholderLocation("俊秀楼 305 认知实验室")).toBe(false);
  });
});

describe("prunePastSlots / suggestSignupDeadline —— 让「一键改好」真的改得动", () => {
  // 回归现场：草稿里 11-02 起的时段全在昨天，一键改好算出「昨天前 2 小时」，
  // 报名截止依旧在过去，发布按钮永远是灰的
  const slots = [
    { startAt: at("2026-11-01", "14:00"), endAt: at("2026-11-01", "14:30"), capacity: 1 },
    { startAt: at("2026-11-04", "14:00"), endAt: at("2026-11-04", "14:30"), capacity: 1 },
    { startAt: at("2026-11-05", "10:00"), endAt: at("2026-11-05", "10:30"), capacity: 1 },
  ];

  it("丢掉已经开始的，未开始的保持原顺序", () => {
    const kept = prunePastSlots(slots, NOW);
    expect(kept.map((s) => s.startAt)).toEqual([slots[1].startAt, slots[2].startAt]);
  });

  it("startAt 是 Date 也能用（发布用例里的形状）", () => {
    const dates = [
      { startAt: new Date(at("2026-11-01", "14:00")), endAt: new Date(at("2026-11-01", "14:30")) },
      { startAt: new Date(at("2026-11-06", "09:00")), endAt: new Date(at("2026-11-06", "09:30")) },
    ];
    const kept = prunePastSlots(dates, NOW);
    expect(kept).toHaveLength(1);
    expect(kept[0].startAt.toISOString()).toBe(at("2026-11-06", "09:00"));
  });

  it("建议值取最早未开始时段前 2 小时", () => {
    expect(suggestSignupDeadline(slots, NOW)?.toISOString()).toBe(at("2026-11-04", "12:00"));
  });

  it("首个时段在两小时内时退到「现在 + 10 分钟」，不给过去时间", () => {
    const soon = [{ startAt: at("2026-11-03", "11:00") }]; // 距 NOW 一小时
    const d = suggestSignupDeadline(soon, NOW);
    expect(d?.toISOString()).toBe(new Date(NOW.getTime() + 10 * 60 * 1000).toISOString());
    expect(d!.getTime()).toBeLessThan(new Date(soon[0].startAt).getTime());
  });

  it("全都过去了 / 首个时段只剩 5 分钟 → null，不硬造一个不合法值", () => {
    expect(suggestSignupDeadline([slots[0]], NOW)).toBeNull();
    expect(suggestSignupDeadline([{ startAt: at("2026-11-03", "10:05") }], NOW)).toBeNull();
    expect(suggestSignupDeadline([], NOW)).toBeNull();
  });

  it("normalize 也丢掉过去时段，不给页面留脏数据", () => {
    const { draft } = normalizeExperimentDraft(
      { title: "面孔吸引力判断实验", slots },
      { now: NOW },
    );
    expect(draft.slots).toHaveLength(2);
  });
});

describe("composeDraftFromBrief —— 没模型时也要给出完整草稿", () => {
  it("从一句话里认出时长、报酬、星期与时间窗", () => {
    const { draft } = composeDraftFromBrief(
      "面孔吸引力判断实验，30分钟，报酬50元，下周工作日下午",
      { now: NOW, anchorDate: ANCHOR },
    );

    expect(draft.title).toBe("面孔吸引力判断实验");
    expect(draft.durationMin).toBe(30);
    expect(draft.rewardYuan).toBe(50);
    expect(draft.slotPlan?.anchor).toBe("NEXT_WEEK");
    expect(draft.slotPlan?.weekdays).toEqual([1, 2, 3, 4, 5]);
    expect(draft.slotPlan?.startTime).toBe("14:00");
    // 下周一到周五 × 每天 6 段
    expect(draft.slots).toHaveLength(30);
  });

  it("团体实验的人数写进每段容量", () => {
    const { draft } = composeDraftFromBrief(
      "团体决策实验，3人一组，60分钟，下周二和周四下午",
      { now: NOW, anchorDate: ANCHOR },
    );

    expect(draft.type).toBe(ExperimentType.GROUP);
    expect(draft.groupSize).toBe(3);
    expect(draft.slotPlan?.weekdays).toEqual([2, 4]);
    expect(draft.slots.every((s) => s.capacity === 3)).toBe(true);
    // 下午 14:00–17:00、每段 60 分钟 → 每天 3 段，两天共 6 段
    expect(draft.slots).toHaveLength(6);
  });

  it("地点不编造，留成占位并标成待补", () => {
    const { draft, issues, assumptions } = composeDraftFromBrief("记忆实验，30分钟", {
      now: NOW,
      anchorDate: ANCHOR,
    });

    expect(draft.location).toBe("待补充");
    expect(issues.some((i) => i.field === "location" && i.level === "block")).toBe(true);
    expect(assumptions.length).toBeGreaterThan(0);
  });

  it("没说时间时给工作日下午的默认计划", () => {
    const { draft } = composeDraftFromBrief("一个关于注意力的实验", { now: NOW, anchorDate: ANCHOR });
    expect(draft.slotPlan?.weekdays).toEqual([1, 3, 5]);
    expect(draft.slots.length).toBeGreaterThan(0);
  });
});

describe("publisherBanRejection —— 发布接口与发布助手共用同一条边界", () => {
  it("禁期中拒绝并带日期", () => {
    const r = publisherBanRejection(new Date("2026-11-06T10:00:00+08:00"), NOW);
    expect(r?.status).toBe(403);
    expect(r?.message).toContain("2026-11-06");
  });

  it("已过期 / 没有禁期都放行", () => {
    expect(publisherBanRejection(new Date("2026-11-01T10:00:00+08:00"), NOW)).toBeNull();
    expect(publisherBanRejection(null, NOW)).toBeNull();
  });
});
