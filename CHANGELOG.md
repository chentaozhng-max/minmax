# 更新日志

> **给 AI 的读法（先读这 5 行）**
>
> 这份日志的重点不是「迭代故事」，而是**接手时需要改写哪些既有认知**。
> 如果你是从旧代码、旧 commit 或旧对话里接手的：先看 **v1.3 §1.1 路径映射** 和 **§4 作废清单**，
> 再看 [AGENTS.md](./AGENTS.md)（怎么跑、改哪里）和 [ARCHITECTURE.md](./ARCHITECTURE.md)（为什么这样分层）。
>
> ⚠️ 最容易踩的一条：**`src/server/xxx.ts` 不一定还是业务逻辑所在地**。
> 改名后有一批文件变成了「转发壳」，只保留旧 import 路径。判断一个文件是真是假，
> 看它有没有 `export * from "@/domain/..."` 这类转发语句。

版本号规则：`v1.0` → `v1.1` → `v1.2` → `v1.3`。
对外可见的更新加一个小版本（新增功能、改交互、修用户能感知的 bug）；
数据库结构大改或推翻重做时才升大版本（`v2.0`）。

---

## v1.3 — 2026-11-04

**一句话**：内部从「按有没有副作用切」重构成「领域 / 应用 / 适配」四层，
同时新增跨实验 Agent（门厅）、站内通知与到时提醒、主试日程表三块能力。
**报名 → 确认 → 签到 → 结算这条主流程的行为没有变**，数据库只加表、不删不改既有字段。

### 0. AI 接手先确认这三条

1. **业务规则在 `src/domain/`，不在 `src/lib/`。**
   `src/lib/{domain,credit,matching,reward}.ts` 现在是**转发壳**（`export * from`）。
   新代码请直接 `import from "@/domain/..."`；改规则改 `src/domain/` 里的真身。
2. **用例在 `src/application/`，只有 6 个文件，故意很薄。**
   很多业务还留在 `src/server/`（2084 行），那里的 `prisma.` 是**已知欠账**（68 处，棘轮只许变少）。
   不要因为「看到 server 里有业务」就认为分层没做——它是「还没搬完」，不是「没搬」。
3. **加新的跨层依赖，必须先写端口。**
   顺序是 `src/domain/ports/` 接口 → `src/adapters/` 实现 → `application/` 或 `server/` 接线。
   反过来写会在用例里 `new PrismaClient()`，被 `npm run lint:layers` 的 L1/L3 拦下。

### 1. 架构重构（不改变产品行为）

| 层 | 目录 | 规模（实测） | 一句话职责 |
|---|---|---|---|
| 领域层 | `src/domain/` | 2905 行 / 23 文件（含 11 个端口文件） | 规则、状态机、纯函数、端口定义，**零外部依赖** |
| 应用层 | `src/application/` | 774 行 / 6 个用例 | 编排领域函数 + 调端口，不写业务判断 |
| 适配层 | `src/adapters/` | 2443 行 / 22 文件 | Prisma、LLM、fetch——唯一碰外部世界的地方 |
| 工具层 | `src/tools/` | 753 行 / 15 文件 | Agent 工具，两个注册表，不直连数据库 |
| 组装层 | `src/server/` | 2084 行 / 11 文件 | 注入依赖实例；还没搬完的业务暂住 |
| 页面层 | `src/app/` | 7625 行 / 84 文件 / 26 页面 / 34 路由 | 鉴权 + 校验 + 转发，handler ≤ 40 行 |

**端口 11 个文件 / 12 组接口**（都在 `src/domain/ports/`）：
`LlmPort`、`SlotRepository`、`AppointmentRepository`、`ChatSessionRepository`、`TransactionPort`、
`ExperimentPublishRepository`、`SchedulingQueryPort`、`PageQueryPort`、`ScheduleQuery`、
`AssistantQuery`、`AssistantThreadRepository`、`ExperimentSearchPort`、
`DirectMessageRepository`、`NotificationRepository`。

> 换数据库 / 换 LLM / 换通知渠道，只加一个适配实现，领域层一个字不改。
> 这是本次重构唯一真正的验收标准，不是「目录变好看了」。

**护栏 L1–L7**（`scripts/check-layers.mjs`，`npm test` 的 `pretest` 自动跑）：

| 规则 | 内容 | 性质 |
|---|---|---|
| L1 | `domain/` 禁止 import 外部世界（prisma / next / axios / openai / adapters / lib / app / server / tools / components） | 硬性 |
| L2 | `domain/` 只允许 `zod` / `@/domain/*` / `node:*` / 相对路径 | 硬性 |
| L3 | `application/` 禁止 import 适配器实现（只能 `import type` 端口） | 硬性 |
| L4 | `application/` 禁止 import `next` | 硬性 |
| L5 | route handler ≤ 40 行 | 软性（基线棘轮） |
| L6 | `prisma.` / `$executeRaw` / `$queryRaw` / `cookies()` / `fetch(` 只能在 `src/adapters/**` | 软性（基线棘轮） |
| L7 | `tools/` 禁止直连数据库 | 硬性 |

L5 / L6 用**棘轮**：存量记在 `.layer-baseline.json`（当前 68 处），只报新增。
搬走一批就 `node scripts/check-layers.mjs --baseline` 把基线调小，**只许变小**。
这样「没搬完」不会让检查永远变红，但也别想悄悄变脏。

#### 1.1 路径迁移映射（找代码时按这张表）

| v1.2 的位置 | v1.3 的真实位置 | 备注 |
|---|---|---|
| `src/lib/domain.ts` | `src/domain/constants.ts`（枚举/标签）+ `src/domain/schemas.ts`（Zod） | 一个文件拆成两个；旧路径仍是转发壳 |
| `src/lib/credit.ts` | `src/domain/credit.ts` | 信誉分规则真身 |
| `src/lib/matching.ts` | `src/domain/matching.ts` | `rankSlots` + 中文模糊时间 |
| `src/lib/reward.ts` | `src/domain/reward.ts` | 金额口径 |
| `src/server/llm.ts` | `src/adapters/llm/openai-compatible.ts` / `mock.ts` / `index.ts` | `getLlm()` 按环境变量选实现；`server/llm.ts` 成了转发壳 |
| `src/server/agent.ts` 里的工具定义 | `src/tools/*.ts` | 一文件一工具；`server/agent.ts` 只做循环与注入 |
| — | `src/tools/assistant-context.ts` + `registry.ts` | **门厅**独立注册表（门厅没有「当前实验」） |
| `src/server/appointments.ts` 的锁位逻辑 | `src/application/book-slot.ts` | 防超卖 SQL 在 `adapters/db/prisma/unit-of-work` 的事务里 |
| `src/server/experiments.ts` 的页面读 | `src/adapters/db/prisma/page-query*.ts` | 端口 `PageQueryPort`；`server/experiments.ts` 还在做筛选编排 |
| — | `src/application/send-reminders.ts` + `domain/reminder-levels.ts` | 到时提醒：规则纯函数、写库在用例 |
| — | `src/application/search-experiments.ts` + `domain/search-criteria.ts` | 门厅搜索：条件归一 + 资格过滤 + 排序 |
| `DECISIONS.md`（v1.2 有 33 条） | [ARCHITECTURE.md](./ARCHITECTURE.md) §5 + [AGENTS.md](./AGENTS.md) §9 附录 A | **文件已删除**；编号仍是原编号，附录 A 有「想改 X 先知道什么」索引 |

**判断一个文件是「真身」还是「转发壳」**：

```bash
head -5 src/lib/credit.ts
# 真身：有具体函数实现
# 转发壳：export * from "@/domain/credit";
```

### 2. 新增能力（用户能看到的）

#### 2.1 门厅 Agent：跨实验找实验（`/assistant/chat`）

- 输入「周三下午有空，别太久，奖励高一点的」→ 拆成条件（周三 / 下午 / ≤60 分钟 / 按奖励排）
  → 从**全部实验**里筛出候选卡片。
- **被筛掉的要说清为什么**（「门槛要求信誉 80，你当前 72」），不能静默过滤。
- 门厅**只给列表，不下单**：点卡片跳回 `/experiments/[id]/chat` 完成预约。
  这是刻意的——「多实体时间网格」的推理模型必错。
- 提醒位 `/assistant`（只读总览：我的安排 + 撞车）。
- 数据：新增 `AssistantThread` 表（门厅会话持久化，独立于 `ChatSession`）。
  不加 nullable 到 `ChatSession.experimentId`——那会让「一 session 一实验」的老语义变糊。

#### 2.2 站内通知 + 到时提醒（`/me/notifications`）

- 新增 `Notification` 表；底部 tab 红点 + 页面开着时轮询 toast（30 秒一次，`setTimeout` 递归不堆积）。
- 提醒三档：**提前 3 小时 / 1 小时 / 10 分钟**，规则在 `src/domain/reminder-levels.ts`（纯时间判断）。
- **不建闹钟表**：提醒时刻 = `Slot.startAt - aheadMs`，算得出来就用 1 分钟扫描 + 唯一键幂等。
- 调度粒度：提醒 **1 分钟**（最小窗口 10 分钟，10 倍余量）；其余 4 个重 job **10 分钟**；兜底 1 小时。
  > 别把提醒改成 10 分钟一次——窗口和间隔相等 = 零余量，一次事件循环卡顿就永久漏发。

#### 2.3 主试日程表（`/r/schedule`）

- 总表（全部实验）/ 分表（单实验），CSV 导出。
- CSV 规范：UTF-8 **BOM** + **CRLF** + RFC4180 转义（Excel 双击不乱码、逗号不串列）。
  实现在 `src/application/export-schedule.ts`（纯函数，有单测）。
- **不建物理表、不建 DB VIEW**：`Slot` 是行骨架、`Appointment` 是填入的人，
  读取用适配器方法 `listSchedule(experimentId?)`（省略=总表，传 id=分表）。

#### 2.4 发布助手：一句话写成招募信息（`/r/experiments/assistant`）

- 主试描述「想招 30 个人做面孔吸引力实验，每人半小时，给 30 块，下周一到周三下午」
  → Agent 产出完整草稿（标题 / 简介 / 时长 / 奖励 / 门槛 / 时段计划 / 报名截止）。
- 工具 `write_experiment_draft` **只收 `slotPlan`（星期 + 起止 + 周数），不收具体日期**。
  具体日期由领域层算，模型不能自己编日期。
- 禁期内进来直接是拦截页（`PublishBlocked`），不让人白聊一轮。
- 草稿通过 `sessionStorage`（`psymatch:publish-draft`，读后即删）交给 `/r/experiments/new`，
  不经过 URL（长文本 + 中文会超长并破坏分享）。

#### 2.5 排期界面：课程表 + 发布前预检

- 时段排布从「一堆日期输入」改成**课程表**：7 列星期 × 半小时行，支持 00:00–24:00 全时段
  （`src/components/slot-timetable.tsx`）。格子 36px，只读态图例改「已开时段 / 已约满」。
- **禁发警告提前到点按钮之前**：第 3 步 `PreflightPanel` 直接列出问题并给「一键改好」，
  不再「点了发布才弹 toast」。
- 已开始的时段在发布时被 `prunePastSlots()` 丢弃；报名截止时间由 `suggestSignupDeadline()`
  推算（最早未开始时段前 2 小时，不足则 now+10 分钟）。
  > 这修的是 v1.2 的「一键补完还是发不出去」死锁：截止时间取自已经过去的时段，永远非法。

#### 2.6 主试时段视图：谁约了一眼看见（实验详情 → 时段 tab）

- 换成 `src/components/slot-schedule.tsx`：**分钟级绝对定位**（45 分钟的段也能画准），
  三态——空位白底虚线 / 有人浅红 + 姓名 / 约满实心红 + 白字；团体显示 `2/3`。
- 点格子弹 Modal：姓名 / 认证 / 学校 / 信誉 / 未到次数 + 操作按钮。
- 时间轴自适应：贴实际时段前后各留半小时，最少 3 小时（纯函数 `spanOf()`，5 个边界有单测）。

### 3. 工程与性能

- **测试规模**：54 个文件 / 591 用例（v1.2 是 47 项）；数据库级验收 **62 项**（v1.2 是 22 项）。
- 新增脚本：
  `scripts/check-layers.mjs`（L1–L7 护栏）、`scripts/vitest-run.mjs`（绕开本机 Temp EPERM）、
  `scripts/shoot-publish.mjs`（发布链路 14 张截图）、`scripts/shoot-schedule.mjs`（时段视图 7 张）、
  `scripts/check-stale-draft.mjs`（过期草稿回填断言）、`scripts/check-nav-perf.mjs`（导航 7 项断言）。
- **导航性能三件套**（修「切 tab 卡住很久」）：
  1. `next.config.ts` 的 `experimental.staleTimes = { dynamic: 30, static: 180 }`
     —— 30 秒内回访 tab **0 个 `_rsc` 请求**，切换 11ms；
  2. `page-skeleton.tsx` + `me/loading.tsx` + `r/profile/loading.tsx` 出骨架
     （骨架**必须包含 TabBar**：导航栏是每页自渲染，不在 layout）；
  3. `tab-bar.tsx` 的 `pendingHref`：点击瞬间目标 tab 染 moss 色 + 呼吸条 + `aria-busy`，8 秒兜底。
- `/me` 与 `/r/profile` 的串行 `await` 改成 `Promise.all`。
- `next.config.ts` 加 `outputFileTracingRoot: process.cwd()`：防止上层目录的 lockfile
  把工作区根推断错，导致构建变慢、产物变大。

### 4. 作废的旧认知（别再按它们改）

| 旧认知 | 现在的事实 |
|---|---|
| 「`src/lib/domain.ts` 是枚举与 Zod 的唯一事实源」 | 在 `src/domain/constants.ts` + `src/domain/schemas.ts` |
| 「`src/server/` 里是业务逻辑」 | 业务在 `src/domain/`；`server/` 是组装层 + 未搬完的欠账 |
| 「`src/server/appointments.ts` 是预约的唯一入口」 | 锁位在 `src/application/book-slot.ts`，状态机与取消结算仍在 `server/appointments.ts` |
| 「改规则要改 SQL」 | 改 `src/domain/` 纯函数 + 补单测；SQL 只在 `adapters/db/prisma` |
| 「`DECISIONS.md` 按编号追加」 | **该文件已删除**，决策并入 ARCHITECTURE §5 与 AGENTS 附录 A（编号沿用原编号） |
| 「通知系统是明确不做的」 | 已做：站内红点 + 轮询 toast + 1 分钟扫描提醒 |
| 「签到要输 4 位码」 | 一键签到（开始前 30 分钟 ~ 结束），v1.2 起就没有码 |
| 「奖励用学分」 | 全站只有金额，`rewardText` 只允许 `^¥\d{1,4}$` |

### 5. 验收基线（跑完该看到什么）

```bash
npx tsc --noEmit          # 零输出
npm test                  # 先跑 pretest(lint:layers)，再 54 个文件 / 591 用例全绿
npm run accept            # 62 passed / 0 failed
npm run lint:layers       # ✅ check-layers: 197 个文件通过（L1–L7）
```

**看到「没报错」不算过，要看到这三个数**：`591 tests passed` / `62 passed / 0 failed` /
`197 个文件通过`。数字对不上说明少跑了文件（本机 Temp 偶发 EPERM，用 `scripts/vitest-run.mjs`）。

### 6. 升级与部署注意

- **必须 `prisma db push`**：v1.3 新增 `Notification`、`AssistantThread` 两张表。
  旧库直接跑新代码会在通知/门厅处 500（表不存在）。
- 无破坏性变更：没有重命名字段、没有删除表、没有改枚举取值。
- 新增环境变量：无。`LLM_API_KEY` 留空时门厅降级成「直接搜一次给列表」，房间降级成时段多选表单。
- 反代部署必须传 `x-forwarded-proto`，否则 `Secure` Cookie 被浏览器丢弃（表现为「登录成功又跳回登录页」）。

### 已知未做（本次也没有做）

- 管理员后台（`/admin` 自然 404）
- 真实 SMTP 投递（现在 mock：验证码打到控制台 + `mock-email.log`）
- 删除已有时段（故意不做，删了 `bookedCount` 和预约会凭空消失）
- 学科筛选（数据模型没有 `field` 字段）
- 多实例调度（`scheduler.ts` 是进程内定时器）
- L6 欠账 68 处（`server/appointments.ts` 14、`api/auth/login` 8、`server/scheduler.ts` 8 等）
- 应用层偏薄（774 行 / 6 个用例，不少 `server/` 里的业务还没沉到 `domain/`）

---

## v1.2 — 2026-10-28

修「从 GitHub 下载压缩包解压后，双击启动程序提示启动失败」。

### 修复

- **根因**：`.env` 在 `.gitignore` 里，下载的包里没有它。Prisma 读不到 `DATABASE_URL`
  直接报 `P1012 Environment variable not found: DATABASE_URL`，建库那一步失败，
  整个启动跟着挂。
- 新增 `scripts/ensure-env.mjs`：没有 `.env` 就按 `.env.example` 复制一份
  （本地 SQLite 默认配置，开箱能跑）。已接进 `setup` / `dev` / `start` / `build` /
  `db:push` / `db:seed` / `db:reset` 所有入口。
- 启动脚本从 6 步改成 7 步，第 `[4/7]` 步专门补 `.env`，并提示 JWT 示例值只够本机试玩。
- `.env.example` 顶部加了说明；README 补了「不用手动建 .env」和对应的故障行。

### 验证

拿一个干净的 clone（无 `.env` / `node_modules` / `.next` / `prisma/dev.db`）走完整启动：
`npm install` 约 3 分钟 → 自动生成 `.env` → 建库灌种子 → 构建 → 起服务，登录页 HTTP 200。

---

## v1.1 — 2026-10-28

修「双击 `启动 PsyMatch.cmd` 跑不起来」。四个原因叠在一起，都改了。

### 修复

- **窗口停在英文的 `Kill it and continue? [Y/N]`**：上次的服务器还占着 3000 端口，脚本在等按键。
  现在直接结束旧进程继续，不再要交互。
- **浏览器打开是「无法访问此网站」**：原来固定等 5 秒就开浏览器，`next start` 冷启动经常还没就绪。
  改成轮询端口（最多 150 秒），能响应了才开。
- **主窗口闪一下就没**：原来另开一个 `PsyMatch Server` 窗口跑服务、主窗口直接退出。
  现在服务就跑在当前窗口里，关掉窗口即停止，不会误以为没启动。
- **卡在构建几分钟没有任何提示**：`.next` 不完整会触发整体重建，现在窗口里明说「可能要 1 到 3 分钟，请不要关窗口」。
- **每个页面 500**：构建被中断会清掉 `node_modules\.prisma\client`，启动前单独检查，缺了就补 `prisma generate`。
- **提示全是英文、node 日志乱码**：全流程改成中文分步提示（`[1/6]`–`[6/6]`）；
  `.cmd` 存 GBK，调用 node 的那几行临时切到 65001，`[build]` / `[scheduler]` 的中文日志不再显示成 `鏋勫缓浜х墿`。

### 工程

- 新增 `scripts/open-when-ready.mjs`（等端口就绪再开浏览器）。
- 新增 `scripts/make-launcher.py`：按 GBK + CRLF 生成 `启动 PsyMatch.cmd`，避免手动存错编码。
- 47 项单元测试、`tsc --noEmit` 全过；本地用系统 node v24 与 v22 各跑通一次完整启动（HTTP 200）。

---

## v1.0 — 2026-10-28

第一个可用版本：心理学实验的报名与排期平台，被试端 + 主试端跑通完整闭环。

### 产品

- **双身份**：登录时选「我是被试 / 我是主试」，账号按所选身份创建；没产生过数据的空账号允许切换身份，有实验或信誉记录的账号拒登并提示切回。
- **主试端**：发布实验（时长、奖励金额、个体/团体、信誉门槛、认证门槛、报名截止、批量生成时段）、编辑与上下架、追加时段、确认报名、确认到场、处理申诉。
- **被试端**：首页搜索与筛选、实验详情、挑时段报名、我的预约（确认 / 取消 / 签到）、信誉明细、学生认证。
- **底部导航**：被试 4 格平铺；主试 5 格，中间是凸起的圆形「+」直达发布实验。

### 核心机制

- **两段式确认**：报名先锁位（30 分钟不确认自动释放）→ 被试确认 → 主试确认 → 到场签到 → 主试确认到场，双方信誉 +1。
- **防超卖**：`bookedCount` 用条件 UPDATE 在事务内自增，影响行数为 0 直接 409，并发抢同一时段只有一人成功。
- **选时段助手**：候选顺序由代码排（命中「周三下午」这类模糊时间 > 剩余容量多 > 更近），模型只负责解释与追问，不能自己造时间；LLM 未配置 / 超时 / 聊满 12 轮自动降级成时段多选表单，走同一套下单逻辑。
- **信誉体系**：未到场 -2 并禁 1 天（第 4 次起 7 天）；主试取消按每条预约距开始的时长逐条判断 24 小时线；被试距开始不足 12 小时不能取消；禁期只延长不缩短。
- **申诉**：被试签到时主试未到场可提交，48 小时无回应自动成立并结算主试。
- **私信**：被试从实验详情页点主试头像即可发起，与「选时段」是两套独立通道。

### 界面

- 移动端优先，基准 375×812，界面全中文，无横向滚动。
- 实验卡片右上角「奖励 ¥30」价签；奖励全站只用金额口径，不再有「学分」。
- 返回统一走浏览器历史，底部 tab 根页面不挂返回箭头（避免「消息 ⇄ 对话」互相弹回）。

### 工程

- Next.js 15（App Router / React 19）+ Prisma 6 + SQLite + Tailwind 3 + Zod。
- 47 项单元测试、22 项数据库级验收（防超卖 / 分时段 / 禁期阶梯 / 取消结算 / 签到 / 申诉超时）、375 宽截图自检与导航回归脚本。
- 未配置 `LLM_API_KEY` 也能完整使用；未配置 SMTP 时验证码打到控制台与 `mock-email.log`。

### 已知限制

- 无通知系统（站内状态与倒计时是有的）、无管理员后台。
- 不支持删除已有时段，只能追加（会牵连预约与计数）。
- 认证只有教育邮箱 + 学号/工号，没有人脸实名。
- 单机部署用进程内定时器；多实例需换 BullMQ + Redis。
