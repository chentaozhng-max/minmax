# AGENTS.md — 接手这个仓库先读这一页

写给**接手的 AI / 新同事**。读完能跑起来、改对地方、不踩已知的坑。

- 产品介绍（给人看）：[README.md](./README.md)
- 为什么这么分层、什么算越界：[ARCHITECTURE.md](./ARCHITECTURE.md)

> **只改被试端？** 读 [AGENTS-SUBJECT.md](./AGENTS-SUBJECT.md)。那份更短、范围更窄，
> 只讲被试端的文件地图、代码该放哪层、什么会让检查变红——不会让你误改主试端和共享规则。

> **这个仓库在 2026-11-02/03 整体重构过一次**：从「按有没有副作用切」（`lib/` + `server/`）
> 改成「领域层 / 应用层 / 适配层」（`domain/` + `application/` + `adapters/`）。
> 产品行为零变化。如果你在旧对话或旧 commit 里看到 `src/server/xx.ts` 里写着业务逻辑，
> 那个路径现在可能只是兼容转发壳——先看第 3 节目录地图。

---

## 0. 三十秒版

**PsyMatch**：心理学实验的**报名与排期**平台。主试发布实验 + 时段，被试挑时段报名，
两段式确认 → 现场一键签到 → 信誉分结算。

外加一个 **Agent 助手**：能按自然语言条件（「周三下午」「别太久」「奖励高的」）从全部实验里
筛出候选；也能在单门实验里帮着挑时段。

发布实验时可选**线上 / 线下**：线上实验不排时段，主试上传 PDF / Word / Excel 让 Agent 出一份
筛选问卷（也能自己改），被试填完由 Agent 计分，主试按分数线给达标者发私信；线下实验也可是
「先填问卷、通过了才能预约」。

```bash
npm install && npm run setup && npm run dev     # → http://localhost:3000
```

**不知道从哪下手时，按这个顺序看**：
1. 第 3 节目录地图 → 找到你要改的东西在哪一层
2. 第 4 节分层判据 → 确认你新建的文件该放哪
3. 第 5 节改完要跑什么 → 别交未验证的代码

---

## 1. 跑起来

### 1.1 三条命令

```bash
npm install
npm run setup     # prisma generate + 建表 + 灌种子（= db:push + db:seed）
npm run dev       # http://localhost:3000
```

**不要手动创建 `.env`**。`setup` / `dev` / `build` / `start` 前面都会跑
`scripts/ensure-env.mjs`：发现没有 `.env` 就按 `.env.example` 复制一份。
`.env` 在 `.gitignore` 里，新 clone 的目录没有它，缺了 Prisma 会报
`P1012 Environment variable not found: DATABASE_URL`。

**开发环境不需要配任何 key**：`LLM_API_KEY` 留空时助手自动降级——门厅页直接搜一次给你列表，
单实验页换成时段多选表单，全部功能可用。

### 1.2 演示账号（验证码统一 `123456`）

| 角色 | 姓名 | 手机号 | 用途 |
|---|---|---|---|
| 主试 | 陈砚 | `13800000001` | 5 个实验，有待确认报名 |
| 主试 | 谢秋池 | `13800000002` | 信誉 55，列表末尾 + 灰标 |
| 被试 | 林知夏 | `13900000001` | 有 1 条待处理申诉 |
| 被试 | 周叙 | `13900000002` | 干净账号，可演示完善资料引导 |
| 被试 | 许一然 | `13900000003` | 信誉 72 + 未认证，报不了门槛 80 的实验 |
| 被试 | 沈栗 | `13900000004` | 3 次未到场，禁报名中 |

一键登录（仅开发）：`/api/dev/login?phone=13900000001&to=/assistant/chat`
要 `ENABLE_DEV_LOGIN=true`，默认 404。**线上绝对不能开**（不校验验证码 = 任何人可冒充任何人）。

### 1.3 Windows 双击启动

`启动 PsyMatch.cmd` 按 `[1/7]`–`[7/7]` 依次：找 Node → 腾端口 → 补依赖 → 补 `.env` →
建库 → 补 Prisma Client 与构建产物 → 前台跑 `next start`，就绪后自动开浏览器。

这个 `.cmd` 是 **GBK + CRLF** 编码，别用编辑器直接存 UTF-8（带 BOM 第一行报错，不带 BOM 会在
`chcp 65001` 下触发 cmd 按字节截断，中文注释被腰斩当成命令执行）。改文案走
`scripts/make-launcher.py` 重新生成。AI 用 npm script 就行，不用管这个。

---

## 2. 硬性约束（违反了会直接坏，别试）

### 2.1 不要直接调 `npx next`

```bash
npx next dev        # ✗ 本机会崩
npm run dev         # ✓
```

`dev / build / start` 都经 `scripts/next-run.mjs` 包装，它做两件事：

1. `-r scripts/readlink-patch.cjs`：本机 E 盘对普通文件 `fs.readlink` 返回 `EISDIR`
   （正常 Windows 应为 `EINVAL`），webpack / Next 依赖快照会当致命错误直接崩，补丁只改错误码。
2. 从 `NODE_OPTIONS` 里摘掉宿主注入的文件系统 shim（把 `fs.rmSync` 交给回收站程序，
   清空 `.next` 上万文件时会 `ETIMEDOUT`）。`KEEP_NODE_OPTIONS=1` 可关闭该行为。

放到 Linux 服务器上这套包装是幂等的，不会坏事。

### 2.2 构建前必须停掉正在跑的服务

`prisma generate` 要覆盖 `node_modules/.prisma/client/query_engine-windows.dll.node`，
Windows 下文件被占用会 `EPERM`。

**这个坑的杀伤力比看起来大**：`prisma db push --skip-generate` 会成功，`tsc` **也会通过**
（`index.d.ts` 是旧的，但类型检查不了运行时）。结果是编译全绿、运行时
`prisma.某个新模型` 是 `undefined`、接口 500 `Cannot read properties of undefined`。

```bash
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*minmax*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
```

**改完 schema 的判据（比看日志可靠）**：

```bash
node -e "const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();console.log(typeof p.新模型)"
```

`object` 才算生成成功，`undefined` 就是没同步。

另外：**构建会整体替换 `.next`，正在跑的 `next start` 会随之崩**，构建完要重启。

### 2.3 构建失败先重试，不要立刻改代码

本机 E 盘 `next build --turbopack` 经常第一次失败（`ENOENT _buildManifest.js.tmp.*`、
`build-manifest.json` 缺失等「自己刚写的文件不见了」）。重试 2–3 次。

判构建**成功**的凭据不是「没报错」，而是这五个文件都在：
`.next/{BUILD_ID,build-manifest.json,routes-manifest.json,prerender-manifest.json,server/app-paths-manifest.json}`。

### 2.4 `node_modules/.prisma/client/index.js` 不能丢

被中断的 `prisma generate` 会先删掉它再重建。它不在时**整站 500**。
症状：页面全白 + 日志 `@prisma/client did not initialize yet`。修：停服务 → `npx prisma generate`。

### 2.5 返回箭头禁止用 `<Link>` 硬跳

`src/components/page-header.tsx` 的 `back` 统一走 `router.back()`，传进来的路径只当
「没有历史时的兜底」。以前对话页用 `<Link href="/messages">`、消息页用 `router.back()`，
两边方向相反 → 「消息 ⇄ 对话」无限互相弹回（决策表 #32）。
**底部 tab 的根页面（首页 / 消息 / 我的 / 我的实验）不要挂返回箭头。**

### 2.6 奖励金额不要直接渲染 `rewardText`

一律走 `@/domain/reward`（`src/lib/reward.ts` 是转发壳）：

```ts
rewardYuan("¥30")        // 30 | null
rewardAmountText("¥30")  // "¥30"
rewardLabel("¥30")       // "奖励 ¥30"
toRewardText("30")       // "¥30"（表单输入 → 入库值，0/空返回 ""）
```

卡片右上角用 `<RewardTag text={...} />`。库里 `rewardText` 只允许 `^¥\d{1,4}$`，
`scripts/prepare-db.mjs` 启动时幂等把「学分」老数据换算成 `¥30`。别再引入「学分」口径。

### 2.7 聊天页不要放 `TabBar`

`TabBar` 是 `fixed bottom-0 z-40`，会把聊天输入框压在下面点不到。
参考 `/assistant/chat` 和 `/experiments/[id]/chat`——两个聊天页都没有 TabBar，返回靠 `PageHeader`。

---

## 3. 目录地图

```
prisma/
  schema.prisma        数据模型（SQLite：枚举用 String，Json 用 TEXT 存 JSON 字符串）
  seed.ts              2 主试 + 4 被试 + 5 实验 + 预约 / 申诉 / 私信 / 通知
  dev.db               本地库（不进 git）
```

### src/domain/ — 领域层（零外部依赖，随便单测）

| 文件 | 里面是什么 |
|---|---|
| `constants.ts` | 枚举 / 标签 / 状态集合（SQLite 没有 enum，全靠这里 + Zod 约束） |
| `schemas.ts` | 所有请求体 Zod schema（**改接口先看这里**） |
| `messages.ts` | `ChatSession.messages` 的结构与序列化 |
| `credit.ts` | 信誉分规则：扣分 / 禁期阶梯 / 资格判定 |
| `booking-rules.ts` | 报名资格 / 冲突 / 截止的纯判定 |
| `experiment-rules.ts` | 实验可发布 / 可报名的判定 |
| `matching.ts` | 撮合排序 `rankSlots` + 中文模糊时间解析 |
| `reward.ts` | 奖励金额口径 |
| `reminder-levels.ts` | 提醒三档规则（提前多久、文案档位） |
| `search-criteria.ts` | 助手搜索的条件归一（「周三下午」→ 时间窗）+ 排序 |
| `assistant-brief.ts` | 助手总览的撞车判定 |
| `questionnaire.ts` | 问卷规则：归一化 / 发布体检 / 规则版拆题 / 答案校验 / `passState` `selectQualified` |
| `question-stats.ts` | 每题分布：频次 + 比例（分母是回答人数，多选题可超 100%） |
| `ports/` | **端口定义：接口只能写在这里**（清单见第 4.2 节） |

### src/application/ — 应用层（编排，不写业务判断）

| 文件 | 用例 |
|---|---|
| `book-slot.ts` | 锁位（含防超卖，走 `deps.uow.runInTransaction`） |
| `publish-experiment.ts` | 发布 / 上下架 + 团体容量校验 |
| `send-reminders.ts` | 到时提醒：挑人、生成文案、写通知 |
| `export-schedule.ts` | 主试日程 CSV 构建（BOM / CRLF / RFC4180） |
| `csv-format.ts` | 两份导出的公共格式：`csvCell` / `csvDateTime` / BOM / 行尾 |
| `export-questionnaire.ts` | 答卷 CSV：一行一个被试、一列一道题，只给学号不给手机号 |
| `assistant-overview.ts` | 助手总览：我的安排 + 撞车 |
| `search-experiments.ts` | 跨实验搜索：资格过滤 + 排序 + 「被筛掉的要告知」 |
| `submit-questionnaire.ts` | 被试提交答卷（重填覆盖 + 清空旧分数） |
| `score-questionnaire.ts` | 批量计分，计分器由调用方注入 |
| `invite-qualified.ts` | 按分数线挑人 + 逐条发通知，单条失败只计数不回滚 |
| `notify-declined.ts` | 告知本轮不合适的人；文案不带分数与判定词（有 4 条测试盯着） |

### src/adapters/ — 适配层（唯一允许碰外部世界）

```
llm/openai-compatible.ts   OpenAI 兼容调用（DeepSeek），读 LLM_EXTRA_BODY
llm/mock.ts                按脚本返回，断网可演示
llm/index.ts               getLlm() 按环境变量选实现
db/prisma/                 所有 Prisma 实现（下面按用途分组）
```

`db/prisma/` 里 22 个文件：

- **仓储（写）**：`slot-repo` `appointment-repo` `chat-session-repo`
  `experiment-publish-repo` `direct-message-threads` `direct-message-messages`
  `notification-repo` `assistant-thread-repo`
- **查询端口（读，给 agent）**：`scheduling-query` `schedule-query` `assistant-query`
- **页面查询端口（读，给 server component）**：`page-query` + `page-query-credit`
  `page-query-experiment` `page-query-researcher`
- **搜索**：`experiment-search`
- **事务**：`unit-of-work`（`runInTransaction`）
- `types.ts`：`PageQueryClientLike` 等最小接口，让测试能塞假 db

### src/tools/ — Agent 工具（两个注册表）

```
registry.ts                ToolRegistry<C> 泛型，本身不认识具体 ctx
context.ts                 AgentContext（房间：单实验）
assistant-context.ts       AssistantContext（门厅：跨实验，注入 search 回调）
index.ts                   createToolRegistry() / createAssistantToolRegistry()
```

**房间注册表 7 个**：`get_available_slots` `get_my_busy_slots` `get_my_credit_status`
`propose_slots` `book_slot` `join_waitlist` `escalate_to_researcher`

**门厅注册表 1 个**：`search_experiments`

> 为什么是两个注册表而不是 8 个工具塞一起：房间的 7 个都以 `ctx.experiment` 为必填前提，
> 门厅根本没有「当前实验」。硬塞会让模型在错误语义下调 `book_slot`。
> 详见 ARCHITECTURE 决策表 #36。

### src/server/ — 组装层 + 还没搬完的业务

| 文件 | 说明 |
|---|---|
| `agent.ts` | 房间助手：加载上下文 + LLM 循环 + 降级（prisma 已归零） |
| `assistant-agent.ts` | 门厅助手：跨实验编排 + 持久化 `AssistantThread` |
| `appointments.ts` | 预约状态机 + 取消结算（**还直连 prisma，L6 欠账最大处**） |
| `experiments.ts` | 首页列表查询 / 筛选 / 排序（低信誉沉底） |
| `credit.ts` | 信誉分落库 |
| `scheduler.ts` | 定时任务（提醒 1min / 重活 10min / 兜底 1h） |
| `dm.ts` `dm-page.ts` `mail.ts` | 私信、邮件 |
| `questionnaire-agent.ts` | 三个模型动作：出题 / 计分 / 建议分数线，**三个都有降级** |
| `questionnaire-service.ts` | 问卷编排 + 归属校验（页面和路由都只调它） |
| `experiment-state.ts` | 上下架：按库里的真实数据重跑领域校验（不信任表单） |
| `llm.ts` | 兼容转发壳 |

#### 问卷链路（v1.4）—— 改这块先读这 15 条

1. **发布实验分两种形态**：`Experiment.mode = ONLINE | OFFLINE`。线上实验 `slots` 允许为空，
   `assertExperimentDraft` / `reviewExperimentDraft` 里所有时段相关检查都被 `mode !== "ONLINE"` 跳过。
2. **需要问卷就不能先上架**：上下架接口检查 `needsQuestionnaire && questionnaire.status !== "PUBLISHED"`，
   所以发布页的「发布实验」按钮在问卷没发布时是禁用的。
3. **上传接口不落库**：`POST /api/r/experiments/[id]/questionnaire/import` 只返回草稿，
   主试在编辑器里改完再 `POST .../questionnaire` 保存。解析错不会污染已有问卷。
4. **计分失败不阻断提交**：`score=null` → 后台显示「未算分」，主试点「重算」再走一遍。
   **不要让提交接口因为模型不可用而报错**。
5. **报名门槛在 `application/book-slot.ts`**：`deps.questionnairePass` 可选，没注入按「不通过」处理；
   `QuestionnaireRepository.hasPassed` 在**没有问卷**时返回 `true`（否则没做问卷的实验谁都约不了）。
6. **别在页面里写 `prisma.`**：问卷相关的读取都在 `adapters/db/prisma/experiment-brief-repo.ts`
   与 `questionnaire-repo.ts`，页面通过 `server/questionnaire-service.ts` / `server/experiment-state.ts` 取。
7. **线上实验可以「全时段可填写」**（`Experiment.openAnytime`）：没有截止时间，
   `signupDeadline` 被写成一个远期哨兵值 `OPEN_ANYTIME_DEADLINE`（2099-12-31，定义在
   `domain/experiment-rules.ts`）。**任何展示截止时间的地方都要先看 `openAnytime`**，
   否则会把 2099 印给用户；判断「是否已截止」同理（`page.tsx` 里是 `!openAnytime && deadline <= now`）。
   线下实验忽略这个开关——线下没截止时间，时段会永远挂着。
8. **展示层必须按 `mode` 分流**：线上实验没有时段、地点、容量、报名截止，
   这四个词出现在线上实验的页面上就是 bug（v1.4.0 一次修了七处）。
   已经分流的落点：`components/experiment-card.tsx`、`app/experiments/[id]/page.tsx`、
   `app/r/experiments/[id]/detail-view.tsx`、`app/r/experiments/researcher-experiments.tsx`、
   `responses/responses-board.tsx`。**新加实验相关页面时先问一句「线上这里该显示什么」**，
   文案也不要写成「邀请预约」——线上没有预约这回事。
9. **答卷导出口径**：一行一个被试、一列一道题（`Q1. 题干`）；只给学号不给手机号
   （问卷承诺匿名，学号是为了学分登记）；未作答写「（未作答）」，**不能留空**
   ——留空进 SPSS 会变成缺失值，主试分不清「没答」和「没这题」。
10. **未通过的告知文案不许出现分数和判定词**：`application/notify-declined.ts` 的默认文案
    是「这一轮的参与条件与你的情况不太匹配」，**不带分数、不用「未通过 / 不合格 / 淘汰」**。
    `tests/notify-declined.test.ts` 里有 4 条专门盯这个，改文案前先看它们。
    `declinedAt` 与 `invitedAt` 互斥：已告知的不会再收到，列表上有「已告知」小标。
    另外 `selectDeclined` 与 `selectQualified` 有处刻意不一致 —— 前者**没设分数线也认手动判定**
    （`passed=false`），因为主试完全可能逐个判而不设统一线。
11. **主试主动发起私信要过两道闸**（`api/r/experiments/[id]/questionnaire/message`）：
    实验必须是自己名下的（`loadOwnedExperiment`）+ 这个人必须在这门实验交过答卷
    （`subjectHasResponse`）。**少任何一道，拿到一个 userId 就能给平台上任何人发消息。**
    建的线程走现有私信体系，前端跳到 `/messages/[id]` —— 主试也能打开那个页面，
    `DmChat` 已按 role 处理返回路径。
12. **总分 = 分项之和**：`scoreQuestionnaireResponse` 解析出 `breakdown` 后，用 `sumBreakdown`
    覆盖模型报的 `score`。**别改回「用模型的总分、分项只做展示」** —— 两者对不上时主试更不信。
    `normalizeBreakdown` 会按 `max` 截断（模型真会写「12/10」），规则版兜底没有分项（null），不硬凑。
    分项上限 6 项、维度名 20 字、依据 40 字，都是为了卡片不被撑爆。
13. **被试详情页的 CTA 必须认 `declined` 和 `invited`**：只看 `passed` 会出两种事故 ——
    已发「本轮不匹配」的人还在「等待主试筛选」傻等；已邀请的人看不出自己入选了。
    顺序是：问卷准备中 → 先填写问卷 → 本轮未入选（declined）→ 等待主试筛选 →
    已入选（invited）/ 问卷已完成。**线上实验的邀请文案不许提「时段」**（`mode` 已传进
    `inviteQualified`）。
14. **私信线程的 `experimentId` 跟随最新一条消息**：`notice-repo` 每次发消息都更新它。
    一对师生只有一条线程，不改的话列表里的「来自：XX 实验」会永远停在第一门实验。
15. **线上实验的时间形态**（`Experiment.scheduleMode`）：`ANYTIME` 随时可填 / `WINDOW` 连续 N 天每天一次 / `SCHEDULED` 固定场次。
    - 轮次按**上海时区自然日**算（`domain/online-schedule.ts`），**领域层不许 import `@/lib/time`**
      （L1 红线），那里自己平移 8 小时取 UTC 字段。
    - `Question.round` 决定「第几天显示哪些题」；这一轮没题时 `questionsForRound` 回退到 round=1，
      **别改成「必须逐天复制题目」**，主试维护不了。
    - 提交接口必须自己调 `canSubmitRound` 再判一次（前端拦不住直调）；
      `hasPassed` 只看 **round=1** —— 后面几天的卷是数据，不该把人踢出去。
    - 线上「固定场次」复用线下课程表，slots 照常建；「连续多天」不建 slots，靠 windowStart + repeatCount。
    - 答卷后台的「完成情况」按**人去重**（`summarizeRepeats`），四宫格按**份**算 ——
      两个口径都对，但标签必须带单位，否则主试会拿 6 份去和 3 人对。
    - 长程实验的答卷列表**按人聚合**（`groupResponsesByPerson`），一人一行。判定优先用库里的
      `passed`，没有才按分数线算 —— 只按分数线算会和「达标 N 份」对不上（踩过）。


### src/lib/ — 基础设施 glue + 兼容转发壳

- **真东西**：`http.ts`（`handle()` 信封）`api-client.ts` `auth.ts` `page-auth.ts`
  `prisma.ts` `time.ts`（全站时间格式化只走这里）`cn.ts` `types.ts`
  `unread-count.ts` / `unread-store.ts`（未读红点 + 轮询 toast）
- **转发壳**：`domain.ts` `credit.ts` `matching.ts` `reward.ts` —— 真身都在 `@/domain/`。
  保留是为了 32 个调用方不用改 import。**新代码请直接 import `@/domain/...`。**

### src/app/ — 页面与 API（29 个 page / 43 个 route handler）

```
page.tsx                  首页：搜索 + 筛选 + 实验卡片流
experiments/[id]/         实验详情 → chat/ 单实验排期对话页
assistant/                跨实验总览（只读：我的安排 + 撞车）
assistant/chat/           ★ 门厅对话（按条件找实验）
appointments/             我的预约（确认 / 取消 / 签到）
messages/                 私信列表 + 对话
me/                       个人中心 / 信誉明细 / 认证 / notifications/ 通知栏
onboarding/               首次完善资料（可跳过）
r/                        主试端：experiments 列表·新建·详情·编辑 / schedule 日程总表
                          / appeals / messages / profile / verify
                          experiments/[id]/questionnaire（问卷编辑器）
                          experiments/[id]/responses（答卷后台）
experiments/[id]/questionnaire  被试填问卷（提交即计分）
researchers/[id]/         主试主页（被试视角）
api/                      全部服务端校验与业务入口
```

### 其他

```
tests/                    68 个 Vitest 文件 / 805 用例（纯逻辑 + 适配器 + 页面查询）
scripts/                  next-run 包装、验收 accept、check-layers 护栏、截图 shoot
components/               page-header / tab-bar / experiment-card / slot-grid / ui/
```

**各层规模（2026-11-04 实测）**：domain 2905 行 / application 774 / adapters 2443 /
tools 753 / server 2084 / app 7625 / lib 654 / components 2227。
`application` 最薄——这是有意的，业务判断都沉在 `domain`，编排本来就短。

## 4. 分层判据（新建文件该放哪）

### 4.1 四层各自的边界

| 层 | 能 import | 绝对不能碰 | 典型内容 |
|---|---|---|---|
| `domain/` | 只有 `zod`、`@/domain/*`、`node:*`、相对路径 | **一切外部**：prisma / next / axios / openai / `@/adapters` `@/application` `@/server` `@/app` `@/tools` `@/components` `@/lib` | 规则、状态机、纯函数、端口定义 |
| `application/` | `@/domain/*`（含 `import type` 端口） | `@/adapters` / `@prisma/client` / `next` / `@/app` / `@/components` | 用例：调端口 + 调领域函数 |
| `adapters/` | 什么都行 | —— | Prisma / fetch / LLM SDK |
| `tools/` | `@/domain/*`、`@/tools/*` | **直接用数据库**（要用注入的回调） | 一个文件一个工具 |
| `app/` | 什么都行，但 handler 要薄（≤40 行） | —— | 鉴权 + 校验 + 调 application/server |
| `server/` | 什么都行 | —— | 组装依赖；还没搬完的业务 |

### 4.2 端口清单

| 端口 | 定义文件 | 实现 | 谁在用 |
|---|---|---|---|
| `LlmPort` | `ports/llm.ts` | `llm/openai-compatible` `llm/mock` | `server/agent` `server/assistant-agent` |
| `SlotRepository` `AppointmentRepository` `ChatSessionRepository` `TransactionPort` | `ports/repositories.ts` | `db/prisma/{slot,appointment,chat-session}-repo` `unit-of-work` | `application/book-slot` `server/agent` |
| `ExperimentPublishRepository` | `ports/experiment-repo.ts` | `db/prisma/experiment-publish-repo` | `application/publish-experiment` |
| `SchedulingQueryPort` | `ports/queries.ts` | `db/prisma/scheduling-query` | `server/agent` |
| `PageQueryPort` + 子端口 | `ports/page-queries.ts` | `db/prisma/page-query*` | 所有 server component 页面 |
| `ScheduleQuery` | `ports/schedule.ts` | `db/prisma/schedule-query` | `r/schedule` + CSV 导出 |
| `AssistantQuery` | `ports/assistant-query.ts` | `db/prisma/assistant-query` | `application/assistant-overview` |
| `AssistantThreadRepository` | `ports/assistant-thread.ts` | `db/prisma/assistant-thread-repo` | `server/assistant-agent` |
| `ExperimentSearchPort` | `ports/experiment-search.ts` | `db/prisma/experiment-search` | `application/search-experiments` |
| `DirectMessageRepository` | `ports/messaging.ts` | `db/prisma/direct-message-*` | `server/dm` `server/dm-page` |
| `NotificationRepository` | `ports/notification-repo.ts` | `db/prisma/notification-repo` | `application/send-reminders` |
| `QuestionnaireRepository` | `ports/questionnaire.ts` | `db/prisma/questionnaire-repo` | `application/{submit,score,invite}-*` `server/questionnaire-service` |
| `NoticePort` | `ports/notice.ts` | `db/prisma/notice-repo` | `application/invite-qualified` |

**加新端口的三步**：① 先在 `ports/` 写接口 ② 再在 `adapters/db/prisma/` 写实现
③ 最后在 `application/` 或 `server/` 里接。顺序反了就会在用例里 `new PrismaClient()`。

### 4.3 五条自检（第 5 条最重要）

1. `domain/` 里出现 `import ... from "prisma"` / `"next"` / `fetch(` → 越界
2. `application/` 里出现 `prisma.` → 越界
3. `tools/` 里出现 `prisma.` → 越界
4. `adapters/` 之外的 `prisma.` → 记进基线，只许变少（第 5.2 节）
5. **把 `src/adapters/` 整个删掉，`domain/` + `application/` 还能用假适配器跑通单测吗？**
   —— 能，说明分层是真的；不能，说明某处偷偷依赖了实现

前 4 条由 `npm run lint:layers` 强制，第 5 条只能靠你想。

## 5. 改完必须跑什么

### 5.1 三件套（顺序固定）

```bash
npx tsc --noEmit          # 类型零输出才算过
npm test                  # 会先自动跑 pretest = lint:layers
npm run accept            # 62 项数据库级验收（要 dev 库，会写真数据）
```

`npm test` 的 `pretest` 已经挂了 `check-layers`，所以**不需要单独跑**；但改完纯类型/文档时
想快速确认分层没塌，单独跑 `npm run lint:layers` 更快。

**验收判据是输出**：`805 tests passed`／`✅ check-layers: 237 个文件通过（L1–L7）`／
`62 passed / 0 failed`。看到「没报错」不算，得看到这三个数。

### 5.2 L6 欠账是「棘轮」，不是「已清零」

`.layer-baseline.json` 记着当前 `prisma.` 出现在非适配层的 68 处位置。
`check-layers` 只报**新增**，存量放行。所以：

- 你搬走一批 → 重跑 `node scripts/check-layers.mjs --baseline` 把基线调小
- **基线数字只许变小**。变大就会被 CI/pretest 拦下
- 前几名：`server/appointments.ts` 14 处、`api/auth/login/route.ts` 8 处、
  `server/scheduler.ts` 8 处

这条设计的用意：**不是现在很干净，是不许更脏**。搬家没搬完的项目，用硬红线只能二选一
（要么全绿作假，要么永远红），棘轮是唯一能渐进的办法。

### 5.3 页面改了要真跑一眼

单测和 accept 都抓不到「服务端渲染值 vs 客户端轮询值错位」「`<a>` 嵌 `<a>` 导致 hydration 报错」
这类问题。改了 UI 就 `npm run dev` 打开看一眼，或者用 `scripts/shoot.mjs` 截图。

## 6. 出问题先看这里

| 症状 | 十有八九是 | 怎么修 |
|---|---|---|
| `next build` 报 `ENOENT _buildManifest.js.tmp.*` / `build-manifest.json 缺失` / `export/500.html` | 注入的 `fs.rmSync` shim 把 `.next` 删到构建开始之后 | 已在 `next-run.mjs` 摘掉该 `--require`。日志里出现 `safe-delete` 就是它，重试 2–3 次 |
| `EPERM: rename ... query_engine-windows.dll.node.tmp*` | dev/start 还在跑，DLL 被占用 | 停服务再 `prisma generate`（第 2.2 节） |
| 编译全绿但接口 500 `Cannot read properties of undefined` | `prisma generate` 没真跑，`.prisma/client` 是旧的 | 第 2.2 节那条 `typeof p.模型` 探针，`undefined` 就是没同步 |
| 整站 500 + `@prisma/client did not initialize yet` | `node_modules/.prisma/client/index.js` 丢了 | 停服务 → `npx prisma generate` |
| 本机 `curl` 返回 502，页面打开却是好的 | 环境里设了 `HTTP_PROXY=127.0.0.1:59778` | 一律加 `--noproxy '*'` |
| 登录成功又跳回登录页 | Cookie 的 `Secure` 判定错 | 见第 21 条：按请求协议判，不按 `NODE_ENV` |
| `npm start` 起来是旧内容 | 复用环境里躺着上一版 `.next` | 现由 `build-if-needed.mjs` 按源码 mtime 判定，日志会打「源码比构建产物新 Ns」 |
| 手机在 `/onboarding` 点完成弹 `Failed to fetch` | 浏览器网络层没收到响应（不是接口报错） | `api-client` 已翻译成「网络没连上」；先 `curl --noproxy '*'` 验服务端 |
| 卡片奖励显示「面议」 | 库里还有「1 学分」这类老数据 | `prepare-db.mjs` 启动时幂等换算成 `¥30`，重启一次即可 |
| 部分页面白屏 + hydration 报错 | 多半是 `<a>` 里嵌了 `<a>`（整卡是 Link 又塞了按钮） | 用 `inset-0` 铺满 + 内容 `relative` + 按钮 `z-10` |
| 助手沉默 / 只回一句 | `max_tokens` 太小被思维链挤空 | 见 ARCHITECTURE 决策 #37，或用 `deepseek-chat` |
| 「消息 ⇄ 对话」退不出去 | 返回用了 `<Link>` 硬跳 | 见第 2.5 节 |
| 验证「助手能不能对话」时无从下手 | 顺序错 | 入口层（有 input 吗）→ 能力层（有对应工具吗）→ 模型层（才轮到花钱测） |

**判断「线上/本地跑的是不是新代码」**：grep 构建产物里的新文案，比看 BUILD_ID 时间可靠。

```bash
powershell -NoProfile -Command "Select-String -Path .next\static\chunks\*.js -Pattern '网络没连上'"
```

## 7. 加功能的配方

### 7.1 加一个页面

1. `src/app/<路径>/page.tsx`（server component）
2. 数据别直接 `prisma.` 查——用 `ports/page-queries.ts` 里的端口，或新建子端口
3. 有交互的部分拆成 `xxx-view.tsx` + `"use client"`
4. 顶栏用 `<PageHeader>`；**底部 tab 的根页面不要挂返回箭头**（第 2.5 节）
5. 真跑一眼（第 5.3 节）

### 7.2 加一个 API

1. 请求体 schema 加进 `src/domain/schemas.ts`
2. `src/app/api/<路径>/route.ts`：鉴权 → `parse` → 调 `application/` 或 `server/`
   → 用 `handle()` 包信封。**handler ≤ 40 行**（L5）
3. 业务判断写进 `domain/` 纯函数，别写在 handler 里
4. 补单测（纯函数）+ 需要的话加进 `scripts/acceptance.ts`（每节自带用户！）

### 7.3 加一个 Agent 工具

1. `src/tools/my-tool.ts`，用 `defineTool()`，参数写 Zod
2. **判断放哪个注册表**：依赖「当前实验」→ 房间（`createToolRegistry`）；
   跨实验 → 门厅（`createAssistantToolRegistry`）
3. 工具里不碰数据库：需要数据就往 ctx 里加回调，由 `server/agent.ts` 注入
4. 跑 parity 测试（`tests/tools-*`）——它保证模型看到的东西没被悄悄改坏

### 7.4 加一个 Prisma 模型

1. 改 `prisma/schema.prisma`（枚举用 String，Json 用 TEXT 存串）
2. **停服务** → `npx prisma generate` → 第 2.2 节那条 `typeof p.模型` 验一下
3. `npm run db:push` 或重建本地库
4. seed 里补几条数据，否则页面全是空状态
5. 端口 → 适配器 → 用例，三步顺序别反（第 4.2 节）

### 7.5 搬一处 L6 欠账

1. 在 `ports/` 加或扩端口接口
2. `adapters/db/prisma/` 写实现
3. 把 `server/xxx.ts` 里的 `prisma.` 换成端口调用
4. `npm run lint:layers` → `node scripts/check-layers.mjs --baseline` 把基线调小
5. `npm test && npm run accept` 全绿再 commit

### 7.6 「整卡可点」的正确写法

`experiment-card.tsx` 用的是「绝对定位的 Link 铺满 + 内容层穿透」：

```tsx
<div className="relative">
  <Link className="absolute inset-0" />
  <span className="pointer-events-none absolute ..." />   {/* 色条之类 */}
  <div className="pointer-events-none relative ...">      {/* 内容层 */}
    ...
    <Link className="pointer-events-auto relative z-10" /> {/* 卡内真正的按钮 */}
  </div>
</div>
```

**内容层不加 `pointer-events-none` 就点不动**：`position: relative` 的兄弟节点
按绘制顺序盖在绝对定位的 Link 之上，点击全被它吃掉，表现是「整卡没反应」，
只有最外圈内边距能点。这个 bug 静默、不报错，只能靠真点一次发现。

### 7.7 加一步新手引导

三处已在用（`components/tour.tsx`）：`/r/experiments` 列表、发布页分步、答卷后台。

1. 给目标元素加锚点：`data-tour="xxx"`（`<Field>` 支持透传这个属性）
2. 在页面里定义 `TourStep[]`，`<Tour steps={...} open={...} onDone={...} />`
3. 用 localStorage 记标记（`psymatch:tour:<页面>:v1`）；**发布页是按 step 分开记的**，
   走到哪一步讲哪一步，不要串成一条跨页教程

四条踩过的坑：

- **目标元素不存在会被静默跳过**（这是有意的：条件渲染的块不该把教程卡死）。
  所以选择器写错也不会报错，只是那一步不出现 —— 加完步骤要在真浏览器上数一遍。
- **高亮框会被裁到视口内，并且最高不超过半屏**。目标是整个列表容器那种超高元素时，
  照搬 `rect` 会让框跑出屏幕、气泡被顶到外面只剩半截。
- **描边必须写进 inline `boxShadow`**：`ring-*` 用的是同一个属性，会被整条覆盖掉。
  而且得是「2px 白 + 2px 砚青」两圈 —— 目标本身就可能是砚青色（发布按钮）。
- **打开时先筛步骤**（`usable`），不要边翻边跳。否则走到「4 / 5」突然关掉，用户以为漏了一步。

## 8. 部署与发布

### 8.1 换 PostgreSQL

1. `prisma/schema.prisma` 的 `provider` 改 `"postgresql"`
2. `.env` 的 `DATABASE_URL` 换 `postgresql://user:pass@host:5432/psymatch`
3. `npx prisma db push`（或 `migrate deploy`）→ `npm run build && npm start`

字段名、索引、唯一约束、防超卖 SQL 在 PG 上语义一致。

### 8.2 多实例要改的一件事

`src/server/scheduler.ts` 是进程内定时器，多实例会重复执行。换 BullMQ + Redis 的
repeatable job 时**任务体可以直接复用**（`application/send-reminders.ts` 已经是纯函数式的）。

### 8.3 反代后面必须传 `x-forwarded-proto`

Cookie 的 `Secure` 是按**请求协议**判的，不是 `NODE_ENV`（原 DECISIONS #21）。
不传这个头 → 反代后用 http 打开 → 浏览器丢弃 Secure Cookie → 「登录成功又跳回登录页」。

### 8.4 发版

```bash
python scripts/release.py v1.3 --dry-run   # 先看正文
python scripts/release.py v1.3             # 需要 GH_TOKEN
```

正文从 `git log <上一个tag>..HEAD` 按约定式提交前缀自动分组。
**README 顶部写着 `当前版本：vX.Y`，和要发的 tag 对不上会被脚本拦下**（连漏过两次）。
tag 要先 push，否则 GitHub API 422。

## 9. 附录 A：决策速查表

35 条历史决策里 18 条还活着，按「你想改什么」索引。**编号是原来 DECISIONS.md 的**，
方便你从旧 commit / 旧对话里对上。

| 想改什么 | 先知道 | 原编号 |
|---|---|---|
| 换数据库 / 部署形态 | SQLite 只是「一条命令跑起来」的选择，代码没绑死；枚举是 String、Json 是 TEXT 存串，换 PG 这些都不动 | #1 #2 #3 #5 |
| 换定时任务 / 多实例 | 现在是进程内定时器，任务体与调度壳解耦，换 BullMQ 只换壳 | #4 |
| 加学科 / 筛选维度 | 数据模型没有 `field` 字段；当前筛选只有「可报名 / 今天 / 明天 / 时长 / 资格」 | #6 |
| 改签到流程 | 是**一键签到**，没有 4 位码，防误点只靠时间窗（开始前 30min ~ 结束） | #8 |
| 改取消规则 | 距开始不足 12h 直接拒绝取消（提示去签到），不是「可取消但扣分」 | #9 |
| 改信誉分结算 | 到 100 时**不写** `CreditEvent`（没变动就没流水）；`noShowCount` 永远不清零 | #10 #12 |
| 改禁期 | 只延长不缩短——已有更长禁期时保留更晚的解禁时间 | #11 |
| 改实验编辑 | 只做「改信息 + 上下架 + 追加时段」，**不删时段**（删了 `bookedCount` 和预约会凭空消失） | #13 |
| 改预约交互 | 候选点击即预约，直接走 `/api/appointments`，不再绕一轮 LLM；与 `book_slot` 共用 `bookSlot()` | #15 |
| 改时段粒度 | 一律半小时对齐；批量生成的「每段分钟」= 实验时长向上取整到 30 的倍数 | #19 |
| 改顶部栏 / 返回 | `PageHeader` 统一；返回走 `router.back()`，传路径只当兜底；tab 根页不挂返回 | #20 #32 |
| 改登录 Cookie | `Secure` 按请求协议判（`x-forwarded-proto`），不按 `NODE_ENV` | #21 |
| 加「消息」相关功能 | `ChatSession`=人和 AI；`DirectThread`/`DirectMessage`=人和人。同人对同一主试只有一条线程 | #23 |
| 改主试端导航 | 5 格：实验 / 消息 / **+发布**（凸起）/ 申诉 / 我的 | #27 |
| 改主试「我的」页 | 招募方视角，不复制被试版；第一屏是发布 CTA + 待办 | #28 |
| 改认证流程 | 被试「学生认证」/ 主试「主试认证」，同一个 `VerifyForm` 传 `role` 换文案 | #29 |
| 改文案口径 | 产品定位是「心理学实验的报名与排期」，不是「你说有空它来排」 | #30 |
| 改奖励显示 | 全站只有金额，没有「学分」；一律走 `@/domain/reward` | #33 |

**已作废（别再按它们改）**：主试消息 Tab 改申诉（已被 #27 覆盖）、实验详情页招聘风格试点
（只改过一屏，未铺开）、配图水印裁切（一次性操作）、`build-if-needed` 只看产物（已改按 mtime）、
`链接硬跳返回`（已被 #32 推翻）、以及三条 2026-10-27 的临时排查记录（修完即失效）。

## 10. 附录 B：已知未做

- **管理员后台**：`/admin` 自然 404
- **真实 SMTP**：现在 mock，验证码打到控制台 + `mock-email.log`
- **删除已有时段**：故意不做（原 #13）
- **学科筛选**：数据模型没这个字段（原 #6）
- **多实例调度**：`scheduler.ts` 是进程内定时器（第 8.2 节）
- **L6 欠账 68 处**：`server/appointments.ts` 14 / `api/auth/login` 8 / `server/scheduler.ts` 8 等，
  只许变少（第 5.2 节）
- **应用层偏薄**：774 行 / 6 个用例，很多 server 里的业务还没往 `domain` 沉

> 通知系统**已经做了**（站内红点 + 轮询 toast + 1min 扫描提醒），别按旧文档当成「明确不做」。

---

_这一页是给「下一个接手的人」的。它不是历史记录，是操作手册——改这里时想的是「他明天会不会踩到」，
不是「我们昨天做了什么」。_
