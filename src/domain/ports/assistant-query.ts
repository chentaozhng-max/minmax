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

export interface AssistantQuery {
  /**
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
}
