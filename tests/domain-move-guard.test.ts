import { describe, expect, it } from "vitest";
import * as viaLib from "@/lib/domain";
import * as constants from "@/domain/constants";
import * as messages from "@/domain/messages";
import * as schemas from "@/domain/schemas";
import * as creditViaLib from "@/lib/credit";
import * as creditDomain from "@/domain/credit";
import * as matchingViaLib from "@/lib/matching";
import * as matchingDomain from "@/domain/matching";
import * as rewardViaLib from "@/lib/reward";
import * as rewardDomain from "@/domain/reward";

/**
 * 3.5 护栏：搬家最容易出的错是「漏搬一个导出」。
 *
 * tsc 能抓 import 失败，但抓不到「某个导出只在运行时才用到」的情况。
 * 这里直接把转发壳的导出面与目标模块的导出面做集合比对 —— 一个都不能少。
 */

describe("lib/domain.ts 转发壳覆盖三份拆分模块的全部导出", () => {
  it("constants / messages / schemas 的每一个导出都能通过 lib/domain 拿到", () => {
    const expected = [
      ...Object.keys(constants),
      ...Object.keys(messages),
      ...Object.keys(schemas),
    ].sort();

    const actual = Object.keys(viaLib)
      .filter((k) => k !== "default")
      .sort();

    expect(actual).toEqual(expected);
  });

  it("拆分前的关键导出逐个点名（防集合恰好相等但语义错位）", () => {
    const required = [
      // constants
      "Role", "roleLabel", "ExperimentType", "ExperimentStatus",
      "AppointmentStatus", "CreditReason", "AppealStatus", "ChatState",
      "ACTIVE_APPOINTMENT_STATUSES", "OCCUPYING_STATUSES",
      "appointmentStatusLabel", "creditReasonLabel", "experimentStatusLabel",
      // messages
      "parseMessages", "stringifyMessages",
      // schemas
      "loginSchema", "sendCodeSchema", "verifyEduEmailSchema", "confirmVerifySchema",
      "slotInputSchema", "createExperimentSchema", "bookSlotSchema",
      "editExperimentSchema", "chatMessageSchema",
    ];

    for (const name of required) {
      expect(viaLib, `缺少导出 ${name}`).toHaveProperty(name);
    }
  });

  it("三份模块之间没有同名导出（否则 export * 会静默丢弃）", () => {
    const names = [constants, messages, schemas].flatMap((m) =>
      Object.keys(m).filter((k) => k !== "default"),
    );
    const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
    expect(duplicates, `重名导出：${duplicates.join(", ")}`).toEqual([]);
  });
});

describe("credit / matching / reward 转发壳与目标模块导出面一致", () => {
  it("lib/credit 与 domain/credit 导出集合相同", () => {
    const pick = (m: object) => Object.keys(m).filter((k) => k !== "default").sort();
    expect(pick(creditViaLib)).toEqual(pick(creditDomain));
  });

  it("lib/matching 与 domain/matching 导出集合相同", () => {
    const pick = (m: object) => Object.keys(m).filter((k) => k !== "default").sort();
    expect(pick(matchingViaLib)).toEqual(pick(matchingDomain));
  });

  it("lib/reward 与 domain/reward 导出集合相同", () => {
    const pick = (m: object) => Object.keys(m).filter((k) => k !== "default").sort();
    expect(pick(rewardViaLib)).toEqual(pick(rewardDomain));
  });
});

describe("搬家后运行时行为不变（抽查关键纯函数）", () => {
  it("banDaysFor 阶梯仍为 1/1/1/7", () => {
    expect(creditViaLib.banDaysFor(1)).toBe(1);
    expect(creditViaLib.banDaysFor(3)).toBe(1);
    expect(creditViaLib.banDaysFor(4)).toBe(7);
  });

  it("checkEligibility 三种拒绝原因都还在", () => {
    const now = new Date("2026-11-02T00:00:00.000Z");
    expect(
      creditViaLib.checkEligibility(
        {
          bannedUntil: new Date("2026-11-05T00:00:00.000Z"),
          creditScore: 100,
          studentVerified: true,
          minCreditScore: 0,
          needsVerification: false,
        },
        now,
      ).ok,
    ).toBe(false);
    expect(
      creditViaLib.checkEligibility(
        {
          bannedUntil: null,
          creditScore: 50,
          studentVerified: true,
          minCreditScore: 80,
          needsVerification: false,
        },
        now,
      ).ok,
    ).toBe(false);
    expect(
      creditViaLib.checkEligibility(
        {
          bannedUntil: null,
          creditScore: 100,
          studentVerified: false,
          minCreditScore: 0,
          needsVerification: true,
        },
        now,
      ).ok,
    ).toBe(false);
  });

  it("parseMessages 遇到坏 JSON 返回空数组而不是抛错", () => {
    expect(viaLib.parseMessages("{broken")).toEqual([]);
    expect(viaLib.parseMessages("[]")).toEqual([]);
  });

  it("stringifyMessages / parseMessages 往返一致", () => {
    const msgs = [
      { role: "user" as const, content: "你好", createdAt: "2026-11-02T00:00:00.000Z" },
    ];
    expect(viaLib.parseMessages(viaLib.stringifyMessages(msgs))).toEqual(msgs);
  });

  it("createExperimentSchema 仍拒绝团体实验缺人数", () => {
    const result = viaLib.createExperimentSchema.safeParse({
      title: "一个合法的实验标题",
      description: "这是一段足够长的实验描述内容",
      location: "心理楼 302",
      durationMin: 60,
      rewardText: "¥30",
      type: "GROUP",
      minCreditScore: 0,
      needsVerification: false,
      signupDeadline: "2026-12-01T00:00:00.000Z",
      slots: [{ startAt: "2026-12-02T02:00:00.000Z", endAt: "2026-12-02T03:00:00.000Z", capacity: 3 }],
    });
    expect(result.success).toBe(false);
  });
});
