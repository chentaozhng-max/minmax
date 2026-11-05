/**
 * 助手页只读查询 —— 领域层端口。
 *
 * 与 queries.ts（对话上下文）的区别：那个是「为了一门实验排期」，
 * 这个是「跨全部实验看我自己有什么安排」。助手页没有 experimentId，所以不能复用
 * `findExperimentDetail(experimentId)` 那套入口。
 *
 * ⚠️ 这一步刻意只提供「查」的方法，没有任何写入。
 * 助手的「约」在第 4 步走对话框里的可点组件，那条链路复用现有的 POST /api/appointments，
 * 这里不提前开一条并行的下单路径 —— 两条路径迟早会不一致。
 */

/** 助手眼里的一条安排 */
export type AssistantAppointment = {
  id: string;
  status: string;
  experimentId: string;
  experimentTitle: string;
  location: string;
  researcherName: string;
  startAt: Date;
  endAt: Date;
};

/** 助手眼里一条「已经做过」的实验 */
export type PastExperiment = {
  appointmentId: string;
  experimentId: string;
  experimentTitle: string;
  /** 完成时间（slot.endAt）。用来判断「多久以前做的」 */
  finishedAt: Date;
  status: string;
};

export interface AssistantQuery {  /**
   * 我在 `from` 之后还有效的预约，按开始时间升序。
   *
   * 传入 `statuses` 而不是在适配器里写死，是因为「什么算占用时间」是领域规则
   * （见 domain/constants.ts 的 ACTIVE_APPOINTMENT_STATUSES），不属于数据访问细节。
   */
  listMyUpcomingAppointments(
    subjectId: string,
    from: Date,
    statuses: string[],
  ): Promise<AssistantAppointment[]>;

  /**
   * 我在 `before` 之前做过的实验（"做完了"这一类），按时间**倒序**。
   *
   * 为什么会话要它：门厅的 session 每次打开都是新的，模型不能再靠「前面聊过」
   * 知道这个人参加过什么。这两件事（做过 / 正在做）必须每轮现查，不能快照进会话 ——
   * 一旦快照，连续约三场之后第一场的状态就过期了，而模型会当真。
   *
   * 只返回「已经发生过」的：未开始的归 `listMyUpcomingAppointments`，两个方法
   * 按时间轴切开，不该有重叠，也不该有一个方法兼两用（那会让调用方自己判时间）。
   */
  listMyPastExperiments(
    subjectId: string,
    before: Date,
    statuses: string[],
  ): Promise<PastExperiment[]>;
}
