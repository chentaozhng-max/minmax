import { describe, expect, it } from "vitest";
import { findOverlaps, isUpcoming, pickActiveOverlaps, sortByStart } from "@/domain/assistant-brief";

const at = (h: number, m = 0) => new Date(`2026-11-05T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00+08:00`);

function item(id: string, startH: number, endH: number, title = id) {
  return { id, title, startAt: at(startH), endAt: at(endH) };
}

describe("findOverlaps", () => {
  it("完全无关的两场 → 无撞车", () => {
    expect(findOverlaps([item("a", 9, 10), item("b", 14, 15)])).toEqual([]);
  });

  it("★ 首尾相接不算撞车（前一场 15:00 结束、后一场 15:00 开始）", () => {
    // 这是最常见的误判：用 <= 就会把正常衔接的两场报成冲突
    expect(findOverlaps([item("a", 14, 15), item("b", 15, 16)])).toEqual([]);
  });

  it("部分重叠 → 撞车，且给出重叠区间", () => {
    const [pair] = findOverlaps([item("a", 14, 16), item("b", 15, 17)]);
    expect(pair.first.id).toBe("a");
    expect(pair.second.id).toBe("b");
    expect(pair.overlapStart).toEqual(at(15));
    expect(pair.overlapEnd).toEqual(at(16));
  });

  it("一场完整包含另一场 → 撞车，重叠区 = 被包含的那场", () => {
    const [pair] = findOverlaps([item("big", 9, 18), item("small", 14, 15)]);
    expect(pair.overlapStart).toEqual(at(14));
    expect(pair.overlapEnd).toEqual(at(15));
  });

  it("参数顺序反过来（后一场先传）→ 重叠区不变", () => {
    const [pair] = findOverlaps([item("b", 15, 17), item("a", 14, 16)]);
    expect(pair.overlapStart).toEqual(at(15));
    expect(pair.overlapEnd).toEqual(at(16));
  });

  it("三场互相重叠 → 暴出 3 对（不是 1 组）", () => {
    // O(n²) 的代价：三条全重叠时返回 3 对。调用方靠 pairs.length 说话，
    // 所以文案是「3 组撞车」而不是「1 组」—— 这是刻意的，逐对暴露更利于定位。
    const pairs = findOverlaps([item("a", 9, 12), item("b", 10, 13), item("c", 11, 14)]);
    expect(pairs).toHaveLength(3);
  });

  it("空列表 / 单条 → 无撞车", () => {
    expect(findOverlaps([])).toEqual([]);
    expect(findOverlaps([item("a", 9, 10)])).toEqual([]);
  });
});

describe("isUpcoming", () => {
  it("还没开始 → 是", () => {
    expect(isUpcoming(item("a", 14, 15), at(10))).toBe(true);
  });

  it("★ 正在进行（已开始未结束）→ 仍是「接下来」，因为还要去", () => {
    expect(isUpcoming(item("a", 14, 15), at(14, 30))).toBe(true);
  });

  it("已结束 → 不是", () => {
    expect(isUpcoming(item("a", 14, 15), at(15, 1))).toBe(false);
  });

  it("★ 结束时刻正好等于现在 → 不是（半开区间，与 findOverlaps 一致）", () => {
    expect(isUpcoming(item("a", 14, 15), at(15))).toBe(false);
  });
});

describe("sortByStart", () => {
  it("按开始时间升序", () => {
    const sorted = sortByStart([item("c", 16, 17), item("a", 9, 10), item("b", 14, 15)]);
    expect(sorted.map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("不改原数组", () => {
    const input = [item("b", 14, 15), item("a", 9, 10)];
    sortByStart(input);
    expect(input[0].id).toBe("b");
  });
});

describe("pickActiveOverlaps — 「我的预约」页用的那个", () => {
  const ACTIVE = ["PENDING_SUBJECT_CONFIRM", "AWAITING_RESEARCHER", "CONFIRMED", "CHECKED_IN"];
  const now = at(12);
  const row = (
    id: string,
    startH: number,
    endH: number,
    status = "CONFIRMED",
  ) => ({ ...item(id, startH, endH), status });

  it("两场活跃且重叠 → 报一对", () => {
    const pairs = pickActiveOverlaps([row("a", 14, 16), row("b", 15, 17)], ACTIVE, now);
    expect(pairs).toHaveLength(1);
  });

  it("★ 已取消的那场不算占用（否则会提醒一堆不存在的问题）", () => {
    const pairs = pickActiveOverlaps(
      [row("a", 14, 16), row("b", 15, 17, "CANCELLED_BY_SUBJECT")],
      ACTIVE,
      now,
    );
    expect(pairs).toEqual([]);
  });

  it("★ 已结束的不算（哪怕今天早些时候真的撞过）", () => {
    const pairs = pickActiveOverlaps([row("a", 9, 11), row("b", 10, 11)], ACTIVE, now);
    expect(pairs).toEqual([]);
  });

  it("未到场 / 已完成也不算", () => {
    for (const status of ["NO_SHOW", "COMPLETED", "CANCELLED_BY_RESEARCHER"]) {
      const pairs = pickActiveOverlaps(
        [row("a", 14, 16), row("b", 15, 17, status)],
        ACTIVE,
        now,
      );
      expect(pairs, status).toEqual([]);
    }
  });

  it("正在进行的算占用（还没去完）", () => {
    const pairs = pickActiveOverlaps([row("a", 11, 14), row("b", 13, 15)], ACTIVE, now);
    expect(pairs).toHaveLength(1);
  });

  it("结束时刻等于现在 → 不算（半开区间）", () => {
    const pairs = pickActiveOverlaps([row("a", 10, 12), row("b", 11, 13)], ACTIVE, now);
    // a 在 12:00 结束，now 也是 12:00 → a 被过滤掉，不构成撞车
    expect(pairs).toEqual([]);
  });
});
