/**
 * 私信端口 —— 领域层对「线程 / 消息」的唯一认知。
 *
 * Phase 4 第三批：取代 src/server/dm.ts 里的 16 处 prisma. 直连。
 *
 * 这里刻意**不暴露** prisma 的任何类型（含 `include` 的嵌套形状），
 * 全部收窄成领域自己的记录类型。能写出一个手写假实现，就证明解耦成立。
 */

/** 对话对方的公开信息（只有这几个字段可以给前端看） */
export type DirectPeer = {
  id: string;
  name: string;
  school: string | null;
  department: string | null;
  studentVerified: boolean;
  creditScore: number;
};

/** 消息列表页用的一行（不是线程详情，别混用） */
export type ThreadSummaryRecord = {
  id: string;
  peer: DirectPeer;
  experimentTitle: string | null;
  lastMessage: { content: string; createdAt: Date; senderId: string } | null;
  unread: number;
  updatedAt: Date;
};

/** 一条消息。`senderId` 留给应用层判「是不是我发的」，不在这里裁掉。 */
export type DirectMessageRecord = {
  id: string;
  threadId: string;
  senderId: string;
  content: string;
  createdAt: Date;
};

export type DirectThreadRecord = {
  id: string;
  subjectId: string;
  researcherId: string;
  experimentId: string | null;
  subject: DirectPeer;
  researcher: DirectPeer;
};

/**
 * 「按归属取线程」的返回。
 *
 * 用一个判别联合而不是 `T | null`，是因为调用方必须分别处理 404 和 403 ——
 * 合成 null 就只能靠调用方自己再查一次「到底是不存在还是无权限」。
 */
export type ThreadAccess =
  | { kind: "ok"; thread: DirectThreadRecord }
  | { kind: "not-found" }
  | { kind: "forbidden" };

export interface DirectMessageRepository {
  /** 只取建线程时判定要用的两个字段，不要整行 User */
  findResearcherForThread(researcherId: string): Promise<{ id: string; role: string } | null>;

  /** 同一个人跟同一个主试只有一条线程，所以按这对键查 */
  findThreadBetween(
    subjectId: string,
    researcherId: string,
  ): Promise<{ id: string; experimentId: string | null } | null>;

  /** 把已有线程的关联实验改掉（被试点的是同一个主试的另一个实验） */
  moveThreadToExperiment(threadId: string, experimentId: string): Promise<void>;

  createThread(input: {
    subjectId: string;
    researcherId: string;
    experimentId: string | null;
  }): Promise<{ id: string }>;

  /**
   * 消息列表页的数据源。
   *
   * 一次要拼四样东西：线程 + 对方 + 最后一条消息 + 未读数 + 实验标题。
   * 这个拼装是**适配层的活**——以前它散在 server/dm.ts 里，
   * 页面拿到的是四个独立查询的中间结果。
   */
  listThreadSummaries(userId: string, role: "SUBJECT" | "RESEARCHER"): Promise<ThreadSummaryRecord[]>;

  /** 取线程并顺带判定当前用户是不是当事人（不存在 / 无权限分开返回） */
  findThreadForParticipant(threadId: string, userId: string): Promise<ThreadAccess>;

  /** 把对方发来的未读消息标记为已读。返回受影响条数。 */
  markPeerMessagesRead(threadId: string, userId: string, at: Date): Promise<number>;

  /** 正序取最近 limit 条消息 */
  listMessages(threadId: string, limit: number): Promise<DirectMessageRecord[]>;

  /**
   * 追加一条消息，同时把线程的 `lastMessageAt` 推到同一刻。
   *
   * 两步必须原子：只建消息不推时间，列表页排序就会把它排到后面去；
   * 只推时间不建消息，列表页最后一条会显示旧的。
   */
  appendMessage(input: {
    threadId: string;
    senderId: string;
    content: string;
    at: Date;
  }): Promise<DirectMessageRecord>;

  /** 侧边栏红点：当前用户所有线程里「别人发的 + 没读过」的条数 */
  countUnreadMessages(userId: string, role: "SUBJECT" | "RESEARCHER"): Promise<number>;
}
