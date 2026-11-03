/**
 * 测试夹具：构造假的 AgentContext，不碰数据库。
 * 放在 tests/fixtures/ 下，避免被 vitest 当成测试文件重复执行。
 */
import { vi } from "vitest";
import type { AgentContext, ToolSlot } from "@/tools/context";

export const NOW = new Date("2026-11-02T04:00:00.000Z");

export function slot(id: string, remaining = 2): ToolSlot {
  return {
    id,
    startAt: "2026-11-03T02:00:00.000Z",
    endAt: "2026-11-03T03:00:00.000Z",
    capacity: 3,
    bookedCount: 3 - remaining,
    remaining,
    label: `周一 10:00-11:00(${id})`,
  };
}

export function makeContext(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    experiment: {
      id: "exp1",
      title: "面孔吸引力判断实验",
      durationMin: 60,
      location: "心理楼 302",
      minCreditScore: 80,
      needsVerification: true,
    },
    subject: {
      id: "sub1",
      creditScore: 72,
      noShowCount: 1,
      bannedUntil: null,
      studentVerified: false,
    },
    availableSlots: [slot("s1"), slot("s2"), slot("s3")],
    busy: [
      {
        status: "CONFIRMED",
        slot: {
          startAt: new Date("2026-11-04T02:00:00.000Z"),
          endAt: new Date("2026-11-04T03:00:00.000Z"),
          experiment: { title: "团体决策实验" },
        },
      },
    ],
    now: NOW,
    reloadSlots: vi.fn(async () => [slot("s1"), slot("s2"), slot("s3")]),
    book: vi.fn(async (slotId: string) => ({ id: `apt-${slotId}`, status: "CONFIRMED" })),
    ...overrides,
  };
}

export function ctxOf(overrides: Partial<AgentContext> = {}) {
  const context = makeContext(overrides);
  return { ctx: context, sink: {} as Record<string, unknown>, now: NOW };
}
