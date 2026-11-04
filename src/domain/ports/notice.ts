/**
 * 「给某个被试发一条消息」的端口。
 *
 * 为什么单独开一个，而不是往 NotificationRepository 里加方法：
 * 那个端口的语义是「定时提醒」，只有 (appointmentId, level) 这一种幂等方式。
 * 主试主动发起的邀请没有预约、没有档位，硬塞进去会让两件事的约束互相污染。
 *
 * 实现方负责同时写两处：站内通知（红点）与私信（能回复的对话）。
 * 只写通知的话，被试点进去没有上下文；只写私信的话，首页红点不亮。
 */

export type NoticeInput = {
  /** 收件人（被试） */
  userId: string;
  /** 发件人（主试），私信线程需要 */
  senderId: string;
  experimentId: string;
  /** 通知类型：INVITE = 通过筛选可预约；REJECT = 未通过 */
  kind: "INVITE" | "REJECT" | "QUESTIONNAIRE";
  content: string;
  at: Date;
};

export interface NoticePort {
  /** 发一条站内消息。失败不抛异常，返回 false 让调用方统计 */
  send(input: NoticeInput): Promise<boolean>;
}
