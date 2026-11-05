/**
 * 会话存储端口 —— 领域层对「会话存在哪」的唯一认知。
 *
 * ## 与 AssistantThreadRepository 的关系
 *
 * 老端口按 `subjectId` 唯一（一人一条，永不更换）。新端口按 `id`，
 * 一个被试可以有很多条 session，任意时刻至多一条是「活的」（`endedAt === null`）。
 *
 * ## 归属校验放哪
 *
 * **不放在适配器里。** 适配器只认识「按 id 取」，不认识「这条属于谁」。
 * 归属判断由应用层拿 `subjectId` 去比对 —— 换存储实现时权限不会跟着丢。
 * 端口只提供 `findOwned` 这种「带主人的读」，让调用方没有机会漏判。
 *
 * ## 没有 status 枚举
 *
 * `endedAt === null` 就是活会话。加一个「运行中/已结束」的状态机是重复表达，
 * 而且会让「软结束（可复活）」没法只用一个字段表达。
 */
import type { SessionMessage } from "@/domain/session-messages";

/**
 * 会话结束原因。
 *
 * 注意这里**没有 BOOKED**：门厅可以连约多场，约成不是它的终结条件（那是房间的事）。
 * 留着 BOOKED 会诱导后人写出「约成即结束门厅」的错误逻辑。
 */
export type SessionEndReason =
  | "USER_DONE" // 用户明说够了
  | "IDLE" // 空闲超时（兜底扫描判定）
  | "BLOCKED" // 资格/封禁挡住，聊也解决不了
  | "NO_RESULT" // 反复搜索都空集且用户放弃调条件
  | "MAX_TURNS" // 聊满轮数上限（结转后标这个）
  | "SUPERSEDED" // 被新会话取代（结转、手动重开）
  | "MANUAL"; // 用户主动结束

/** 一条 session 的完整形状（含审计字段） */
export type AssistantSessionRecord = {
  id: string;
  subjectId: string;
  messages: SessionMessage[];
  /** 第 2 层压缩产物：结构化条件 + 梗概。null = 还没压过 */
  summary: string | null;
  /** 压缩前的消息条数，审计用（压缩后 messages 会变短，这个数不减） */
  messageCount: number;
  outcome: SessionEndReason | null;
  /** 产生的业务结果 id（appointmentId 等），用来追溯 */
  outcomeRef: string | null;
  endedAt: Date | null;
  /**
   * 软结束时间（null = 没被软结束）。
   *
   * 单开一列而不是塞进 outcome：`outcome` 记的是「为什么结束」，而「现在能不能
   * 直接续接」是查询里最常用的条件 —— 让它变成一个能进 where 的时间字段，
   * 比每次解析字符串判等可靠。
   */
  sealedAt: Date | null;
  createdAt: Date;
  lastActiveAt: Date;
};

/** 一次写入的补丁（消息与摘要一起落，避免两次写出现半截状态） */
export type SessionSaveInput = {
  messages: SessionMessage[];
  summary: string | null;
  /**
   * 压缩前的原始条数。只在发生压缩时由调用方给出（审计用）；
   * 不给则不动这一列 —— 压缩后 `messages` 会变短，用它的长度当历史长度是错的。
   */
  messageCount?: number;
};

export interface SessionStore {
  /** 开一条新会话。调用方负责在此之前把旧会话结掉 */
  create(subjectId: string): Promise<AssistantSessionRecord>;

  /**
   * 按 id 取，且必须属于 `subjectId`。
   * 不存在与不属于**都返回 null** —— 不让调用方有机会区分，避免 id 被探测。
   */
  findOwned(id: string, subjectId: string): Promise<AssistantSessionRecord | null>;

  /**
   * 该用户最近一条活会话（`endedAt IS NULL` 且 `lastActiveAt >= idleCutoff`）。
   * 供「没带 sessionId 但还在合理时间内」的场景续接。
   */
  findActiveBySubject(subjectId: string, idleCutoff: Date): Promise<AssistantSessionRecord | null>;

  /** 覆盖写消息 + 摘要，并把 lastActiveAt 推到 now */
  save(id: string, input: SessionSaveInput): Promise<AssistantSessionRecord>;

  /** 封账。写 outcome / outcomeRef / endedAt */
  finalize(
    id: string,
    outcome: SessionEndReason,
    outcomeRef?: string | null,
  ): Promise<AssistantSessionRecord>;

  /** 软结束：不结束、不清消息，只是标记「下次说话要显式复活」 */
  seal(id: string): Promise<AssistantSessionRecord>;

  /** 复活软结束的会话 */
  resume(id: string): Promise<AssistantSessionRecord>;

  /**
   * 兜底扫描：把 `lastActiveAt < cutoff` 的活会话标成 IDLE，返回处理条数。
   * 这是运维兜底（处理关浏览器没走正常收尾的情况），不是业务判据。
   */
  closeIdleBefore(cutoff: Date): Promise<number>;
}
