/**
 * 实验发布的纯判定逻辑。
 *
 * 与 booking-rules.ts 同一路数：输入是已经解析好的数据，输出「能发」或
 * 「不能发 + 一句给用户看的话」，不碰数据库、不抛异常。
 *
 * 为什么单独拆出来：
 * 这些判断原来散在 api/experiments/route.ts 的 POST 里，和 Prisma create、
 * ApiError 混在 91 行中，想测「截止时间晚于最早时段被拒」得先起 HTTP。
 *
 * ⭐ 团体实验的核心规则也在这里：**容量是 groupSize 的派生值，不是主试的输入。**
 * 一场 3 人团体实验，一个时段就是一场实验，必须凑满 3 人 —— 所以
 * capacity 只能等于 groupSize。以前它是独立输入框，主试填 1 也能发布，
 * 结果是三个人各占三个独立时段，「团体」只剩卡片上的三个字。
 */

import { ExperimentType } from "@/domain/constants";
import type { Rejection } from "@/domain/booking-rules";

/** 一天的毫秒数 —— 只在本文件里用来算禁期到哪天，不外传 */
const DAY_MS = 24 * 60 * 60 * 1000;

export type SlotDraft = {
  startAt: Date;
  endAt: Date;
  /** 主试填的容量。团体实验下会被忽略（见 capacityForSlot） */
  capacity: number;
};

export type ExperimentDraftInput = {
  title: string;
  type: ExperimentType;
  groupSize: number | null;
  signupDeadline: Date;
  slots: SlotDraft[];
  now: Date;
  /**
   * 实验形态。ONLINE 的实验不排时段（问卷即实验），
   * 因此「至少一个时段」「截止早于最早时段」这两条对它不适用。
   */
  mode?: "ONLINE" | "OFFLINE";
};

/** 团体人数上限，与 createExperimentSchema 保持一致 */
export const MAX_GROUP_SIZE = 30;

/**
 * 单个时段的容量。
 *
 * - 团体实验：等于 groupSize。传进来的 capacity 一律无视 ——
 *   这不是「限制范围」，是「这个字段对团体实验没有意义」。
 * - 一对一实验：用主试填的值。
 */
export function capacityForSlot(
  type: ExperimentType,
  groupSize: number | null,
  rawCapacity: number,
): number {
  if (type === ExperimentType.GROUP) {
    return groupSize ?? 2;
  }
  return rawCapacity;
}

/**
 * 发布前的整体校验。返回 `null` 表示可以发布。
 *
 * 判定顺序有意为之，先报全局再报局部：
 *   1. 报名截止时间本身合法
 *   2. 至少一个时段 / 时段自身合法
 *   3. 截止时间必须早于最早时段
 *   4. 时段之间不重叠
 *   5. 团体人数合法
 *
 * 前四条都是一对一/团体共用的，第五条只在 GROUP 生效。
 */
export function assertExperimentDraft(input: ExperimentDraftInput): Rejection | null {
  const { signupDeadline, slots, type, groupSize, now, mode = "OFFLINE" } = input;

  if (Number.isNaN(signupDeadline.getTime())) {
    return { status: 400, message: "报名截止时间格式不正确" };
  }
  if (signupDeadline.getTime() <= now.getTime()) {
    return { status: 400, message: "报名截止时间必须晚于现在" };
  }

  // 线上实验不排时段：问卷提交即完成，没有「报名截止要早于最早时段」这回事
  if (mode !== "ONLINE") {
    if (slots.length === 0) {
      return { status: 400, message: "至少需要一个时段" };
    }

    for (const slot of slots) {
      if (Number.isNaN(slot.startAt.getTime()) || Number.isNaN(slot.endAt.getTime())) {
        return { status: 400, message: "时段的时间格式不正确" };
      }
      if (slot.endAt.getTime() <= slot.startAt.getTime()) {
        return { status: 400, message: "时段的结束时间必须晚于开始时间" };
      }
    }

    // 按开始时间排序后再判重叠 —— 输入的时段顺序由前端决定，不能假定有序
    const sorted = [...slots].sort((a, b) => a.startAt.getTime() - b.startAt.getTime());

    if (signupDeadline.getTime() >= sorted[0].startAt.getTime()) {
      return { status: 400, message: "报名截止时间必须早于最早时段的开始时间" };
    }
    for (let i = 1; i < sorted.length; i += 1) {
      if (sorted[i].startAt.getTime() < sorted[i - 1].endAt.getTime()) {
        return { status: 400, message: "时段之间存在重叠，请检查后重试" };
      }
    }
  }

  if (type === ExperimentType.GROUP) {
    if (!groupSize || groupSize < 2) {
      return { status: 400, message: "团体实验必须填写团体人数（≥2）" };
    }
    if (groupSize > MAX_GROUP_SIZE) {
      return { status: 400, message: `团体人数最多 ${MAX_GROUP_SIZE} 人` };
    }
  }

  return null;
}

/**
 * 团体实验的成团进度说明 —— 团体和一对一必须用不同说法。
 *
 * 「剩 2/3」在一对一里读作「还剩 2 个名额」，在团体里读作「还剩 2 个时段」，
 * 而团体实验的真实含义是「这一场还差 1 个人成团」。同一个数字，两种语义，
 * 所以文案也必须是两个来源，不能一处拼字符串。
 */
export function slotCapacityText(input: {
  type: ExperimentType;
  capacity: number;
  bookedCount: number;
}): string {
  const remaining = Math.max(0, input.capacity - input.bookedCount);
  if (input.type === ExperimentType.GROUP) {
    if (input.bookedCount <= 0) return `待成团 0/${input.capacity} 人`;
    return `已成团 ${input.bookedCount}/${input.capacity} 人`;
  }
  return remaining > 0 ? `剩 ${remaining} 个名额` : "已约满";
}

/** 团体实验是否已凑满 */
export function isGroupFormed(type: ExperimentType, capacity: number, bookedCount: number): boolean {
  return type === ExperimentType.GROUP && bookedCount >= capacity;
}

/**
 * 计算禁期截止时间 —— 主试用，被禁时提示「禁发布至 YYYY-MM-DD」。
 * 放在这里而不是页面里，是为了让「还有多久解禁」只有一处算法。
 *
 * 用上海日历日而不是 toISOString().slice(0,10)：
 * 禁期若设在当地 0 点（= 前一天 16:00Z），直接取 UTC 日期会早一天，
 * 用户会看到「昨天解禁」却仍然发不出去。
 */
export function banUntilText(bannedUntil: Date | null): string {
  if (!bannedUntil) return "";
  const shifted = new Date(bannedUntil.getTime() + 8 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

/**
 * 禁发布判定 —— 纯函数。
 *
 * 发布用例（application）和发布助手接口（route）都要用同一条边界：
 * 两处各写一遍「bannedUntil > now」迟早会漂，且文案会不一致。
 */
export function publisherBanRejection(bannedUntil: Date | null, now: Date): Rejection | null {
  if (!bannedUntil) return null;
  if (bannedUntil.getTime() <= now.getTime()) return null;
  return {
    status: 403,
    message: `因累计未到场，禁发布至 ${banUntilText(bannedUntil)}`,
  };
}

/** 距解禁还有几天（向上取整，最小 0） */
export function banDaysLeft(bannedUntil: Date | null, now: Date): number {
  if (!bannedUntil) return 0;
  return Math.max(0, Math.ceil((bannedUntil.getTime() - now.getTime()) / DAY_MS));
}
