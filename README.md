# PsyMatch

心理学实验的「招聘—应聘」平台。主试放出实验和可约时段，被试说一句"周三下午有空"，
排期助手把它落到具体时段上，然后走两段式确认、现场签到、信誉分结算。

移动端优先（375×812 起），界面全中文。

---

## 快速开始（3 条命令）

```bash
npm install
npm run setup     # 生成 Prisma Client + 建库 + 灌种子数据
npm run dev       # http://localhost:3000
```

> 国内网络建议加镜像：`npm install --registry=https://registry.npmmirror.com`
> `dev / build / start` 都经过 `scripts/next-run.mjs` 包装（预加载一个 readlink 补丁，
> 见 `DECISIONS.md` 第 18 条），直接用 `npx next dev` 在本机会失败，用 npm script 就没问题。

### 演示账号（验证码统一 `123456`）

| 角色 | 姓名 | 手机号 | 看点 |
|---|---|---|---|
| 主试 | 陈砚 | 13800000001 | 信誉 100，5 个实验，10 个容量 1 的时段 |
| 主试 | 谢秋池 | 13800000002 | 信誉 55 → 实验在列表末尾 + 灰标 |
| 被试 | 林知夏 | 13900000001 | 信誉 100，有 1 条待处理申诉 |
| 被试 | 周叙 | 13900000002 | 信誉 100，干净账号 |
| 被试 | 许一然 | 13900000003 | 信誉 72 + 未认证 → 报不了门槛 80 的实验 |
| 被试 | 沈栗 | 13900000004 | 累计 3 次未到场，禁报名中 |

### 3 分钟演示路径

1. `13900000001` 登录 → 首页卡片流（含"主试信誉较低"灰标那条在最后）
2. 点「面孔吸引力判断实验」→ 详情页看时段格子 → 「立即预约」
3. 对排期助手说「我周三下午有空」→ 它给出 2-3 个候选 → 点「就这个」
4. 去「我的预约」→ 待我确认 → 确认
5. 换 `13800000001`（主试）登录 → 我的实验 → 点进实验 → 确认预约
6. 回被试端 →「到场签到」（一键，不需要码）→ 主试点「确认到场」→ 双方信誉分 +1
7. 主试端还有一条待处理申诉（林知夏），可现场演示「驳回 / 认了」
8. 主试详情页右上角「编辑」→ 改报名截止 / 批量追加时段 / 下架与重新发布

---

## 目录

```
prisma/schema.prisma     数据模型（SQLite 本地 / PostgreSQL 部署通用）
prisma/seed.ts           种子：2 主试 + 4 被试 + 5 实验
src/app/                 页面与 API（App Router）
  api/                   全部服务端校验都在这里
  experiments/[id]/chat/ 排期 Agent 对话页（核心）
src/server/              业务服务层
  agent.ts               工具定义 + LLM 循环 + 降级
  appointments.ts        预约状态机、防超卖、取消结算
  credit.ts              信誉分落库
  scheduler.ts           定时任务（禁期清空 / 主试提醒 / 申诉自动成立）
src/lib/                 纯逻辑（可单测）
  credit.ts              信誉分规则
  matching.ts            撮合排序 + 模糊时间解析
tests/                   单测
scripts/acceptance.ts    数据库级验收脚本（防超卖 / 取消结算）
```

---

## 四个核心机制

### 1. 防超卖（并发安全）

`src/server/appointments.ts`：

```ts
const affected = await tx.$executeRaw`
  UPDATE "Slot" SET "bookedCount" = "bookedCount" + 1
  WHERE "id" = ${slot.id} AND "bookedCount" < "capacity"
`;
if (affected === 0) throw new ApiError(409, "这个时段刚刚被约满了，换一个吧");
```

条件 UPDATE 与建单在同一个事务里，影响行数为 0 就整体失败。

### 2. 撮合排序不交给模型

`src/lib/matching.ts` 的 `rankSlots` 先排好：被试提到的时间段 > 剩余容量多（均衡负载）> 距现在更近。
排好的顺序注入 System Prompt，模型只负责用自然语言解释和追问，**不能自己造时间**。
时段 id 只能来自工具返回，`book_slot` 会再校验一次 id 是否在候选集合里。

### 3. 非 LLM 降级（验收项）

`LLM_API_KEY` 为空、超时（25s）、或接口报错时，聊天接口返回 `mode: "form"`，
前端自动换成时段多选表单，提交后走**同一个** `bookSlot()` 服务函数。
另有 12 轮对话上限，超出也切到表单。

### 4. 主试取消的 24 小时线是逐条的

```ts
for (const appointment of affected) {
  const late = shouldPenalizeResearcherCancel(appointment.slot.startAt, now);
  await tx.appointment.update({ ... status: "CANCELLED_BY_RESEARCHER" });
  if (late) await penalizeTx(tx, { ... });   // 只对这一条 -2
}
```

同一场实验里 48 小时后的一场不扣分、2 小时后的一场扣分，两种结果并存。

---

## 验收自测

自动化部分：

```bash
npm test       # 34 个单测：信誉分 / 24h 判断 / 撮合排序 / 模糊时间解析
npm run accept # 22 项数据库级检查：防超卖 / 分时段 / 禁期阶梯 / 取消结算 / 签到 / 申诉超时
```

`npm run accept` 当前输出：

```
[1] 并发抢同一个容量 1 的时段   ✅ 只有 1 次成功，bookedCount=1，失败方提示"刚被约满"
[2] 三名被试分到不同时段         ✅ 三个时段互不相同
[3] 未到场禁期阶梯               ✅ 1/1/1/7/7 天
[4] 主试取消逐条结算             ✅ 100→98，noShowCount +1，只写 1 条 CreditEvent
[5] 一键签到 → 确认到场           ✅ CHECKED_IN → COMPLETED，双方各 +1
[6] 申诉 48h 自动成立             ✅ UPHELD，主试 -2，noShowCount +1
结果：22 通过 / 0 失败
```

| # | 验收项 | 状态 |
|---|---|---|
| 1 | 375px 无横向滚动、无遮挡 | 布局按 375 基准实现，`body` 锁横向滚动；建议真机过一遍 |
| 2 | 三人被分到不同时段 | ✅ 自动化通过 |
| 3 | 同容量 1 时段两个并发只成功 1 个 | ✅ 自动化通过 |
| 4 | 已有预约的时段不重复分配 | ✅ 单测 + 服务层冲突校验 |
| 5 | 关闭 LLM key 自动降级表单 | ✅ 代码路径；清空 `.env` 的 `LLM_API_KEY` 重启即可复现 |
| 6 | 标记未到 → -2 / 次数 1 / 禁 1 天 | ✅ 自动化通过 |
| 7 | 第 2、3 次未到场禁 1 天 | ✅ 自动化通过 |
| 8 | 第 4、5 次禁 7 天 | ✅ 自动化通过 |
| 9 | 禁期内报名 / 发布返回 403 | ✅ 服务端硬校验（`checkEligibility` 单测覆盖） |
| 10 | 签到 → 主试确认到场 → 双方 +1（不超 100） | ✅ 自动化通过（无签到码，一键签到） |
| 11 | 信誉 72 报 80 的实验：置灰 + 403 | ✅ 单测覆盖文案与判定；前端 CTA 同源逻辑 |
| 12 | 未认证报名 needsVerification 实验 403 | ✅ 单测覆盖 |
| 13 | 教育邮箱验证码 + 认证徽章 | 已实现，验证码打到控制台与 `mock-email.log` |
| 14 | 主试取消：全 ≥24h 不扣 / 有 <24h 只扣那些 / 并存 | ✅ 自动化通过（含 b、c 两种混合场景） |
| 15 | 申诉 48h 无回应自动 UPHELD 并结算主试 | ✅ 自动化通过（`jobAutoUpholdAppeals`） |
| 16 | 主试信誉 <60 的实验排在末尾 + 灰标 | 已实现（`listExperimentCards` 排序），seed 里谢秋池那条可看 |
| 17 | 刷新聊天页保留历史 | 已实现（`ChatSession.messages` 持久化） |

---

## 移动端视觉自检（375×812）

`scripts/shoot.mjs` 用 CDP 驱动无头 Edge，按 375×812 逐页截图，同时打印每一页的
`scrollWidth`，用来抓横向溢出。

```bash
# 1. 需要一个开了自测登录的实例（该接口默认 404，只有显式开启才生效）
ENABLE_DEV_LOGIN=true npm start

# 2. pages.txt 每行 "名字 路径"，第一行先过 /api/dev/login 拿 cookie
cat > shots/pages.txt <<EOF
bridge /api/dev/login?phone=13900000001&to=/
home /
me /me
EOF

node scripts/shoot.mjs http://localhost:3000 shots shots/pages.txt
```

输出里出现 `OVERFLOW` 就说明该页有元素把布局撑宽了。

---

## 环境变量

复制 `.env.example` 为 `.env`，关键是这三项：

```
LLM_BASE_URL=https://api.deepseek.com
LLM_API_KEY=sk-...
LLM_MODEL=deepseek-chat
```

**key 不进 git**（`.env` 已在 `.gitignore`）。留空则自动进入降级表单模式，功能完整可用。

其余：`DATABASE_URL`、`JWT_SECRET`、`JWT_REFRESH_SECRET`、`EDU_EMAIL_DOMAINS`、`SMTP_*`（未配置时走 mock 邮件）。

---

## 部署到服务器

本项目本地用 SQLite 是为了"一条命令跑起来"，代码本身没绑死：

1. `prisma/schema.prisma` 的 `provider` 改成 `"postgresql"`
2. `.env` 的 `DATABASE_URL` 换成 `postgresql://user:pass@host:5432/psymatch`
3. `npx prisma db push`（或 `migrate deploy`），然后 `npm run build && npm start`

字段名、索引、唯一约束、防超卖 SQL 在 PostgreSQL 上语义一致。多实例部署时把
`src/server/scheduler.ts` 换成 BullMQ + Redis 的 repeatable job，任务体可以直接复用。

---

## 已知未做

- 通知系统（短信 / 微信 / 站内红点）——本期明确不做，页面内状态、Tab、倒计时都在
- 管理员后台（`/admin` 自然 404）
- 删除已有时段（会牵连预约与 `bookedCount`，见 `DECISIONS.md` 第 13 条）
- 真实 SMTP 投递（现在 mock：验证码打到控制台与 `mock-email.log`）
- 学科筛选（数据模型没有该字段，见 `DECISIONS.md` 第 6 条）

更多取舍见 [DECISIONS.md](./DECISIONS.md)。
