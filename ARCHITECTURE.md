# ARCHITECTURE.md — 这个系统为什么长这样

写给**要改结构的人**。讲清分层、端口、护栏，以及「什么算越界」。
操作手册（怎么跑、目录在哪、踩什么坑）在 [AGENTS.md](./AGENTS.md)。

---

## 1. 一句话

**心理学实验的报名与排期**：主试发布实验 + 可约时段，被试挑时段报名，
两段式确认 → 现场一键签到 → 信誉分结算。外加一个能按自然语言条件跨实验筛选的 Agent 助手。

## 2. 三层：领域 / 应用 / 适配

依赖只能往下，不能往上。这是**依赖倒置**：领域层定义「我需要什么能力」（端口接口），
适配层去实现它。换数据库、换 LLM、换通知渠道，只加一个实现，领域层一个字不改。

```
            ┌──────────────────────────────────────────────┐
  app/  ────┤ 页面与 API route handler（薄壳：鉴权 + 校验 + 转发）│
  tools/────┤ Agent 工具（只编排，不碰数据库）                  │
            └───────────────────┬──────────────────────────┘
                                │ 调
            ┌───────────────────▼──────────────────────────┐
  server/───┤ 组装层：把适配器实例注进用例（还没搬完的业务也在这）│
            └───────────────────┬──────────────────────────┘
                                │ 调
            ┌───────────────────▼──────────────────────────┐
 application/ 用例：编排领域概念 + 调端口，不含业务判断        │
            └───────────────────┬──────────────────────────┘
                                │ 调
            ┌───────────────────▼──────────────────────────┐
  domain/  ─┤ 规则 / 状态机 / 纯函数 / 端口定义。零外部依赖     │
            └───────────────────▲──────────────────────────┘
                                │ 实现端口
            ┌───────────────────┴──────────────────────────┐
 adapters/  Prisma / LLM SDK / fetch —— 唯一碰外部世界的地方   │
            └──────────────────────────────────────────────┘
```

**为什么不是「按有没有副作用切」**（原来的 `lib/` + `server/`）：那样切出来的
`server/` 既是业务又直连数据库，改一个规则要动 SQL，换库要翻全目录。
现在业务判断全在 `domain/`（可纯单测，1967 行），编排在 `application/`（667 行，故意薄），
脏活在 `adapters/`（2224 行，可整层替换）。

## 3. 各层职责与判据

| 层 | 职责 | 判据（越界长什么样） |
|---|---|---|
| `domain/` | 规则、状态机、纯函数、端口接口 | 出现 `prisma` / `next` / `fetch(` / `@/lib` / `@/adapters` → 越界 |
| `application/` | 用例：调端口 + 调领域函数，做编排 | 出现 `prisma.` 或 import 适配器实现 → 越界 |
| `adapters/` | Prisma 实现、LLM 调用、HTTP | —— |
| `tools/` | Agent 工具，只编排 | 直接 `prisma.` → 越界（要用注入回调） |
| `app/` | 鉴权 + 校验 + 转发，handler ≤ 40 行 | handler 过长（L5） |
| `server/` | 组装依赖实例；未搬完的业务在这 | 会逐步变薄，`prisma.` 只许变少 |

### 3.1 唯一能证伪「分层是真的」的测试

**把 `src/adapters/` 整个删掉，`domain/` + `application/` 还能用假适配器跑通单测吗？**

能 → 分层是真的。不能 → 某处偷偷依赖了实现，普通测试抓不到（假 db 原样返回整行的情况，
测试全绿但行为是假的）。这条只能靠人想，脚本查不出来。

## 4. 端口清单

端口 = 领域层对外的「我需要」声明，定义在 `src/domain/ports/`，实现全在 `src/adapters/`。

| 端口 | 用途 | 实现 | 消费者 |
|---|---|---|---|
| `LlmPort` | 对话补全 | `llm/openai-compatible` `llm/mock` | `server/agent` `server/assistant-agent` |
| `SlotRepository` `AppointmentRepository` `ChatSessionRepository` `TransactionPort` | 锁位 / 预约 / 会话 / 事务 | `db/prisma/{slot,appointment,chat-session}-repo` `unit-of-work` | `application/book-slot` |
| `ExperimentPublishRepository` | 发布 / 上下架 / 追加时段 | `db/prisma/experiment-publish-repo` | `application/publish-experiment` |
| `SchedulingQueryPort` | 房间助手要的调度视图 | `db/prisma/scheduling-query` | `server/agent` |
| `PageQueryPort` + 子端口 | server component 的读 | `db/prisma/page-query*` | 各页面 |
| `ScheduleQuery` | 日程总表 / 分表 | `db/prisma/schedule-query` | `r/schedule` CSV 导出 |
| `AssistantQuery` | 我的安排 + 撞车 | `db/prisma/assistant-query` | `application/assistant-overview` |
| `AssistantThreadRepository` | 门厅会话持久化 | `db/prisma/assistant-thread-repo` | `server/assistant-agent` |
| `ExperimentSearchPort` | 跨实验搜索 | `db/prisma/experiment-search` | `application/search-experiments` |
| `DirectMessageRepository` | 人与人的私信 | `db/prisma/direct-message-*` | `server/dm` |
| `NotificationRepository` | 站内通知 | `db/prisma/notification-repo` | `application/send-reminders` |

**加端口的固定顺序**：`ports/` 写接口 → `adapters/` 写实现 → `application/` 或 `server/` 接线。
反过来就会在用例里 `new PrismaClient()`。

## 5. 关键设计取舍

### 5.1 防超卖：条件 UPDATE，不是「先查后改」

```ts
const affected = await tx.$executeRaw`
  UPDATE "Slot" SET "bookedCount" = "bookedCount" + 1
  WHERE "id" = ${slot.id} AND "bookedCount" < "capacity"
`;
if (affected === 0) throw new ApiError(409, "这个时段刚刚被约满了，换一个吧");
```

与建单同事务，影响行数为 0 整体回滚。**测试要断言 SQL 里含 `bookedCount < capacity`**——
只测行为的话，「优化成先查后改」在单线程下永远正确，抓不到。

### 5.2 撮合排序不交给模型

`domain/matching.ts` 的 `rankSlots` 先排好（提到的时间段 > 剩余容量多 > 距现在近），
排好的顺序注入 System Prompt。模型只解释和追问，**不能自己造时间**。
时段 id 只能来自工具返回，`book_slot` 再校验一次 id 是否在候选集合里。

### 5.3 降级不是兜底，是一等公民

`LLM_API_KEY` 空 / 超时 25s / 报错 → 接口返回 `mode: "form"`，前端换时段多选表单，
提交走**同一个** `bookSlot()`。门厅（跨实验搜索）降级成「直接搜一次给列表」。
12 轮对话上限也切表单。所有降级路径都有单测 + 验收。

### 5.4 两个工具注册表（房间 / 门厅）

- **房间**（`AgentContext`，`/experiments/[id]/chat`）：7 个工具，全部以 `ctx.experiment` 为前提
- **门厅**（`AssistantContext`，`/assistant/chat`）：只有 `search_experiments`

不合并成 8 个的理由：门厅根本没有「当前实验」，硬塞会让模型在错误语义下调 `book_slot`。
拆开后**能力边界在编译期强制**（类型里就没有那个 ctx），不靠 prompt 约束。
老注册表原封不动，parity 测试也不用改。

### 5.5 一 session 一实体

`ChatSession.experimentId` 非空。跨实验需求用 `AssistantThread` 单独一张表，
不加 nullable（会让老语义变糊、478 个测试受牵连）。

**门厅只给列表，不下单**：点卡片跳回既有 `/experiments/[id]/chat` 完成预约。
两层 UX（门厅找 / 房间约），AI 不做「多实体时间网格」这种推理——它必错。

约不了时给「换个实验」按钮，但**拦截是用户级时不给**（`BANNED` 挂人身上，给了等于骗他点）；
`CREDIT` / `VERIFY` 是实验级，可以给。

### 5.6 定时动作推导，不存储

提醒时刻 = `Slot.startAt - aheadMs`，算得出来，所以不建闹钟表，用扫描。
存闹钟的四个成本：状态变更点分散（5 处都要撤销/重设）、内存 `setTimeout` 重启即失、
多实例要分布式锁、停机就丢。

**扫描粒度必须显著小于最小窗口**：1min 扫描 vs 30min 最短业务时限 = 30 倍余量。
10min 扫描 vs 10min 提醒档是零余量，事件循环被串行任务卡一次就永久漏发。

### 5.7 能算出来的不存、派生字段不暴露成输入框

`Slot.capacity` 强制 = `Experiment.groupSize`，不让主试填（派生字段露成输入框 = 迟早平不了账）。
日程表不建物理表也不建 DB VIEW：Slot 是行骨架、Appointment 是填入的人，存储本来就对；
读取用 adapter 方法 `listSchedule(experimentId?)`——省略=总表、传 id=分表。
DB VIEW 的成本：Prisma 不认、migrate 报 drift、改列名不编译报错，单消费者收益≈0。

## 6. 护栏 L1–L7

`npm run lint:layers`（`scripts/check-layers.mjs`）把下面七条变成可执行检查，
`npm test` 的 `pretest` 会自动跑。

| 规则 | 内容 | 性质 |
|---|---|---|
| L1 | 领域层禁止 import 外部世界（prisma / next / axios / openai / adapters / lib / app / server / tools / components） | 硬性 |
| L2 | 领域层只允许 `zod` / `@/domain/*` / `node:*` / 相对路径 | 硬性 |
| L3 | 应用层禁止 import 适配器实现（只能 `import type` 端口） | 硬性 |
| L4 | 应用层禁止 import `next`（HTTP 是适配细节） | 硬性 |
| L5 | route handler ≤ 40 行（薄壳） | **软性**（基线棘轮） |
| L6 | `prisma.` / `$executeRaw` / `$queryRaw` / `cookies()` / `fetch(` 只能出现在 `src/adapters/**` | **软性**（基线棘轮） |
| L7 | 工具层禁止直连数据库 | 硬性 |

### 6.1 为什么 L5 / L6 用棘轮

搬家没搬完的项目，硬红线只有两个结局：要么为了全绿作假（把违规挪到检测盲区），
要么永远红（没人再看）。所以 L5/L6 把存量记进 `.layer-baseline.json`，**只报新增**。

```
现状 68 处（L6）→ 只报新出现的 → 搬走一批就重跑 --baseline 把基线调小
```

一句话：**不是现在很干净，是不许更脏。** 基线数字只许变小。

## 7. 技术选型与偏离原规格的地方

- **Next.js 单体 + Prisma + SQLite（本地）**，不是 monorepo（NestJS + PG + Redis + BullMQ）。
  本机没有 Docker / WSL / PG / Redis。保留的是真正被考核的部分：服务端分层、事务内防超卖、
  状态机、信誉分引擎、Agent 工具调用。放弃的是框架形态，不是服务端校验。
- **枚举用 String、Json 用 TEXT 存串**：SQLite 不支持 Prisma enum / Json。
  唯一事实源是 `domain/constants.ts` + Zod，写入前一律校验。
- **BullMQ → 进程内定时器**：任务体与调度壳解耦，换队列只换壳（第 8.2 节）。
- **迁移到 PG**：改 `provider` + `DATABASE_URL` 即可，字段/索引/唯一约束/防超卖 SQL 全通用。

## 8. 改结构时守住的三条

1. **一次只动一个可验证单元，验不过不许往上叠**
2. **搬家类重构的证法是「行为没变」**：导出集合比对、请求体逐字段断言、页面 curl 对拍
3. **新的依赖关系必须先加端口**，不许为了快直接在用例里 import 实现

---

_这份文档只描述**现在的结构**和**为什么**。谁在什么时候加的、分几个 Phase 做的、
每步估了多少小时——那些在 `git log` 里，不在这里。_
