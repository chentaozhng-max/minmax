/**
 * 发布助手工具上下文。
 *
 * 门厅（AssistantContext）有被试、房间（AgentContext）有实验；
 * 发布助手还没有实验 —— 它要**生成**实验。所以这里只有两样东西：
 * 当前时间和「明天」这个起算日，用来把「周三下午」摊成具体时段。
 *
 * 和另外两个上下文一样，刻意不复用数据库模型：工具层不该知道 Prisma 的存在。
 */
export type DraftContext = {
  now: Date;
  /** 上海时区的明天，YYYY-MM-DD；时段生成从这里起算 */
  anchorDate: string;
};
