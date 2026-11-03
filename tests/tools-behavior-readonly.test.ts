import { describe, expect, it, vi } from "vitest";
import { createToolRegistry } from "@/tools";
import { ctxOf, slot } from "./fixtures/agent-context";

/**
 * 2.3 只读类工具的行为测试（get_available_slots / get_my_busy_slots / get_my_credit_status）。
 * 全部用假 context，不碰数据库 —— 这正是把依赖注入进去的目的。
 */

const reg = createToolRegistry();

describe("get_available_slots", () => {
  it("重新读一次最新时段（不全信缓存）", async () => {
    const reload = vi.fn(async () => [slot("fresh")]);
    const c = ctxOf({ reloadSlots: reload });

    const result = await reg.exec("get_available_slots", {}, c as never);

    expect(reload).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      ok: true,
      slots: [{ id: "fresh", label: "周一 10:00-11:00(fresh)", remaining: 2 }],
    });
  });

  it("空结果返回空数组而不是报错", async () => {
    const c = ctxOf({ reloadSlots: async () => [] });
    const result = await reg.exec("get_available_slots", {}, c as never);
    expect(result).toEqual({ ok: true, slots: [] });
  });
});

describe("get_my_busy_slots", () => {
  it("把已有预约格式化成可读标签", async () => {
    const c = ctxOf();
    const result = await reg.exec("get_my_busy_slots", {}, c as never);

    expect(result.ok).toBe(true);
    const slots = result.slots as { label: string; experiment: string; status: string }[];
    expect(slots).toHaveLength(1);
    expect(slots[0].experiment).toBe("团体决策实验");
    expect(slots[0].status).toBe("CONFIRMED");
    expect(slots[0].label).toContain("-");
  });
});

describe("get_my_credit_status", () => {
  it("返回信誉/禁期/认证/实验门槛", async () => {
    const c = ctxOf();
    const result = await reg.exec("get_my_credit_status", {}, c as never);

    expect(result).toMatchObject({
      ok: true,
      creditScore: 72,
      noShowCount: 1,
      studentVerified: false,
      minCreditScore: 80,
      needsVerification: true,
    });
  });

  it("bannedUntil 为 null 时输出 null（不是 undefined）", async () => {
    const c = ctxOf();
    const result = await reg.exec("get_my_credit_status", {}, c as never);
    expect(result.bannedUntil).toBeNull();
  });

  it("有禁期时输出 ISO 字符串", async () => {
    const banned = new Date("2026-11-05T00:00:00.000Z");
    const c = ctxOf({
      subject: {
        id: "sub1",
        creditScore: 94,
        noShowCount: 3,
        bannedUntil: banned,
        studentVerified: true,
      },
    });
    const result = await reg.exec("get_my_credit_status", {}, c as never);
    expect(result.bannedUntil).toBe("2026-11-05T00:00:00.000Z");
  });
});
