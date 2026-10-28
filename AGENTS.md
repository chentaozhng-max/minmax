# AGENTS.md — 接手这个仓库先读这一页

写给**接手的 AI / 新同事**：读完能跑起来、改对地方、不踩已知的坑。
产品介绍看 [README.md](./README.md)，历史取舍看 [DECISIONS.md](./DECISIONS.md)（按编号，改行为要补一条）。

---

## 0. 一句话说清是什么

**PsyMatch**：心理学实验的**报名与排期**平台。主试发布实验 + 可约时段，被试挑时段报名，
然后走两段式确认 → 现场一键签到 → 信誉分结算。

- 技术栈：Next.js 15（App Router、React 19、Server Components）+ Prisma 6 + SQLite
- 形态：移动端优先（基准 375×812），界面全中文，无管理后台
- 仓库：`E:/minmax`（Windows 本地），线上分享链接见第 8 节

---

## 1. 跑起来（三条命令）

```bash
npm install
npm run setup     # prisma generate + 建表 + 灌种子数据（等价于 db:push + db:seed）
npm run dev       # http://localhost:3000
```

首次 `npm install` 走 `.npmrc` 里的 npmmirror 镜像；换机器网络不好时加
`--registry=https://registry.npmmirror.com`。

**开发环境不需要配任何 key**：`.env` 里 `LLM_API_KEY` 留空时，选时段页自动降级成
「时段多选表单」，全部功能可用（只是没有自然语言推荐）。`SMTP_*` 留空时验证码打到
控制台 + `mock-email.log`。

**演示账号**（验证码统一填 `123456`）：

| 角色 | 姓名 | 手机号 | 用途 |
|---|---|---|---|
| 主试 | 陈砚 | `13800000001` | 5 个实验，有待确认报名 |
| 主试 | 谢秋池 | `13800000002` | 信誉 55，列表末尾 + 灰标 |
| 被试 | 林知夏 | `13900000001` | 有 1 条待处理申诉 |
| 被试 | 周叙 | `13900000002` | 干净账号，可演示完善资料引导 |
| 被试 | 许一然 | `13900000003` | 信誉 72 + 未认证，报不了门槛 80 的实验 |
| 被试 | 沈栗 | `13900000004` | 3 次未到场，禁报名中 |

**Windows 双击版**：`启动 PsyMatch.cmd` 按 `[1/6]`–`[6/6]` 依次找 Node → 腾端口 →
补依赖 → 建库 → 补 Prisma Client 与构建产物 → 前台跑 `next start`，浏览器由
`scripts/open-when-ready.mjs` 轮询端口、就绪后才打开（不再是固定等 5 秒）。
这个 `.cmd` 是 **GBK + CRLF** 编码，别用编辑器直接存 UTF-8：带 BOM 会让第一行报错，
不带 BOM 又会在 `chcp 65001` 下触发 cmd 的按字节截断 bug（中文注释被腰斩当成命令执行）。
文案统一改 `scripts/make-launcher.py` 里的字符串再跑一次，它会按正确编码生成。
node 那几行单独 `chcp 65001`，否则 `[build]` / `[scheduler]` 的中文日志会显示成乱码。
这两个只是给人用的糖，AI 用 npm script 就行。

---

## 2. 硬性约束（违反了会直接坏，别试）

### 2.1 不要直接调 `npx next`

```bash
npx next dev        # ✗ 在本机会崩
npm run dev         # ✓ 必须走这个
```

`dev / build / start` 都经 `scripts/next-run.mjs` 包装，它做两件事：

1. `-r scripts/readlink-patch.cjs`：本机 E 盘对普通文件 `fs.readlink` 返回 `EISDIR`
   （正常 Windows 应为 `EINVAL`），webpack / Next 依赖快照会当致命错误直接崩，补丁只改错误码。
2. 从 `NODE_OPTIONS` 里摘掉宿主注入的文件系统 shim（把 `fs.rmSync` 交给回收站程序，
   清空 `.next` 上万文件时会 `ETIMEDOUT`）。设 `KEEP_NODE_OPTIONS=1` 可关闭该行为。

放到 Linux 服务器上这套包装是幂等的，不会坏事。

### 2.2 构建前必须停掉正在跑的服务

`prisma generate` 要覆盖 `node_modules/.prisma/client/query_engine-windows.dll.node`，
Windows 下文件被占用会 `EPERM`。停服务的姿势：

```bash
# Git Bash 里最省事
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id \$_.OwningProcess -Force -Confirm:\$false }"
```

另外：**构建会整体替换 `.next`，正在跑的 `next start` 会随之崩**，构建完要重启。

### 2.3 构建失败先重试，不要立刻改代码

本机 E 盘 `next build --turbopack` 经常第一次失败（`ENOENT _buildManifest.js.tmp.*`、
`build-manifest.json` 缺失等"自己刚写的文件不见了"）。标准做法是重试：

```bash
for i in 1 2 3; do
  node scripts/next-run.mjs build --turbopack > build.log 2>&1
  [ -f .next/BUILD_ID ] && { echo "BUILD OK attempt $i"; break; } || echo "attempt $i failed"
done
```

判断构建**成功**的凭据不是"没报错"，而是这五个文件都在：
`.next/{BUILD_ID,build-manifest.json,routes-manifest.json,prerender-manifest.json,server/app-paths-manifest.json}`。

### 2.4 `node_modules/.prisma/client/index.js` 不能丢

被中断的 `prisma generate` 会先删掉它再重建。它不在时**整站 500**。
症状：页面全白 + 日志 `@prisma/client did not initialize yet`。
修：`npx prisma generate`（先停服务）。

### 2.5 返回箭头禁止用 `<Link>` 硬跳

`src/components/page-header.tsx` 的 `back` 统一走 `router.back()`，传进来的路径只当
「没有历史时的兜底」。以前对话页用 `<Link href="/messages">`、消息页用 `router.back()`，
两边方向相反 → 「消息 ⇄ 对话」无限互相弹回，退不出去（DECISIONS 第 32 条）。
**底部 tab 的根页面（首页 / 消息 / 我的 / 我的实验）不要挂返回箭头。**

### 2.6 奖励金额不要直接渲染 `rewardText`

一律走 `src/lib/reward.ts`：

```ts
rewardYuan("¥30")        // 30 | null
rewardAmountText("¥30")  // "¥30"
rewardLabel("¥30")       // "奖励 ¥30"（列表里的行内写法）
toRewardText("30")       // "¥30"（表单输入 → 入库值，0/空返回 ""）
```

卡片右上角用 `<RewardTag text={...} />`（`src/components/reward-tag.tsx`）。
库里 `rewardText` 只允许 `^¥\d{1,4}$`，`1 学分` 这类老数据由 `scripts/prepare-db.mjs`
在启动时幂等换算成 `¥30`。别再引入「学分」口径。

### 2.7 `ENABLE_DEV_LOGIN` 线上绝对不要开

`/api/dev/login?phone=...&to=...` 是不校验验证码的一键登录，只在自动化截图 / 回归时
临时开（默认 404）。线上开启等于任何人可冒充任意账号。

---

## 3. 目录地图

```
prisma/
  schema.prisma          数据模型（SQLite；枚举用 String，Json 用 TEXT 存 JSON 字符串）
  seed.ts                2 主试 + 4 被试 + 5 实验 + 预约 / 申诉 / 私信
  dev.db                 本地库（不进 git）

src/app/                 页面 + API（App Router，21 个页面 / 28 个 route handler）
  page.tsx               被试首页：搜索 + 筛选 + 实验卡片流
  login/                 登录（选「我是被试 / 我是主试」→ 决定建号身份）
  experiments/[id]/      实验详情
    book-cta.tsx         底部「立即预约」按钮
    chat/                选时段页（时段网格常驻 + 可选的自然语言助手）
  appointments/          我的预约（确认 / 取消 / 签到）
  messages/              消息：选时段记录 + 私信列表 / 私信对话
  me/                    被试个人中心、信誉明细、认证
  onboarding/            首次进入的完善资料（可跳过）
  r/                     主试端（r = researcher）
    experiments/         列表 / 新建 / 详情 / 编辑
    messages/  appeals/  profile/
  researchers/[id]/      主试主页（被试视角）
  api/                   全部服务端校验与业务入口

src/server/              业务服务层（有副作用、碰数据库）
  appointments.ts        预约状态机、防超卖、取消结算
  agent.ts               选时段助手：工具定义 + LLM 循环 + 降级
  llm.ts                 OpenAI 兼容调用（25s 超时）
  experiments.ts         列表查询、筛选、排序（低信誉沉底）
  credit.ts  scheduler.ts  dm.ts  dm-page.ts  mail.ts

src/lib/                 纯逻辑（可单测，不碰 IO）
  domain.ts              枚举 + 所有 Zod schema（改动先看这里）
  credit.ts              信誉分规则（扣分 / 禁期阶梯 / 资格判定）
  matching.ts            撮合排序 + 中文模糊时间解析
  reward.ts              奖励金额口径
  time.ts                上海时区格式化（全站只用这里的函数）
  auth.ts  page-auth.ts  http.ts  api-client.ts  prisma.ts  cn.ts  types.ts

src/components/          通用 UI：page-header / tab-bar / experiment-card / slot-grid
  ui/                    button / input / badge / dialog 等原子组件
tests/                   Vitest 单测（纯逻辑）
scripts/                 包装器、启动兜底、验收、截图（见第 6 节）
DECISIONS.md             每个非显然取舍的原因，按编号追加
CHANGELOG.md             每个版本改了什么（发版时同步更新）
```

---

## 4. 架构约定

### 4.1 API 一律返回信封

```ts
{ code: 0, message: "ok", data: T }        // 成功
{ code: 409, message: "这个时段刚被约满", data: null }  // 失败（HTTP 状态码同 code）
```

写 route handler 的固定姿势：

```ts
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireRole("RESEARCHER");   // 401/403 自动抛
  const body = schema.parse(await req.json());    // ZodError 自动转 400
  return ok(await doSomething(user, body));
});
```

- `handle()`（`src/lib/http.ts`）把 `ApiError` / `ZodError` / 未知异常统一转成信封。
- 客户端用 `api<T>()` / `postJson<T>()`（`src/lib/api-client.ts`），它解包信封、
  把 `TypeError: Failed to fetch` 翻成中文，并且**只对幂等请求**开 `retryNetworkError`。
- 参数校验的 schema 都在 `src/lib/domain.ts`，不要在 route 里手写 if 校验。

### 4.2 认证

- 两个 httpOnly Cookie：`pm_at`（access，2h）+ `pm_rt`（refresh，30d），JWT（jose，HS256）。
- 页面：`await requirePage("RESEARCHER")`（`src/lib/page-auth.ts`），角色不符送回各自首页，不显示 404。
- 接口：`requireUser()` / `requireRole("RESEARCHER")` / `requireRole(["SUBJECT", "RESEARCHER"])`。
- **Cookie 的 `Secure` 按请求协议判断**（`isSecureRequest`），不要按 `NODE_ENV`——
  否则手机用 `http://192.168.x.x:3000` 打开时 Cookie 被丢弃，表现为"登录成功又跳回登录页"。

### 4.3 身份与导航

- 角色 `SUBJECT` / `RESEARCHER` / `ADMIN`（无后台）。
- 登录页选的「我是被试 / 我是主试」是**建号依据**；空账号（没发过实验、无信誉流水）允许切换身份，
  有数据的账号拒登并提示切回。别改回"一律建被试"。
- 底部栏：被试 4 格平铺（首页 / 预约 / 消息 / 我的）；主试 5 格，中间是**凸起的圆形「+」**
  直达 `/r/experiments/new`。
- 前端 toast 文案是产品语气的一部分，改文案别改成"系统提示"那套。

### 4.4 数据模型的三个约定

1. **枚举用 String 存**（SQLite 不支持 enum），取值常量 + Zod 校验在 `src/lib/domain.ts`。
   加状态要同时改：`domain.ts` 常量 → 页面里的 label 映射 → 状态机判断。
2. **Json 字段用 TEXT 存 JSON 字符串**（目前只有 `ChatSession.messages`，存对话历史），
   读写走 `domain.ts` 里的 helper，不要直接在页面/路由里 `JSON.parse`。
   注意 `Experiment.slots` **不是** JSON 字段，它是对 `Slot` 表的关系，别照抄错。
3. **时段按半小时对齐**（`src/lib/time.ts` 与批量生成器），发布页默认时长 30 分钟。

### 4.5 状态机（改这里最容易出事）

**Experiment**：`DRAFT → PUBLISHED → CLOSED / FINISHED`

**Appointment**（`src/server/appointments.ts` 是唯一入口）：

```
PENDING_SUBJECT_CONFIRM  ← 报名后先锁位（30 分钟不确认，定时任务自动释放）
  → AWAITING_RESEARCHER ← 被试点「确认」
  → CONFIRMED            ← 主试点「确认预约」
  → CHECKED_IN           ← 被试现场一键签到（开始前 30 分钟 ~ 结束）
  → COMPLETED            ← 主试点「确认到场」，双方信誉 +1
另外：NO_SHOW / CANCELLED_BY_SUBJECT / CANCELLED_BY_RESEARCHER
```

两个容易被遗漏的分支：**签到在 `AWAITING_RESEARCHER` 状态下也允许**（主试忘了点确认，
人已经来了不能卡住）；**主试可以「释放」还没确认的预约**（`releaseByResearcher`，
名额回滚、不扣分），这是名额被锁死的唯一出口。

规则（都在 `src/lib/credit.ts`，单测覆盖）：

| 事件 | 后果 |
|---|---|
| 被试未到场 | -2 分，`noShowCount+1`，第 1–3 次禁 1 天，第 4 次起禁 7 天 |
| 主试取消，距开始 **< 24h** | 这一条 -2，`noShowCount+1`（**逐条判断**：同场实验里远的那场不扣） |
| 被试取消，距开始 **< 12h** | 不允许 |
| 到场双方 | 各 +1，上限 100；到 100 不再写 `CreditEvent` |
| 禁期 | 只延长不缩短；到期只清 `bannedUntil`，`noShowCount` 永久保留 |

**防超卖**必须用条件 UPDATE，不要写成「先查再改」：

```ts
const affected = await tx.$executeRaw`
  UPDATE "Slot" SET "bookedCount" = "bookedCount" + 1
  WHERE "id" = ${slot.id} AND "bookedCount" < "capacity"
`;
if (affected === 0) throw new ApiError(409, "这个时段刚刚被约满了，换一个吧");
```

**ChatSession**：`COLLECTING_AVAILABILITY → PROPOSED → BOOKED`（另有 `WAITLIST / ESCALATED / CLOSED`）。

### 4.6 选时段助手的分工（别让模型决定业务）

- `src/lib/matching.ts` 的 `rankSlots` **先排好序**：命中被试提到的时间 > 剩余容量多 > 更近。
- 排好的候选注入 System Prompt，模型只负责解释和追问，**不能自己造时间**。
- `book_slot` 工具会再校验 slot id 是否在候选集合里。
- LLM 未配置 / 25s 超时 / 报错 / 聊满 12 轮 → 接口返回 `mode: "form"`，前端切成时段多选表单，
  提交后走**同一个** `bookSlot()`。所以任何改动都要保证两条路径行为一致。

### 4.7 时间与时区

全部按 **Asia/Shanghai** 处理，格式化只用 `src/lib/time.ts` 的 `formatDayCN` / `formatHM` /
`formatDateTimeCN` / `toShanghaiIso`。不要用 `toLocaleString()` 裸调（服务器时区可能不是 +8）。

---

## 5. 环境变量

复制 `.env.example` → `.env`（`.env` 已在 `.gitignore`，**key 不进 git**）。

| 变量 | 说明 |
|---|---|
| `DATABASE_URL` | 默认 `file:./dev.db`（相对 `prisma/` 解析） |
| `JWT_SECRET` / `JWT_REFRESH_SECRET` | 上线必须换掉，否则任何旧 token 都能登进来 |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` | OpenAI 兼容接口；key 空 = 降级表单模式 |
| `EDU_EMAIL_DOMAINS` | 教育邮箱后缀白名单，默认 `edu.cn,edu` |
| `SMTP_HOST/PORT/USER/PASS` | 留空走 mock：验证码打到控制台 + `mock-email.log` |
| `ENABLE_DEV_LOGIN` | 仅自测用，线上必须不设（见 2.7） |
| `PORT` | `next-run.mjs` 在未显式传 `-p` 时读它 |

---

## 6. 改完必须做的三件事

```bash
npx tsc --noEmit     # 类型（应该零输出）
npm test             # Vitest 单测，纯逻辑
npm run accept       # 数据库级验收：防超卖 / 分时段 / 禁期阶梯 / 取消结算 / 签到 / 申诉超时
```

`npm run accept` 会连真库、自建临时账号和实验（跑完自己清理），**但仍然是真库，别在生产库上跑**；
种子数据被搅乱了就 `npm run db:reset`（`db push --force-reset` + 重新灌种子）。
`npm test` 结束时若报一个临时目录 EPERM，那是环境 shim 的噪音，看 `Tests N passed` 即可。

涉及 UI 的改动再做一次 375 宽截图自检：

```bash
# 1. 起一个允许一键登录的实例（仅本地）
ENABLE_DEV_LOGIN=true node scripts/next-run.mjs start -p 3000

# 2. 写页面清单：每行 "名字 路径"，"login 手机号" 切账号
cat > shots/pages.txt <<'EOF'
login 13900000002
home /
detail /experiments/<实验id>
login 13800000001
r-profile /r/profile
EOF

# 3. 截图（无头 Edge + CDP，输出里出现 OVERFLOW 就是有横向溢出）
node scripts/shoot.mjs http://localhost:3000 shots shots/pages.txt
```

导航相关的改动还要跑 `node scripts/_check-back.mjs http://127.0.0.1:3000`，
它用真实点击断言「消息 ⇄ 对话」「详情 → 选时段 → 返回」「主试消息」三条链路不会互相弹回。

---

## 7. 常见改动配方

**加一个页面**
`src/app/<路径>/page.tsx` + 首行 `await requirePage("SUBJECT")` + `<PageHeader title=... />`，
底部 tab 根页面不加 `back`。客户端交互拆到同目录的 `*-view.tsx`（`"use client"`）。

**加一个接口**
`src/app/api/<路径>/route.ts`，用 `handle()` 包住，先 `requireRole()` 再 `schema.parse()`，
最后 `return ok(data)`。schema 写在 `src/lib/domain.ts`。

**加一个字段**
`prisma/schema.prisma` → `npx prisma db push` →（如需）补 `domain.ts` 的 schema 与类型 → 页面。
没有 migration 目录，改 schema 直接 `db push`。

**改实验列表排序 / 筛选**
只在 `src/server/experiments.ts` 的 `listExperimentCards` 与 `src/app/filter-chips.tsx` 里动。
「主试信誉 < 60 的实验沉底 + 灰标」是产品要求，别当 bug 修掉。

**改信誉规则**
先改 `src/lib/credit.ts`，同步 `tests/credit.test.ts`，再确认 `src/server/credit.ts` 的落库口径，
最后补 `DECISIONS.md`。

**加设计决定**
`DECISIONS.md` 末尾追加一条编号。历史上出现过编号重复（有两组 26–28、两个 32），
追加时取**当前最大编号 +1**（现在最大是 33），不要插在中间重排。写"为什么"，不写"改了什么"。

---

## 8. 部署

**线上形态**：WorkBuddy 托管沙箱 + 分享链接（`https://psymatch.app.workbuddy.host/?sharecode=Z355S3QUOQ`）。
沙箱只跑 `npm start`，不自动 build，所以启动链路是：

```
npm start
 ├─ scripts/prepare-db.mjs      库不存在就建表 + 灌种子；顺带把「学分」老数据换算成金额
 ├─ scripts/build-if-needed.mjs 产物不全 / 源码比 BUILD_ID 新 → prisma generate + next build
 └─ scripts/next-run.mjs start  预加载 readlink 补丁后启动
```

`build-if-needed.mjs` **按源码 mtime 判断**（`src`、`public`、`prisma/schema.prisma`、
`package.json`、next/tailwind/postcss 配置、`tsconfig.json`），不是"产物在就跳过"——
沙箱会复用上一次的环境，只看产物在不在会导致线上永远跑旧版本（DECISIONS 第 31 条）。

**发布后必须验证线上真的换了**，不能只看部署成功：

```bash
# 挑一个包含本次改动的 chunk，和线上逐字节比对
CH=$(grep -rl "本次新增的文案" .next/static/chunks | head -1)
curl -s -c /tmp/ck -o /dev/null "https://psymatch.app.workbuddy.host/?sharecode=Z355S3QUOQ"
curl -s -b /tmp/ck -o /tmp/oc.js "https://psymatch.app.workbuddy.host/_next${CH#.next}"
cmp -s "$CH" /tmp/oc.js && echo "IDENTICAL ✓" || echo "DIFFERENT ✗"
```

**本地 curl 要加 `--noproxy '*'`**：环境里设了 `HTTP_PROXY/HTTPS_PROXY=http://127.0.0.1:59778`，
访问 localhost 会被代理转发，服务活着也返回 502。

**线上是独立的 SQLite**，和本地 `prisma/dev.db` 不共享：线上注册的账号、发布的数据都在线上那份库里，
本地种子数据不会自动上去。要带数据上线得把 `prisma/dev.db` 一起打包。

**换 PostgreSQL**：`schema.prisma` 的 `provider` 改 `"postgresql"`，`DATABASE_URL` 换连接串，
`npx prisma db push`，其余不动。多实例部署时把 `src/server/scheduler.ts` 的进程内定时器换成
BullMQ + Redis 的 repeatable job，任务体可直接复用。

---

## 9. 版本与发布（GitHub）

仓库：<https://github.com/chentaozhng-max/minmax>（**公开**，`main` 分支）。
版本号规则写在 [CHANGELOG.md](./CHANGELOG.md) 顶部：对外可见的更新加一个小版本
（`v1.0` → `v1.1` → `v1.2`），结构性重做才升大版本。

一次版本发布 = **三处同步**：`package.json` 的 version、`CHANGELOG.md` 新条目、`git tag`。

```bash
# 1. 改版本号（同时更新 package-lock.json，不自动提交）
npm version 1.1.0 --no-git-tag-version

# 2. 在 CHANGELOG.md 顶部加一节 "## v1.1 — YYYY-MM-DD"

# 3. 提交 + 打标签（附注标签，别用轻量标签）
git add -A
git commit -m "release: v1.1"
git tag -a v1.1 -m "PsyMatch v1.1"
git push origin main --tags
```

然后在 GitHub 上把 tag 变成 Release（可写说明、附构建产物）：
`https://github.com/chentaozhng-max/minmax/releases/new?tag=v1.1`

**永远不要提交**：`.env`（密钥）、`prisma/dev.db`（数据库）、`.workbuddy/`（本机环境笔记）、
`node_modules/`、`.next/`、`shots/`、`cloudflared.exe`。这些都在 `.gitignore` 里，
新增敏感文件时先确认 `git status` 没有它。

**这个仓库是公开的**，提交前扫一眼有没有真实手机号、内网 IP、学号、token。
演示账号（138/139 开头）是种子数据，可以公开。

---

## 10. 已知未做（别当成 bug 报）

- 通知系统（短信 / 微信 / 站内红点），页面内状态与倒计时是有的
- 管理员后台（`/admin` 自然 404）
- 删除已有时段（会牵连预约与 `bookedCount`，只支持追加，见 DECISIONS 第 13 条）
- 真实 SMTP 投递（当前 mock）
- 学科筛选（数据模型没有该字段，DECISIONS 第 6 条）
- 人脸实名认证（只有教育邮箱 + 学号/工号，主试叫「主试认证」，被试叫「学生认证」）

---

## 11. 出问题时先看这里

| 症状 | 大概率原因 | 处理 |
|---|---|---|
| 全站 500，日志 `did not initialize yet` | 缺 `node_modules/.prisma/client/index.js` | 停服务 → `npx prisma generate` |
| 页面样式全丢 / 布局错乱 | `.next` 是半成品 | 删 `.next` → 重新 build（可能要重试） |
| 构建 `EPERM ... query_engine-windows.dll.node` | 服务没停 | 停 3000 端口进程再 build |
| 构建 `ENOENT _buildManifest.js.tmp.*` | 文件系统 shim 或 E 盘抖动 | 重试 2–3 次 |
| 登录成功又跳回登录页 | Cookie 被 `Secure` 丢掉 | 确认走的是 `isSecureRequest`，或改用 https |
| 线上打开还是旧版 | 沙箱复用了旧 `.next` | 确认 `build-if-needed.mjs` 打了"源码比构建产物新" |
| 本机 curl 502 但浏览器正常 | HTTP 代理 | 加 `--noproxy '*'` |
| `npm run dev` 一启动就崩 | 用了 `npx next dev` | 换回 `npm run dev` |
| 返回键一按就来回弹 | 有人给 `PageHeader` 传了 `Link` | 见 2.5 |

---

**改动流程建议**：读 `DECISIONS.md` 相关编号 → 改代码 → `tsc` + `npm test` (+ `npm run accept`)
→ 涉及 UI 截图自检 → 补 `DECISIONS.md` → 部署 → 线上逐字节核对。
