/**
 * 助手「先看再说」的判定规则 —— 纯函数，不碰 IO，不认数据库。
 *
 * 这一层只回答一个问题：**给我一堆预约，哪些事值得提醒他自己注意？**
 * 现在只有一条规则：时间撞车。将来要加「离得远的两场排在同一天」「距离开场不足 1 小时
 * 还没确认」这类，都往这个文件加函数，页面和用例都不用改。
 *
 * 为什么要独立成 domain：撞车判定是**关于时间的业务事实**，跟谁来渲染、数据从哪来无关。
 * 放进页面里写 if 语句，就等于把这套规则钉死在唯一一个消费者身上。
 */

/** 助手眼里的一条占用（预约 / 排期） */
export type BusyInterval = {
  id: string;
  /** 实验名，用于文案 */
  title: string;
  startAt: Date;
  endAt: Date;
};

/** 一对撞车的预约 */
export type OverlapPair = {
  first: BusyInterval;
  second: BusyInterval;
  /** 重叠的起止，用于说清「撞了多久」 */
  overlapStart: Date;
  overlapEnd: Date;
};

/**
 * 找出所有时间重叠的预约对。
 *
 * 「重叠」= `a.start < b.end && b.start < a.end`（半开区间）：
 * 前一场 15:00 结束、后一场 15:00 开始 —— **不算撞车**，这是最常见的误判，
 * 所以两个比较都用严格小于。
 *
 * 复杂度 O(n²) 而非排序扫描：助手一屏最多几十条，可读性比性能重要；
 * 而且排序扫描要处理「三条互相重叠」的分组，写起来更容易错。
 */
export function findOverlaps(items: BusyInterval[]): OverlapPair[] {
  const pairs: OverlapPair[] = [];
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const a = items[i];
      const b = items[j];
      const start = a.startAt > b.startAt ? a.startAt : b.startAt;
      const end = a.endAt < b.endAt ? a.endAt : b.endAt;
      // 严格小于：首尾相接不算重叠
      if (start.getTime() < end.getTime()) {
        pairs.push({ first: a, second: b, overlapStart: start, overlapEnd: end });
      }
    }
  }
  return pairs;
}

/** 已开场/已结束的不算「接下来」 */
export function isUpcoming(item: BusyInterval, now: Date): boolean {
  return item.endAt.getTime() > now.getTime();
}

/**
 * 从一批「带状态的占用」里挑出真正会撞车的那些。
 *
 * ## 为什么要有这个函数，而不是在页面里写 filter
 *
 * 页面（我的预约）是 client component：数据由 react-query 拉、取消/确认后要立刻刷新，
 * 所以不能在服务端算好传下去。但「什么算占用」是**业务规则**：
 *   · 已取消 / 已爽约的不占用时间
 *   · 已经结束的不占用时间
 * 这套规则一旦写进组件里，就只能靠肉眼和真浏览器验证 —— 单测碰不到。
 * 抽出来之后它是纯函数，规则错立刻红。
 *
 * 参数收「带 status 的扁平对象」而不是领域实体：这样 domain 层不用知道
 * Appointment 长什么样（它只需要知道「有 id、标题、起止、状态」）。
 */
export function pickActiveOverlaps<T extends { id: string; title: string; startAt: Date; endAt: Date; status: string }>(
  items: T[],
  activeStatuses: readonly string[],
  now: Date,
): OverlapPair[] {
  const active = items.filter(
    (a) => activeStatuses.includes(a.status) && a.endAt.getTime() > now.getTime(),
  );
  return findOverlaps(
    active.map((a) => ({ id: a.id, title: a.title, startAt: a.startAt, endAt: a.endAt })),
  );
}

/** 按开始时间升序（助手要把「最近一场」放最前） */
export function sortByStart<T extends { startAt: Date }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
}
