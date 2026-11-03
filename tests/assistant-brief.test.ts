import { describe, expect, it } from "vitest";
import { findOverlaps, isUpcoming, sortByStart } from "@/domain/assistant-brief";

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
