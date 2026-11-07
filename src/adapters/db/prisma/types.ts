/**
 * Prisma 客户端的最小形状。
 *
 * 不直接 import PrismaClient 的具体类型，是为了让 slot-repo / appointment-repo
 * 既能接真 prisma，也能接事务里的 tx —— 两者形状一致但类型不同。
 * 这个文件是 adapters 层内部的东西，领域层看不到它。
 */

type RawExecutor = {
  $executeRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<number>;
};

export type SlotDelegate = {
  findUnique(args: unknown): Promise<unknown>;
  findMany(args: unknown): Promise<unknown[]>;
  updateMany(args: unknown): Promise<unknown>;
};

export type AppointmentDelegate = {
  findUnique(args: unknown): Promise<unknown>;
  findMany(args: unknown): Promise<unknown[]>;
  create(args: unknown): Promise<unknown>;
  update(args: unknown): Promise<unknown>;
};

export type ChatSessionDelegate = {
  findUnique(args: unknown): Promise<unknown>;
  findMany(args: unknown): Promise<unknown[]>;
  create(args: unknown): Promise<unknown>;
  update(args: unknown): Promise<unknown>;
};

export type ExperimentDelegate = {
  findUnique(args: unknown): Promise<unknown>;
  count(args: unknown): Promise<number>;
};

/** 私信列表页要按 id 批量取实验标题 */
export type ExperimentListDelegate = {
  findMany(args: unknown): Promise<unknown[]>;
};

export type CreditEventDelegate = {
  findMany(args: unknown): Promise<unknown[]>;
  findUnique(args: unknown): Promise<unknown>;
  count(args: unknown): Promise<number>;
};

export type GroupByCapableAppointmentDelegate = AppointmentDelegate & {
  findFirst(args: unknown): Promise<unknown>;
  groupBy(args: unknown): Promise<unknown[]>;
  count(args: unknown): Promise<number>;
};

export type UserDelegate = {
  findUnique(args: unknown): Promise<unknown>;
};

/** 只读查询端口（SchedulingQueryPort）用到的客户端形状 */
export type QueryClientLike = {
  experiment: ExperimentDelegate;
  user: UserDelegate;
  slot: SlotDelegate;
  appointment: AppointmentDelegate;
};

/** 被试「待填问卷」查询用到的客户端形状（`page-query-subject-todo.ts`） */
export type QuestionnaireDelegate = {
  findMany(args: unknown): Promise<unknown[]>;
};

export type QuestionnaireResponseDelegate = {
  findMany(args: unknown): Promise<unknown[]>;
};

export type SubjectTodoClientLike = {
  questionnaire: QuestionnaireDelegate;
  questionnaireResponse: QuestionnaireResponseDelegate;
};

export type PageQueryClientLike = {
  user: UserDelegate;
  creditEvent: CreditEventDelegate;
  appointment: GroupByCapableAppointmentDelegate;
  chatSession: ChatSessionDelegate;
  experiment: ExperimentDelegate;
};

export type PrismaClientLike = RawExecutor & QueryClientLike & {
  chatSession: ChatSessionDelegate;
};

/* ---------------- 私信（DirectMessageRepository）用到的形状 ---------------- */

export type DirectThreadDelegate = {
  findUnique(args: unknown): Promise<unknown>;
  findMany(args: unknown): Promise<unknown[]>;
  create(args: unknown): Promise<unknown>;
  update(args: unknown): Promise<unknown>;
};

export type DirectMessageDelegate = {
  findMany(args: unknown): Promise<unknown[]>;
  create(args: unknown): Promise<unknown>;
  updateMany(args: unknown): Promise<number>;
  count(args: unknown): Promise<number>;
  groupBy(args: unknown): Promise<unknown[]>;
};

export type MessagingClientLike = {
  user: UserDelegate;
  experiment: ExperimentDelegate & ExperimentListDelegate;
  directThread: DirectThreadDelegate;
  directMessage: DirectMessageDelegate;
  /** appendMessage 要在一个事务里建消息 + 推时间 */
  $transaction(fn: (tx: unknown) => Promise<unknown>): Promise<unknown>;
};
