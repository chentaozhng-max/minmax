# AGENTS-SUBJECT.md — 改被试端的 AI 读这一份

> 你是来给 **PsyMatch 被试端**写代码的 AI。仓库根就是 v1.3.0（Next.js 15 + Prisma + SQLite，四层架构）。
> 这份文件告诉你三件事：**你的作业范围**、**新代码该放哪一层**、**什么会让检查变红**。
>
> 全量仓库手册是 [AGENTS.md](./AGENTS.md)（含主试端、发布链路、部署）。你没必要时先读它，
> 但第 3 节的目录地图和第 4 节的分层判据值得扫一眼。

---

## 0. 三条不可协商的边界

| 编号 | 规则 | 违反的后果 |
|---|---|---|
| **B1** | 不改 `src/domain/`、`src/adapters/`、`prisma/schema.prisma` | 这些是被试端和主试端**共用**的规则与数据，改一处两边一起坏 |
| **B2** | 不新增 npm 依赖 | 构建链路有本机特定的包装，加依赖会引入不可控风险 |
| **B3** | 不改 `src/app/r/**`（主试端） | 那块归另一个人，改了必冲突 |

**需要动 B1 时**：停下来，写清楚「要加什么、为什么、哪些调用方会受影响」，让人确认。
**不要自己决定，不要「先加上再说」。**

这是可以商量的边界，不是摆设。越过它，PR 会被打回。

---

## 1. 十秒理解产品

主试发布实验和可约时段 → 被试挑一个时段报名 → 两段式确认 → 现场签到 → 信誉分结算。
**你负责的是「被试看到什么、点什么」。**

---

## 2. 跑起来

```bash
npm install
npm run setup     # 自动生成 .env + 建库 + 灌种子，不需要手动建配置
npm run dev       # http://localhost:3000
```

演示账号：被试 `13900000001`，验证码 `123456`。
没配 `LLM_API_KEY` 也能用（助手自动降级成表单）。

> 不要用 `npx next dev`，必须走 `npm run dev`——启动包装里挂了文件系统补丁，
> 直接调 next 会崩。

---

## 3. 新代码放哪一层（AI 最容易错的地方）

| 你要写的东西 | 放这里 | 绝对不要 |
|---|---|---|
| 页面（首屏渲染） | `src/app/<路径>/page.tsx` | 在里面写 `prisma.experiment.findMany()` |
| 有交互的部分 | 同目录 `xxx-view.tsx`，首行 `"use client"` | 在 server component 里用 `useState` |
| 通用 UI | `src/components/` | 复制一份已有的 `experiment-card` |
| 纯展示计算（排序、格式化） | 同文件的局部函数 | 塞进 `src/domain/`（那是共享规则） |
| 请求体校验 | 用 `src/domain/schemas.ts` 的现成 schema | 在 route 里手写 `if (!body.x)` |
| 新接口 | `src/app/api/<路径>/route.ts` | handler 超过 40 行 |
| 读数据 | 见下方「读数据的正确姿势」 | `new PrismaClient()` |

### 读数据的正确姿势（照抄这个）

```tsx
// src/app/me/page.tsx
import { prisma } from "@/lib/prisma";
import { makePageQuery } from "@/adapters/db/prisma/page-query";
import { requirePage } from "@/lib/page-auth";

export default async function MePage() {
  const session = await requirePage("SUBJECT");
  const pageQuery = makePageQuery(prisma);

  const [user, events] = await Promise.all([
    pageQuery.findMeProfile(session.sub),
    pageQuery.findRecentCreditEvents(session.sub, 20),
  ]);

  return <MeView user={user} events={events} />;
}
```

注意三点：
1. **`session.sub` 是用户 id**，不是 `session.id`。
2. 多个查询用 `Promise.all` 并发，不要三段串行 `await`（云端每段都是一次往返）。
3. 端口方法不够用时，**不是自己加查询**——去提需求（B1）。

### 反例（会被拦或被打回）

```tsx
const db = new PrismaClient();                    // ✗ 页面直连数据库
const list = await db.experiment.findMany();      // ✗ 应该在 page-query 里
const rows = await prisma.$queryRaw`SELECT ...`;  // ✗ 一定拦
```

---

## 4. 被试端地图

| 页面 | 文件 | 数据来源 |
|---|---|---|
| 首页 `/` | `src/app/page.tsx`、`search-bar.tsx`、`filter-chips.tsx` | `listExperimentCards()`（`src/server/experiments.ts`） |
| 实验详情 `/experiments/[id]` | `page.tsx`、`book-cta.tsx`、`contact-card.tsx` | `pageQuery.findExperimentPageDetail()` |
| 选时段 `/experiments/[id]/chat` | `chat/` | `/api/chat/[experimentId]` |
| 我的预约 `/appointments` | `appointments-view.tsx`（client） | `/api/me/appointments` |
| 个人中心 `/me` | `page.tsx` | `findMeProfile` / `findRecentCreditEvents` / `countAppointmentsByStatus` |
| 信誉明细 `/me/credit`、`/me/credit/[id]` | `page.tsx` | `findCreditEvents` / `findOwnedCreditEvent` |
| 通知 `/me/notifications` | `page.tsx`、`notifications-view.tsx` | `/api/me/notifications` |
| 学生认证 `/me/verify` | `page.tsx` | `findVerifyFormUser` |
| 门厅助手 `/assistant`、`/assistant/chat` | `page.tsx`、`chat-view.tsx` | `/api/assistant/chat` |
| 主试主页 `/researchers/[id]` | `page.tsx` | `findResearcherPublicPage` |
| 消息 `/messages`、`/messages/[id]` | `page.tsx` | `/api/messages`、`/api/dm/*` |
| 完善资料 `/onboarding` | `page.tsx` | `findOnboardingUser` |

**常用组件**：`experiment-card`（实验卡片）、`slot-grid`（时段选择）、`tab-bar`（底部导航）、
`page-header`（顶栏/返回）、`reward-tag`（奖励价签）、`countdown`（倒计时）、`credit-ring`（信誉环）。

**被试端接口**：`/api/me/appointments`、`/api/appointments`（报名）、
`/api/appointments/[id]/[action]`（确认/取消/签到）、`/api/experiments`（列表）、
`/api/experiments/[id]`（详情）、`/api/me/notifications*`、`/api/assistant/chat`。

---

## 5. 三个最常见的改动

### 5.1 首页加一个筛选条件

1. UI：`src/app/filter-chips.tsx` 加一个 chip，值是 URL query（如 `?duration=30`）。
2. 解析：`src/app/page.tsx` 的 `Search` 类型加字段，传给 `listExperimentCards()`。
3. 查询：`src/server/experiments.ts` 里加对应的 where 条件。

> 这三步里有一步在 `server/`，属于**协调区**——改之前说一声。

### 5.2 加一个被试端页面

```tsx
// src/app/xxx/page.tsx
import { requirePage } from "@/lib/page-auth";
import { PageHeader } from "@/components/page-header";

export default async function XxxPage() {
  await requirePage("SUBJECT");          // 角色不符自动送回首页
  return (
    <>
      <PageHeader title="标题" />
      <XxxView />                        {/* 有交互才拆 client 组件 */}
    </>
  );
}
```

规则：
- **底部 tab 的根页面不要挂返回箭头**（首页 / 预约 / 消息 / 我的）。
- 加了页面要顺手加 `loading.tsx` 骨架，骨架里**必须包含 `<TabBar />`**——导航栏是每页自渲染，不在 layout 里。
- 375px 宽度不能横向滚动。

### 5.3 改报名 / 取消 / 签到

**先停**。这是共享链路：规则在 `src/domain/booking-rules.ts`（`assertBookable`），
下单在 `src/application/book-slot.ts`，两边都被主试端和接口复用。

你要改「文案、按钮位置、提示样式」——可以，改页面层。
你要改「什么情况下允许报名/取消」——**不行**，提需求。

状态机长这样（不要自己加状态）：

```
PENDING_SUBJECT_CONFIRM → AWAITING_RESEARCHER → CONFIRMED → CHECKED_IN → COMPLETED
另有 NO_SHOW / CANCELLED_BY_SUBJECT / CANCELLED_BY_RESEARCHER
```

---

## 6. 提交前自检（判据是输出，不是「没报错」）

```bash
npx tsc --noEmit     # 必须零输出
npm test             # 先跑分层检查，再跑单测
```

必须看到这三个数：

```
✅ check-layers: 197 个文件通过（L1–L7）
Test Files  54 passed (54)
     Tests  591 passed (591)
```

- 数字**变大**（比如 55 个文件）说明你加了测试，正常。
- 数字**变小**说明有文件没跑到，或你删了测试——不允许删。
- `check-layers` 报新增违规：说明你把 `prisma.` 写到了 `adapters/` 以外，或者 `domain/` import 了外部包。

只改 UI 的话，再自己开浏览器看一眼 375 宽。

---

## 7. 会直接让检查变红的 7 个动作

| 动作 | 报错 | 正确做法 |
|---|---|---|
| `src/domain/` 里 `import { prisma }` | L1 | 需要数据就在 `domain/ports/` 加接口 |
| `src/domain/` 里 `import x from "next"` | L1/L2 | 领域层不认 HTTP |
| 页面里 `prisma.$queryRaw` | L6 | 用 page-query 端口 |
| `new PrismaClient()` | L6 | 用 `makePageQuery(prisma)` |
| route handler 写太长 | L5 | 逻辑挪到 `application/` 或 `server/` |
| 用 `<Link>` 做返回箭头 | 无报错，但会「消息 ⇄ 对话」弹回 | `PageHeader` 的 `back` 走 `router.back()` |
| 改了 `schema.prisma` 没生成 | 编译过、运行时 `undefined` | 停服务 → `npx prisma generate` |

---

## 8. 给 AI 的硬指令

1. **不确定就问，不要猜业务规则。** 「主试取消要不要扣分」这类问题，答案在
   `src/domain/credit.ts` 和 AGENTS.md 附录 A，不要自己发明。
2. **不要为了顺手改无关文件。** 改 A 需求时看到 B 有问题，记下来告诉人，不要一起改。
3. **不要删或跳过测试。** 测试红了改代码，不是改断言。
4. **不要往 seed 里加演示数据。** 那些是给别人演示用的，加进去会干扰。
5. **不要重构分层。** 你看到 `src/server/` 里还有 `prisma.` 是**已知欠账**，不是等你来清。
6. **改完必须报告**：改了哪几个文件、`tsc` 和 `npm test` 的实际输出、还有什么没做。

---

## 9. 提交

```bash
git checkout main && git pull
git checkout -b feat/subject-xxx
# ...改...
npx tsc --noEmit && npm test
git push origin feat/subject-xxx
```

然后开 PR 到 `main`。`main` 有分支保护：直接推会被拒，PR 需要 1 个批准。
PR 描述写三行：改了什么 / 为什么 / 怎么验证的。
