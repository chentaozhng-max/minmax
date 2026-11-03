/**
 * 工具上下文 —— agent 层与工具层之间的契约。
 *
 * 这里刻意**不用** `Awaited<ReturnType<typeof loadContext>>`：
 * 那样 tools/ 会反向依赖 server/agent.ts，而 agent.ts 又要 import tools/，
 * 形成循环依赖。改成结构化的最小形状，两边互不认对方实现，测试也能用假数据。
 *
 * 字段是「工具真正需要看的东西」，不是数据库模型的全集。
 */

/** 工具眼里的一门实验 */
export type ToolExperiment = {
  id: string;
  title: string;
  durationMin: number;
  location: string;
  minCreditScore: number;
  needsVerification: boolean;
};

/** 工具眼里的当前被试 */
export type ToolSubject = {
  id: string;
  creditScore: number;
  noShowCount: number;
  bannedUntil: Date | null;
  studentVerified: boolean;
};

/** 工具眼里的一个可约时段 */
export type ToolSlot = {
  id: string;
  startAt: string;
  endAt: string;
  capacity: number;
  bookedCount: number;
  remaining: number;
  label: string;
};

/** 工具眼里的一条已有预约 */
export type ToolBusyAppointment = {
  status: string;
  slot: {
    startAt: Date;
    endAt: Date;
    experiment: { title: string };
  };
};

/** 工具执行时能看到的全部业务上下文 */
export type AgentContext = {
  experiment: ToolExperiment;
  subject: ToolSubject;
  availableSlots: ToolSlot[];
  busy: ToolBusyAppointment[];
  now: Date;
  /**
   * 重新读一次可约时段（用于「展示前再确认一次还有空位」这类需要最新数据的地方）。
   * 注入成回调，避免工具层直接 import prisma。
   */
  reloadSlots(): Promise<ToolSlot[]>;
  /**
   * 锁位并建预约。同样注入，避免工具层依赖 bookSlot 的具体实现。
   */
  book(slotId: string): Promise<{ id: string; status: string }>;
};
