/**
 * 实验日程查询 —— 领域层端口。
 *
 * 这是「总表 / 分表」语义的唯一出处：
 *   `listSchedule()`          不传参数 = 总表（主试名下所有实验的所有时段）
 *   `listSchedule(id)`        传实验 id = 分表
 *
 * ⭐ 为什么以 Slot 为基表做 LEFT JOIN：
 * 发布实验时 Slot 就建好了，Appointment 才是有人才有。
 * 若以 Appointment 为基表，「还没人报名的时段」根本查不出来 ——
 * 主试看到的是一张空表，以为发布失败了。以 Slot 起，0 人报名也有完整行骨架。
 *
 * 这就是「函数制表」的落点：**制表 = 生成行骨架，不是生成数据**。
 */

export type ScheduleSubject = {
  id: string;
  name: string;
  phone: string;
  school: string | null;
  studentId: string | null;
  creditScore: number;
  studentVerified: boolean;
};

/**
 * 日程表的一行 = 一个「时段 × 被试」。
 *
 * 时段没人报名时照样有一行，只是 `appointmentId` 为 null —— 前端据此渲染空位。
 * 这个形状直接对应导出的 CSV 每一行，所以两处消费者看到的完全一致。
 */
export type ScheduleRow = {
  experimentId: string;
  experimentTitle: string;
  slotId: string;
  startAt: Date;
  endAt: Date;
  capacity: number;
  bookedCount: number;
  /** 团体实验的每组人数；一对一为 null */
  groupSize: number | null;
  appointmentId: string | null;
  appointmentStatus: string | null;
  checkedInAt: Date | null;
  appealStatus: string | null;
  subject: ScheduleSubject | null;
};

export interface ScheduleFilter {
  /** 传了 = 分表（只看这一个实验）；不传 = 总表 */
  experimentId?: string;
  /**
   * 限定只看某个主试名下的实验。
   *
   * ⚠️ 这个字段不是可选的优化项，是**安全边界**：
   * 总表若不带它，任何一个主试都能导出全站被试的手机号与学号。
   * 导出路由必须始终传 `researcherId = 当前登录用户`。
   */
  researcherId?: string;
}

export interface ScheduleQuery {
  listSchedule(filter?: ScheduleFilter): Promise<ScheduleRow[]>;
}
