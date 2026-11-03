/**
 * 页面查询端口 —— 给 RSC（服务端渲染页面）用的只读查询。
 *
 * 与 queries.ts 的关系：那个是 agent 对话上下文的查询，这个是**页面渲染**的查询。
 * 分成两个文件而不是一个，是因为它们服务不同的上层：
 *   - queries.ts     ← server/agent.ts（对话编排，字段随提示词变）
 *   - page-queries.ts ← app/**\/page.tsx（渲染，字段随手版设计变）
 * 合成一个文件的话，页面上加个字段就要动 agent 的类型，反之亦然。
 *
 * 依赖方向：app/ → domain/ports/ ← adapters/db/prisma/
 * 注意：app/ 属于适配层（表现层适配器），它依赖 domain 的端口是合规方向。
 */

import type { CreditReason, ExperimentType } from "@/domain/constants";

/** 我的页面顶部那个用户卡片 */
export type MeProfile = {
  id: string;
  name: string;
  school: string | null;
  department: string | null;
  phone: string;
  studentVerified: boolean;
  creditScore: number;
  noShowCount: number;
  bannedUntil: Date | null;
};

/** 信誉分变动条目 */
export type CreditEventSummary = {
  id: string;
  delta: number;
  reason: CreditReason | string;
  note: string | null;
  createdAt: Date;
};

/** 「已完成 / 进行中」两个数字 */
export type AppointmentCounts = {
  completed: number;
  ongoing: number;
};

/** 消息页「选时段的记录」一条 */
export type ChatSessionSummary = {
  id: string;
  experimentId: string;
  state: string;
  messages: string;
  updatedAt: Date;
  experiment: {
    title: string;
    durationMin: number;
    rewardText: string;
    researcherName: string;
  };
};

/** 对话页头部要展示的实验信息 */
export type ChatHeaderExperiment = {
  id: string;
  title: string;
  durationMin: number;
  location: string;
  rewardText: string;
  researcherName: string;
};

export interface PageQueryPort {
  /**「我的」页顶部用户卡片；不存在返回 null */
  findMeProfile(userId: string): Promise<MeProfile | null>;

  /**「我的」页信誉分变动，按时间倒序取前 take 条 */
  findRecentCreditEvents(userId: string, take: number): Promise<CreditEventSummary[]>;

  /**「我的」页两个数字：已完成 / 进行中 */
  countAppointmentsByStatus(userId: string, completedStatuses: string[], ongoingStatuses: string[]): Promise<AppointmentCounts>;

  /** 消息页「选时段的记录」，按更新时间倒序 */
  findChatSessionsForSubject(subjectId: string): Promise<ChatSessionSummary[]>;

  /** 对话页头部的实验信息；不存在返回 null */
  findChatHeaderExperiment(experimentId: string): Promise<ChatHeaderExperiment | null>;
}

/* ═════════════════════ 第二批：实验详情 / 信誉分 / 账号 / 主试主页 ═════════════════════
 *
 * 按「页面区域」拆成几个小端口，而不是往 PageQueryPort 里继续堆方法。
 * 理由：这些页面彼此无关（实验详情 vs 信誉分 vs 认证表单），
 * 混成一个接口后，任何一处加字段都要整个接口的实现跟着动 —— 那就退回到原来
 * 「一个 prisma 到处查」的耦合，只是换了个名字。
 * 适配器侧仍然是一个 makePageQuery()，返回的对象同时满足全部接口。
 */

/** 实验详情页需要的主试信息（展示 + 联系卡） */
export type ResearcherCard = {
  id: string;
  name: string;
  school: string | null;
  department: string | null;
  studentVerified: boolean;
  creditScore: number;
};

/** 实验详情页的完整实验（含主试与全部时段，升序） */
export type ExperimentPageDetail = {
  id: string;
  title: string;
  researcherId: string;
  status: string;
  type: ExperimentType;
  groupSize: number | null;
  location: string;
  durationMin: number;
  rewardText: string;
  description: string;
  requirements: string | null;
  minCreditScore: number;
  needsVerification: boolean;
  signupDeadline: Date;
  researcher: ResearcherCard;
  slots: Array<{ id: string; startAt: Date; endAt: Date; capacity: number; bookedCount: number }>;
};

/** 详情页底部「已约 xx」用的那条预约 */
export type MyAppointmentBrief = {
  id: string;
  status: string;
  slot: { startAt: Date; endAt: Date };
};

export interface ExperimentPageQuery {
  findExperimentPageDetail(experimentId: string): Promise<ExperimentPageDetail | null>;

  /** 我在这个实验下的一条有效预约（详情页显示「已约 xx」） */
  findMyAppointment(experimentId: string, subjectId: string, statuses: string[]): Promise<MyAppointmentBrief | null>;

  /** 某主试「在招实验」数（发布者卡片下方那行） */
  countPublishedExperiments(researcherId: string): Promise<number>;
}

/** 认证页表单初值（学生认证与主试认证共用） */
export type VerifyFormUser = {
  studentVerified: boolean;
  school: string | null;
  studentId: string | null;
  eduEmail: string | null;
};

/** 完善资料页表单初值 */
export type OnboardingUser = {
  role: string;
  school: string | null;
  department: string | null;
  grade: string | null;
  interests: string | null;
  timePreference: string | null;
};

export interface AccountPageQuery {
  findVerifyFormUser(userId: string): Promise<VerifyFormUser | null>;
  findOnboardingUser(userId: string): Promise<OnboardingUser | null>;
}

/** 主试公开主页 */
export type ResearcherPublicPage = {
  id: string;
  name: string;
  school: string | null;
  department: string | null;
  studentVerified: boolean;
  creditScore: number;
  noShowCount: number;
  /** 按时主持过的次数（reason=ATTENDED 的信誉流水条数） */
  hostedCount: number;
  experiments: Array<{
    id: string;
    title: string;
    rewardText: string;
    durationMin: number;
    location: string;
    slots: Array<{ startAt: Date; capacity: number; bookedCount: number }>;
  }>;
};

/** 主试个人中心的待办数字 + 最近流水 */
export type ResearcherDashboard = {
  events: CreditEventSummary[];
  experimentCount: number;
  publishedCount: number;
  /** 等我确认 + 已签到 的预约数 */
  awaitingCount: number;
  /** 待处理申诉数 */
  appealCount: number;
};

export interface ResearcherPageQuery {
  findResearcherPublicPage(researcherId: string): Promise<ResearcherPublicPage | null>;
  findResearcherDashboard(userId: string, eventTake: number): Promise<ResearcherDashboard>;
}

/** 信誉分页顶部的用户信息（被试与主试共用，role 决定文案） */
export type CreditPageUser = {
  id: string;
  role: string;
  creditScore: number;
  noShowCount: number;
  bannedUntil: Date | null;
};

/** 信誉分流水（页面渲染用，带 appointmentId 以便回填关联预约） */
export type CreditEventFull = {
  id: string;
  delta: number;
  reason: string;
  note: string | null;
  appointmentId: string | null;
  createdAt: Date;
};

/** 信誉分列表页的关联预约（一次批量取，避免 N+1） */
export type CreditAppointmentBrief = {
  id: string;
  status: string;
  experiment: { title: string };
  slot: { startAt: Date; endAt: Date };
};

/** 信誉分详情页的关联预约（比列表页多要主试与被试） */
export type CreditAppointmentFull = {
  id: string;
  status: string;
  appealStatus: string | null;
  experimentId: string;
  experiment: { title: string; location: string; researcher: { name: string } };  slot: { startAt: Date; endAt: Date };
  subject: { name: string };
};

export interface CreditPageQuery {
  findCreditPageUser(userId: string): Promise<CreditPageUser | null>;

  /** 信誉分流水（倒序，最多 take 条） */
  findCreditEvents(userId: string, take: number): Promise<CreditEventFull[]>;

  /** 按 id 批量取预约（列表页回填实验名与时间） */
  findAppointmentsByIds(ids: string[]): Promise<CreditAppointmentBrief[]>;

  /** 单条信誉流水；**只在该流水属于 userId 时返回**，否则 null（防用 id 猜别人流水） */
  findOwnedCreditEvent(eventId: string, userId: string): Promise<CreditEventFull | null>;

  /** 单条预约的完整信息（详情页） */
  findAppointmentFull(appointmentId: string): Promise<CreditAppointmentFull | null>;

  /** 该用户全部流水的 delta（升序，用于重放算出「变动后分数」） */
  findCreditDeltasAsc(userId: string): Promise<Array<{ id: string; delta: number }>>;
}
