# DECISIONS

> 规格书没定义、或与本机环境冲突的地方，在这里记一行决定和理由，然后继续往下做。

## 技术栈与环境

1. **技术栈降级：Next.js 单体 + Prisma + SQLite（本地），而不是 monorepo（NestJS + PostgreSQL + Redis + BullMQ）**
   原因：本机没有 Docker、没有 WSL（且被系统策略禁用），也没有本地 PostgreSQL / Redis，`docker-compose up` 无路可走。落地目标是"一条命令能起来 + 将来搬到服务器"。
   保留的是规格书真正在考核的部分：服务端分层（route → service → prisma）、事务内防超卖、状态机、信誉分引擎、Agent 工具调用。
   放弃的是框架形态，不是服务端校验——所有校验都真写在服务端。

2. **枚举用 String 存储**
   SQLite 不支持 Prisma enum。`src/lib/domain.ts` 是唯一事实源（`as const` 对象 + 类型），写入前一律过 Zod。字段名与规格书完全一致。

3. **`ChatSession.messages` 存 JSON 字符串**
   SQLite 不支持 Prisma `Json`。读写统一走 `parseMessages` / `stringifyMessages`。

4. **BullMQ → 进程内定时器**
   `src/server/scheduler.ts` 由 `instrumentation.ts` 启动，每 10 分钟 / 1 小时跑三类任务。任务体（清禁期、主试提醒、申诉自动成立）与队列实现无关，迁移到 BullMQ 时只需换调度壳。

5. **迁移到 PostgreSQL**
   改 `prisma/schema.prisma` 的 `provider = "postgresql"`、改 `DATABASE_URL`，然后 `npx prisma db push`。字段名、索引、唯一约束全部通用；防超卖用的 `UPDATE ... WHERE booked_count < capacity` 在 PG 上语义相同。

## 产品

6. **筛选项去掉了"学科"**
   数据模型里没有学科字段，硬加等于改表。当前提供：只看可报名 / 今天 / 明天 / 时长三档 / 酬劳类型（现金 or 学分）。需要学科时再给 `Experiment` 加 `field` 字段。

7. **主试端"消息"Tab 改为"申诉"**
   本期不做通知系统，主试没有消息可看；把第 3 个 Tab 让给真正有内容的 `/r/appeals`。

8. **签到改为「一键签到」，不再有 4 位签到码**
   原方案要求被试输主试展示的 4 位码，现场多一步、还容易输错锁死。改为：被试在「我的预约」点
   「到场签到」→ CHECKED_IN → 主试点「确认到场」→ COMPLETED。
   防误点只靠时间窗（开始前 30 分钟 ~ 结束）。`checkinCode` / `checkinAttempts` /
   `checkinLockedUntil` 三个字段和「错 3 次锁 10 分钟」的逻辑一并删除。

9. **被试"距开始不足 12 小时"不能取消**
   规格书只写了"12h 免费取消"。不足 12 小时时直接拒绝（提示到场签到），而不是允许取消再扣分——这与"未到场"的判定不冲突，也避免了被试在最后时刻把名额占死。

10. **信誉分到 100 时不再写 CreditEvent**
    没有分值变动就不该有流水，否则明细里会出现一堆 `+0`。

11. **禁期只延长不缩短**
    已处于更长禁期时又违规，保留更晚的那个解禁时间，避免第二次违规反而提前解禁。

12. **`bannedUntil` 到期后只清空禁期，`noShowCount` 永久保留**
    与规格书一致：累计次数不清零，第 4 次起每次都按 7 天算。

13. **编辑实验只做「改信息 + 上下架 + 追加时段」，不做删除时段**
    已有时段一旦有人订过，删掉会让预约凭空消失（还牵连 `bookedCount` 与信誉分）。
    追加走 `POST /experiments/:id/slots/batch`，重复开始时间会被跳过。
    重新发布时会二次校验：禁发布期内 403、没有未来时段 400。

14. **教育邮箱验证码在开发环境接受 `123456`**
    与手机验证码同一套便利策略，避免演示时卡在收信环节。真实码同时打印到控制台与 `mock-email.log`。

## 交互

15. **排期候选点击即预约（走 `/api/appointments`）**
    Agent 给出候选后，被试点「就这个」直接调服务端锁定时段，不再多绕一轮 LLM。理由：演示时最怕模型"理解了但没调工具"。这条路径与 `book_slot` 共用同一个 `bookSlot()` 服务函数，校验完全一致。

16. **降级表单允许多选，逐个尝试锁定**
    勾选多个时段后依次尝试，遇到被抢光就跳到下一个，最后报成功或最后一个错误。

17. **数字统一 `tabular-nums`**
    倒计时、信誉分、剩余名额、编号都是会变的数字，等宽数字避免跳动。

18. **构建前预加载 readlink 补丁，并用 Turbopack**    本机 E: 盘对普通文件的 `fs.readlink` 返回 `EISDIR`（正常 Windows 应为 `EINVAL`），
    webpack 与 Next 的依赖快照把它当致命错误，`next build` 直接崩。`scripts/readlink-patch.cjs`
    只把错误码改写成 `EINVAL`，`scripts/next-run.mjs` 用 `-r` 预加载它再交给 next CLI。
    dev/build/start 都走这个包装器，放到正常文件系统的服务器上也不会出问题（补丁是幂等的）。
    构建用 Turbopack：同样是完整构建，在 E: 盘上 24 秒 vs webpack 9 分钟。

19. **时段一律按半小时切**
    被试看的是「14:00–14:30、14:30–15:00」这样的整点半点块，不是 14:00–14:40 这种歪的。
    做法：种子数据全部 30 分钟对齐；批量生成器的「每段分钟」默认取实验时长**向上取整到 30 的倍数**
    （30 分钟实验 → 30，40 分钟 → 60），既保证时段装得下实验，又保证格子都落在整点/半点。
    发布页默认时长也从 40 调成 30。

20. **顶部栏统一：左上角返回、右上角个人中心**
    所有页面共用 `PageHeader`：`back` 支持传路径或 `"auto"`（走浏览器历史，Tab 页用这个，避免
    "返回"永远跳回首页）；`profile` 传角色就渲染右上角头像入口（被试 → /me，主试 → /r/profile）。
    个人中心页自己不显示这个入口。首页原本没有顶栏（只有搜索框），补了一行「返回 + 找实验 + 头像」。
