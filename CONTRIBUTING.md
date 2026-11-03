# CONTRIBUTING.md — 一起改这个仓库

> **先读 [AGENTS.md](./AGENTS.md) 第 3–4 节**（目录地图 + 分层判据）。那份是操作手册，
> 这份只讲「两个人同时改，怎么不打架」。
>
> 当前协作分工：**被试端**由协作者主导，主试端与领域规则由仓库所有者维护。

---

## 1. 第一次拿到代码

```bash
git clone https://github.com/chentaozhng-max/minmax.git
cd minmax
npm install
npm run setup      # 自动补 .env + 建库 + 灌种子，不用手动创建任何配置
npm run dev        # http://localhost:3000
```

演示账号在 AGENTS.md 第 1 节，验证码统一 `123456`。
没配 `LLM_API_KEY` 也能完整使用（自动降级成表单/直接搜索）。

---

## 2. 开工前：先认领一块地方

两个人改同一个文件，冲突是必然的。按目录分工：

| 区域 | 谁主导 | 说明 |
|---|---|---|
| `src/app/` 被试页面（`/`、`/appointments`、`/me`、`/experiments/[id]`、`/assistant`） | 协作者 | 被试端主战场 |
| `src/components/` 被试相关组件 | 协作者 | 新建组件放这里 |
| `src/app/` 主试页面（`/r/**`） | 所有者 | 发布链路、日程、申诉 |
| `src/domain/` | **改之前先说** | 主试端和被试端共用：信誉分、报名资格、状态机、Zod schema |
| `src/adapters/db/prisma/page-query*` | **改之前先说** | 所有页面共用的读端口，一改两边一起受影响 |
| `prisma/schema.prisma` | **改之前先说** | 一动就要全队重建库 |
| `scripts/`、`tests/` | 谁改谁加 | 新规则必须带单测 |

**要动共享区域时**：先在群里/issue 里说一句「我要在 `domain/booking-rules.ts` 加 X」，
对方同一时间别碰这个文件。这比事后解冲突便宜十倍。

---

## 3. 分支怎么开

```bash
git checkout main
git pull                      # 永远从最新 main 切出去
git checkout -b feat/subject-profile
```

命名：`feat/` 新功能、`fix/` 修 bug、`docs/` 文档、`refactor/` 重构。

**`main` 已开分支保护，直接推会被 GitHub 拒掉**（`protected branch hook declined`）。
所有改动走 PR，需要 1 个批准才能合并。理由不是流程好看，
是「主试端已经能用，任何一次直接推都可能把演示环境搞挂」。

---

## 4. 提交前必须跑

```bash
npx tsc --noEmit     # 零输出才算过
npm test             # 会先自动跑 lint:layers，再跑单测
```

判据是**看到数字**，不是「没报错」：

```
✅ check-layers: 197 个文件通过（L1–L7）
Test Files  54 passed (54)
     Tests  591 passed (591)
```

动了预约 / 信誉 / 签到 / 取消的，加跑：

```bash
npm run accept       # 62 项数据库级验收（会写真库，别在生产库上跑）
```

只改 UI 的，再自己打开看一眼 375px 宽度有没有横向滚动。

---

## 5. 提 PR

推分支 → GitHub 上开 PR，目标 `main`。描述写三行就够：

```
改了什么：被试「我的预约」加了按状态筛选
为什么：预约多了以后翻不到已完成的
怎么验的：npm test 全绿；375 宽截图无横向溢出
```

review 通过后由所有者合并，**合并方式用 squash**（一条 PR 压成一个提交，历史干净）。

---

## 6. 最容易踩的五个坑

1. **在 `src/domain/` 里 `import prisma`** —— 领域层零外部依赖，L1 会直接红。
   需要数据就在 `src/domain/ports/` 加接口，实现放 `src/adapters/`。
2. **业务判断写进 route handler** —— handler 只做「鉴权 → 校验 → 转发」，≤40 行。
   规则写进 `src/domain/` 的纯函数。
3. **页面里直接 `prisma.` 查数据** —— 用 `ports/page-queries.ts` 的端口，
   否则 L6 基线会涨，`npm test` 拦你。
4. **改了 `schema.prisma` 没重新生成** —— `tsc` 会过、运行时 `undefined`。
   停服务 → `npx prisma generate` → 用 `typeof p.新模型` 验一下。
5. **返回箭头用 `<Link>` 硬跳** —— `PageHeader` 的 `back` 走 `router.back()`，
   硬跳会让「消息 ⇄ 对话」来回弹。底部 tab 的根页面不要挂返回箭头。

---

## 7. 跟主分支同步

```bash
git fetch origin
git rebase origin/main      # 用 rebase，不要 merge main 进你的分支
```

有冲突就解完 `git add` + `git rebase --continue`。
卡住了别硬来：`git rebase --abort` 回到干净状态再问。

---

## 8. 不要提交的东西

`.env`（密钥）、`prisma/dev.db`（本地库）、`node_modules/`、`.next/`、`shots/`、
`*.log`。这些都在 `.gitignore` 里，新增敏感文件时先 `git status` 看一眼。

**仓库是公开的**，提交前扫一眼有没有真实手机号、内网 IP、学号、token。
演示账号（138/139 开头）是种子数据，可以公开。
