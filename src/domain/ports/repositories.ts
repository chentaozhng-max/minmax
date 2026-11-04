/**
 * 仓储端口 —— 领域层对「数据存在哪」的唯一认知。
 *
 * 这里只有「我要什么能力」，没有一个字提到 Prisma / SQL / 事务 / 连接池。
 * 实现放在 adapters/db/prisma/，SQL 原样搬过去，语义不变。
 *
 * 依赖方向：application/ → domain/ports/ ← adapters/db/prisma/
 */

import type { AppointmentStatus, ExperimentStatus } from "@/domain/constants";

/** 时段记录（含它所属的实验，报名判定需要看实验状态与门槛） */
export type SlotRecord = {
  id: string;
  experimentId: string;
  startAt: Date;
  endAt: Date;
  capacity: number;
  bookedCount: number;
  experiment: ExperimentRecord;
};

/** 实验记录（报名判定只用得到这几个字段） */
export type ExperimentRecord = {
  id: string;
  title: string;
  researcherId: string;
  status: ExperimentStatus;
  signupDeadline: Date;
  minCreditScore: number;
  needsVerification: boolean;
  /** 需要先通过问卷筛选才能预约。老记录 / 测试夹具不填时按 false 处理 */
  needsQuestionnaire?: boolean;
};

/** 预约记录（含冲突判定要用的时段信息） */
export type AppointmentRecord = {
  id: string;
  experimentId: string;
  slotId: string;
  subjectId: string;
  status: AppointmentStatus;
  createdAt: Date;
};

/** 带时段与实验的预约 —— 冲突提示里要报出「与哪个实验冲突」 */
export type AppointmentWithSlot = AppointmentRecord & {
  slot: { id: string; startAt: Date; endAt: Date; experiment: { title: string } };
};

export type CreateAppointmentInput = {
  experimentId: string;
  slotId: string;
  subjectId: string;
  status: AppointmentStatus;
  createdAt: Date;
};

export interface SlotRepository {
  /** 查时段（含所属实验） */
  findById(id: string): Promise<SlotRecord | null>;

  /**
   * 原子占位：成功 true，容量不足 false。
   *
   * 实现必须用**条件 UPDATE**（`WHERE bookedCount < capacity`），
   * 绝不允许「先查余量再自增」—— 那在多请求并发下会超卖。
   * 这条是本书面契约的关键：实现换掉也必须守住。
   */
  tryOccupy(slotId: string): Promise<boolean>;

  /** 释放一个名额，`bookedCount` 不允许减到负数 */
  release(slotId: string): Promise<void>;
}

export interface AppointmentRepository {
  /** 按「时段 + 被试」查已有预约，用于「不能重复预约同一时段」判定 */
  findBySlotAndSubject(slotId: string, subjectId: string): Promise<AppointmentRecord | null>;

  /** 查与该时段时间重叠的其他有效预约，用于时间冲突判定 */
  findConflicts(subjectId: string, slot: SlotRecord): Promise<AppointmentWithSlot[]>;

  create(input: CreateAppointmentInput): Promise<AppointmentRecord>;

  /** 把一条已存在的预约重置为待确认（复活语义：清空确认/签到/失约/申诉痕迹） */
  reactivate(id: string, status: AppointmentStatus, createdAt: Date): Promise<AppointmentRecord>;
}

/** 聊天会话记录（agent 的对话状态） */
export type ChatSessionRecord = {
  id: string;
  experimentId: string;
  subjectId: string;
  state: string;
  /** messages 是序列化后的 JSON 字符串，组装成 ChatMessage[] 由应用层负责 */
  messages: string;
};

export interface ChatSessionRepository {
  /** 按「实验 + 被试」查会话（两者联合唯一） */
  findByExperimentAndSubject(experimentId: string, subjectId: string): Promise<ChatSessionRecord | null>;

  create(input: { experimentId: string; subjectId: string; state: string; messages: string }): Promise<ChatSessionRecord>;

  /**
   * 保存对话进度。
   *
   * 这一个方法取代了重构前散落在 agent.ts 里的 7 处
   * `prisma.chatSession.update({ data: { messages, state } })`。
   * 语义：整份 messages 覆盖写 + 状态推进，两步必须原子（同一个 update）。
   */
  save(id: string, state: string, messages: string): Promise<ChatSessionRecord>;
}

/** 一组仓储。事务内外都是这个形状，差别只在背后绑的是 prisma 还是 tx */
export interface RepositoryBundle {
  slots: SlotRepository;
  appointments: AppointmentRepository;
}

export interface TransactionPort extends RepositoryBundle {
  /**
   * 在一个事务里跑 fn。
   *
   * 关键约定：`tryOccupy` 与 `appointments.create` 必须落在**同一个**事务里，
   * 否则占位成功但建单失败会漏掉一个名额。
   */
  runInTransaction<T>(fn: (tx: RepositoryBundle) => Promise<T>): Promise<T>;
}
