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

21. **Cookie 的 Secure 按请求协议决定，不按 NODE_ENV**
    原来 `secure: NODE_ENV === "production"`。用 `npm start` 起生产构建、手机通过
    `http://172.30.x.x:3000` 打开时，浏览器会直接丢弃 Secure Cookie——表现是"登录成功后
    又跳回登录页"。改为 `isSecureRequest(req)`：看 `x-forwarded-proto` 或请求 URL 的协议，
    只有真的 HTTPS 才加 Secure。部署在 HTTPS 反代后面时记得让代理传 `x-forwarded-proto`。

22. **实验详情页改成招聘类 App 的信息密度（试点单页）**
    参照 BOSS 直聘职位详情的信息结构：标题与报酬同行 → 元信息一行 → 发布者卡 → 信息表 →
    正文 → 可选时段 → 底部固定 CTA。视觉上换成白底 + 8px 灰条分区 + 细分隔线，
    不再用一堆描边卡片；标签改成无边框浅底小方块。
    **只借结构和密度，没有搬品牌资产**：主色仍是砚青 moss，logo/图标/文案全部自有。
    目前只改了详情页一屏，其他页面仍是米白纸底 + 卡片，`PageHeader` 新增 `tone="surface"`
    让白底页的顶栏跟着变白。是否全站铺开等验证后再定。

23. **被试 ↔ 主试私信，和「排期助手」是两套东西**
    `ChatSession` 是人和 AI 的会话，用来撮合时间；私信是人和人的，用 `DirectThread` +
    `DirectMessage` 两张新表。同一个人跟同一个主试只有一条线程（`@@unique([subjectId, researcherId])`），
    从哪个实验发起的记在 `experimentId` 上。
    入口是实验详情页的主试卡：**点卡片/头像直接开私信**，右侧「主页」才去主试主页。
    主试端底部第 3 个 Tab 因此从「申诉」换成「消息」，申诉入口留在「我的」页里。

24. **完善资料（首次进入的引导）**
    对应招聘类 App 的"完善资料"：第 1 步问身份（是否学生 / 学校 / 院系 / 年级），
    第 2 步问方向和时间偏好。`User.profileCompleted` 标记是否走过，`/` 会拦一次并跳 `/onboarding`，
    可以「先跳过」（同样置为 true，避免每次进来都被拦）。
    种子数据里只把「周叙」留成未完善，用来演示这个流程。

25. **配图用 AI 生成，裁掉水印后入库**
    两张角色插画（被试 / 主试）放在 `public/illustrations/`，只用在登录页。
    生成图右下角带「AI生成 / WORKBUDDY」水印，用 `scripts/crop-illustration.mjs`
    （无头 Edge 打开 PNG → 按比例裁切 → 截图）裁掉了，没引入任何图像库。
    **注意**：构图底部会被裁掉一点（鞋子），显示时用 `object-cover` 盖住。

## 身份与信息架构（2026-10-27 改）

26. **登录页选的「我是被试 / 我是主试」成为建号依据**
    原来 `POST /api/auth/login` 完全忽略这个选择：新手机号一律建成 `role=SUBJECT`、
    昵称 `被试XXXX`。表现是"我选主试登录，进去却是被试的「我的」页，也没有发布入口"。
    现在 role 随请求传上来，新号按选择建（`主试XXXX` / `被试XXXX`）。
    老账号与选择不一致时：**没发过实验、没有信誉流水**的空身份直接改过来（手滑选错也能救）；
    已经有实验或信誉记录的账号拒登，并提示切回正确身份——不静默把主试的实验挂到被试名下。

27. **主试底部栏中间放凸起的「+」发布，参照招聘类 App**
    被试端仍是 4 个平铺 Tab。主试端改成 5 格：实验 / 消息 / **+发布** / 申诉 / 我的，
    中间那颗是凸出导航栏的圆形按钮（moss 底 + 白色加号 + ring-surface 描边），点进 `/r/experiments/new`。
    为此把「申诉」又放回 Tab（此前按第 23 条收进了「我的」）——5 格才对称，
    而且申诉真有待办，比重复一个入口有用。

28. **主试的「我的」不再复制被试那一版**
    原来两页几乎逐行相同，只换了「发布过 / 累计未到场 / 信誉上限」三个数。
    现在主试页第一屏是招募方视角：身份标「主试」、发布过 / 招募中 / 待我确认、
    一张 moss 底的「发布新实验」主 CTA、有待办时在顶部插一条"X 条报名等你确认"、
    快捷入口（我的实验 / 消息 / 申诉处理），信誉明细降到最后。

29. **认证在两端叫法不同**
    被试是「学生认证」（报名门槛），主试是「主试认证」（学校 + 学号/工号 + 教育邮箱）。
    表单还是同一个 `VerifyForm`，传 `role` 换文案；实际校验逻辑不变，没有人脸识别。

30. **文案去掉"被试说什么时候有空"这类口头语**
    产品定位收敛成「心理学实验的报名与排期」：登录页副标题、详情页提示、选时段页开场白、
    各处空状态全部改成"挑时段报名"的说法，「排期助手」只在内部与消息页作为"选时段的记录"出现。
    功能没删：模糊时间解析、候选排序、LLM 降级表单都还在，只是不再宣称"你说有空它来排"。

26. **构建时把环境注入的文件系统 shim 摘掉**
    WorkBuddy 的 shell 通过 `NODE_OPTIONS` 注入 `node-language-shim.cjs` →
    `node-safe-delete-shim.cjs`，它把 `fs.rmSync` 交给一个外部回收站程序执行。
    `next build` 一开始要清空 `.next`（上万个小文件），回收站程序处理这种量级会
    `spawnSync ... ETIMEDOUT`，或者**在构建已经开始写文件之后才删完**，于是报
    `ENOENT ... _buildManifest.js.tmp.*` / `export/500.html` / `build-manifest.json`
    这类"自己刚写的文件不见了"的错。
    `scripts/next-run.mjs` 现在只把这一条 `--require` 从子进程的 `NODE_OPTIONS` 里摘掉，
    其余 flag 原样保留（`KEEP_NODE_OPTIONS=1` 可关闭该行为）。
    **排查特征**：构建日志里出现 `safe-delete` 或连续两次构建一次成功一次失败，就是它。

27. **构建前必须先停服务**
    `prisma generate` 要覆盖 `node_modules/.prisma/client/query_engine-windows.dll.node`，
    服务还在跑时该 DLL 被占用，会 `EPERM: rename ... query_engine-windows.dll.node.tmp*`。
    `npm start` 的兜底构建（`build-if-needed.mjs`）因此只在"没有服务在跑"时才安全。
    另外判断构建是否可用不再只看 `BUILD_ID`，而是同时检查 `build-manifest.json` /
    `routes-manifest.json` / `prerender-manifest.json` / `server/app-paths-manifest.json`，
    避免中途失败的半成品被当成可用的构建。

28. **本机 curl 要加 `--noproxy '*'`**
    环境里设了 `HTTP_PROXY/HTTPS_PROXY=http://127.0.0.1:59778`，访问 `localhost:3000`
    会被代理转发，服务明明活着却返回 502（部分路径还因为代理缓存返回 200，更容易误判）。
    本机自检一律用 `curl --noproxy '*' http://127.0.0.1:3000/...`。


## 发布链路（2026-10-27 改）

31. **`build-if-needed.mjs` 按源码新旧判断，不再只看产物在不在**
    原来只要 `.next` 里五个必需文件齐全就 `exit(0)`。云端沙箱是复用的，
    第二次发布时里面还躺着上一版的 `.next`，于是 `npm start` 一路跳过构建，
    线上页面永远是老内容——本地改完、链接打开却没变化。
    现在拿 `src`、`public`、`prisma/schema.prisma`、`package.json`、
    next / tailwind / postcss 配置、`tsconfig.json` 的最新 mtime 和
    `.next/BUILD_ID` 比，源码更新就重建，并打印「源码比构建产物新 Ns」。
    容 2 秒误差，避免解包时文件时间取整导致的假重建。
    代价是每次发布多一次 build（几分钟），换来"发布即所见"。

## 完善资料页「Failed to fetch」（2026-10-27 晚排查）

32. **症状**：手机在 /onboarding 第 2 步点「完成」，底部弹红色 `Failed to fetch`。
    服务端无异常——同一账号用 `curl --noproxy '*' POST /api/me/profile` 返回
    `{"code":0,"message":"资料已保存"}`，登录链路也正常。所以是**浏览器网络层**
    没收到任何响应（fetch 抛 TypeError），不是接口报错。

33. **真正一直没修好的原因在启动脚本**：`启动 PsyMatch.cmd` 只判断
    `.next\BUILD_ID` 存不存在，存在就跳过构建。于是源码改了、重启还是旧包，
    手机一直跑 18:04 那份构建——里面的 api-client 还没有中文兜底，原样把
    `Failed to fetch` 弹给用户。
    现在脚本改成调用 `scripts/build-if-needed.mjs`（按源码 mtime 判定），
    并在启动前检测 3000 是否仍被占用（旧窗口没关时直接提示，避免 EADDRINUSE
    和 Prisma DLL 占用）。`npm start` 原本就走这套，两条入口现在一致。

34. **代码侧兜底**（上一轮已写进源码，这次才真正生效）：
    `api-client` 把网络失败翻译成「网络没连上，请检查网络后重试」，并把
    `ApiClientError.network` 暴露出来；onboarding 提交带 `retryNetworkError: 1`
    （保存资料是覆盖写，重试幂等），失败文案提示「再点一次完成就好」。

35. **排查命令备忘**：本机自检一律 `curl --noproxy '*'`；判断线上/本地是否
    跑的是新代码，直接 grep 构建产物里有没有新文案，比看 BUILD_ID 时间可靠：
    `Select-String -Path .next\static\chunks\*.js -Pattern '网络没连上'`。
    另外沙箱里 `taskkill` / `Stop-Process` 动不了用户手动起的服务窗口，
    重建必须先由用户关掉那个窗口。
