import { describe, expect, it } from "vitest";
import {
  applyAttendance,
  applyPenalty,
  banDaysFor,
  checkEligibility,
  CREDIT,
  isBanned,
  isFreeSubjectCancel,
} from "@/lib/credit";

const NOW = new Date("2026-10-27T04:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function daysFromNow(date: Date | null) {
  if (!date) return null;
  return Math.round((date.getTime() - NOW.getTime()) / DAY);
}

describe("禁期升级（§9.4）", () => {
  it("第 1、2、3 次未到场都禁 1 天", () => {
    expect(banDaysFor(1)).toBe(1);
    expect(banDaysFor(2)).toBe(1);
    expect(banDaysFor(3)).toBe(1);
  });

  it("第 4 次及以后禁 7 天", () => {
    expect(banDaysFor(4)).toBe(7);
    expect(banDaysFor(5)).toBe(7);
    expect(banDaysFor(9)).toBe(7);
  });
});

describe("未到场处罚", () => {
  it("扣 2 分、次数 +1、首次禁 1 天", () => {
    const result = applyPenalty({ creditScore: 100, noShowCount: 0, bannedUntil: null }, NOW);
    expect(result.creditScore).toBe(98);
    expect(result.noShowCount).toBe(1);
    expect(result.delta).toBe(-2);
    expect(daysFromNow(result.bannedUntil)).toBe(1);
  });

  it("连续三次未到场都是 1 天，第四次变 7 天", () => {
    let snapshot = { creditScore: 100, noShowCount: 0, bannedUntil: null as Date | null };
    const bans: (number | null)[] = [];
    for (let i = 0; i < 5; i += 1) {
      const next = applyPenalty(snapshot, NOW);
      bans.push(daysFromNow(next.bannedUntil));
      snapshot = {
        creditScore: next.creditScore,
        noShowCount: next.noShowCount,
        bannedUntil: null,
      };
    }
    expect(bans).toEqual([1, 1, 1, 7, 7]);
  });

  it("分数不会扣到负数", () => {
    const result = applyPenalty({ creditScore: 1, noShowCount: 0, bannedUntil: null }, NOW);
    expect(result.creditScore).toBe(0);
  });

  it("已有的更长禁期不会被缩短", () => {
    const longer = new Date(NOW.getTime() + 5 * DAY);
    const result = applyPenalty({ creditScore: 90, noShowCount: 1, bannedUntil: longer }, NOW);
    expect(result.bannedUntil?.getTime()).toBe(longer.getTime());
  });
});

describe("到场加分", () => {
  it("+1，且不超过 100", () => {
    expect(applyAttendance({ creditScore: 99, noShowCount: 0, bannedUntil: null }).creditScore).toBe(100);
    const capped = applyAttendance({ creditScore: 100, noShowCount: 0, bannedUntil: null });
    expect(capped.creditScore).toBe(100);
    expect(capped.delta).toBe(0);
  });
});

describe("禁期判定", () => {
  it("禁期内 isBanned 为 true，过期后为 false", () => {
    expect(isBanned(new Date(NOW.getTime() + 1000), NOW)).toBe(true);
    expect(isBanned(new Date(NOW.getTime() - 1000), NOW)).toBe(false);
    expect(isBanned(null, NOW)).toBe(false);
  });
});

describe("报名资格（前端置灰与服务端拦截共用）", () => {
  const base = {
    bannedUntil: null,
    creditScore: 100,
    studentVerified: true,
    minCreditScore: 0,
    needsVerification: true,
  };

  it("禁期内不能报名", () => {
    const result = checkEligibility(
      { ...base, bannedUntil: new Date(NOW.getTime() + DAY) },
      NOW,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("BANNED");
  });

  it("信誉分 72 报名要求 80 的实验被拦截，文案带具体数字", () => {
    const result = checkEligibility({ ...base, creditScore: 72, minCreditScore: 80 }, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("CREDIT");
      expect(result.message).toContain("80");
      expect(result.message).toContain("72");
    }
  });

  it("未认证报名 needsVerification 实验被拦截", () => {
    const result = checkEligibility({ ...base, studentVerified: false }, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("VERIFY");
  });

  it("needsVerification=false 时未认证也能报名", () => {
    const result = checkEligibility(
      { ...base, studentVerified: false, needsVerification: false },
      NOW,
    );
    expect(result.ok).toBe(true);
  });

  it("刚好达到门槛可以通过", () => {
    expect(checkEligibility({ ...base, creditScore: 80, minCreditScore: 80 }, NOW).ok).toBe(true);
  });
});

describe("被试取消的 12 小时线", () => {
  it("距离开始 12 小时以上可以免费取消", () => {
    expect(isFreeSubjectCancel(new Date(NOW.getTime() + 12 * 3600 * 1000), NOW)).toBe(true);
  });
  it("不足 12 小时不能取消", () => {
    expect(isFreeSubjectCancel(new Date(NOW.getTime() + 11.9 * 3600 * 1000), NOW)).toBe(false);
  });
  it("阈值常量与规则一致", () => {
    expect(CREDIT.FREE_CANCEL_HOURS).toBe(12);
    expect(CREDIT.PENALTY_DELTA).toBe(2);
  });
});
