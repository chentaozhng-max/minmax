/**
 * 范围闸（领域层纯函数）—— 零 IO。
 *
 * ## 它负责什么
 *
 * 判断用户这句话「在不在本平台的业务范围里」。本平台是心理学实验的报名与排期，
 * 不属于它的东西（游戏、编程作业、情感咨询）不该占用主模型，也不该让助手
 * 顺着聊下去 —— 那既浪费 token，也会让用户误以为这里能解决任何问题。
 *
 * ## 它不负责什么
 *
 * **不做安全判断。** 真正的安全边界在后端校验和工具闸（`tool-policy.ts`）。
 * 这一层是体验优化：把显然跑题的话挡在主模型之外，省一次往返。
 * 所以它的降级方向永远是**放行**，不是拦截 —— 分类器挂了把人挡在门外，
 * 是拿体验换一个本来就不该靠它保证的东西。
 *
 * ## 为什么规则层只做这么少
 *
 * 规则能判的东西必须「高置信、可枚举」。凡是需要语义理解的
 * （「我最近好焦虑」算不算沾边），都不该用关键词硬猜 ——
 * 早期版本用 `/一|二|三/` 判星期，把「随便」里的「三」判成了周三。
 * 宁可交给模型分类，也不要在这里瞎猜。
 */

/**
 * 四态。
 *
 * `ADJACENT` 单独存在，是因为「我最近睡不好」这类话不该被当作跑题拒掉 ——
 * 用户其实在描述自己，正是实验要招的人，只是还没说到找实验。这时候
 * 该把话头引回去，而不是拒绝。
 */
export type ScopeKind = "IN_SCOPE" | "ADJACENT" | "OUT_OF_SCOPE" | "CRISIS";

export type ScopeVerdict = {
  kind: ScopeKind;
  /** 分类器给的一句话依据（规则层为 null）。只用于日志，不展示给用户 */
  reason?: string | null;
};

/** 本次拦截是第几次越界，决定用软话术还是硬话术 */
export type StrikeLevel = "first" | "repeat";

/* SECTION_COPY */

/**
 * 越界话术。
 *
 * ## 为什么分软硬两档、而不是一档到底
 *
 * 门厅是拉新的入口，用户从闲聊进来很常见（"你们这儿有啥实验"之前
 * 往往是"你好"）。第一次硬拒很可能直接流失。所以第一档是**拒 + 挽回**：
 * 明确说帮不上，但立刻给一个能做的事。
 *
 * 但连着第二次还越界，就是**在试探边界**了（或者拿它当免费聊天机器人）。
 * 这时候挽回反而是在鼓励，换成只陈述范围的硬话术。
 *
 * ## 为什么话术是常量而不是让模型生成
 *
 * 模型很容易把拒绝说成「我理解你的感受，但……」，然后顺手给一段安慰 ——
 * 那就变成情感咨询了，正好是要防的东西。拒绝这件事必须固定。
 */
export const OUT_OF_SCOPE_REPLY =
  "我只负责心理学实验的报名和排期，这个问题帮不上忙。要不要看看现在有哪些实验可以参加？";

export const OUT_OF_SCOPE_HARD_REPLY =
  "我只负责心理学实验的报名和排期。需要找实验的话，直接说你的时间条件就行。";

/**
 * 沾边（ADJACENT）时附加在助手回复末尾的引导语。
 *
 * 不做拦截，只是提醒用户这里还能干正事 —— 用 append 而不是 replace，
 * 是因为用户描述自己的状态本身是合理的，只是还没说到找实验。
 */
export const ADJACENT_HINT = "如果你想参加心理学实验，告诉我方便的时间，我帮你找找。";

/** 按越界次数挑话术 */
export function outOfScopeReply(level: StrikeLevel): string {
  return level === "first" ? OUT_OF_SCOPE_REPLY : OUT_OF_SCOPE_HARD_REPLY;
}

/* SECTION_RULES */

/**
 * 危机关键词表 —— **本期默认关闭**（`CRISIS_KEYWORDS_ENABLED = false`）。
 *
 * 二二定的「危机暂时不处理」：这一版只把位置留好，不查不拦。
 * 留着它的价值是函数签名不用改 —— 将来要接的时候，把开关打开、
 * 补上话术与转人工路径即可，调用方一行不动。
 *
 * ⚠️ 万一要开，必须配**固定文案 + 转人工**，绝不能让主模型生成：
 * 模型很可能说「我理解你的痛苦」然后给建议，这在伦理上是灾难。
 * 拒绝跑题只是体验差，这件事接错了是安全事故。
 */
export const CRISIS_KEYWORDS_ENABLED = false;

const CRISIS_KEYWORDS = ["不想活", "自杀", "自残", "结束生命", "活着没意思"];

/**
 * 规则层。返回 null = 「规则判不了，交给分类器」。
 *
 * 只有两种情况会返回非 null：
 *   1. 危机词命中（且开关打开）
 *   2. 空串 / 纯标点 / 纯空白 —— 明显没有任何意图，直接当 IN_SCOPE 放行，
 *      省一次模型调用（这种输入主模型也能妥善处理）
 *
 * 除此之外一律 null。**这就是「宁可交给模型，也不要瞎猜」的具体落地。**
 */
export function ruleScreen(text: string): ScopeVerdict | null {
  const t = text.trim();

  // 没有任何实质内容：不浪费一次模型调用
  if (t.length === 0 || !/[\p{L}\p{N}]/u.test(t)) {
    return { kind: "IN_SCOPE", reason: "空输入" };
  }

  if (CRISIS_KEYWORDS_ENABLED && CRISIS_KEYWORDS.some((word) => t.includes(word))) {
    return { kind: "CRISIS", reason: "命中危机关键词" };
  }

  return null;
}

/**
 * 把分类器的原始输出归一成可信的 verdict。
 *
 * 分类器的输出是不可信的输入（模型可能回畸形 JSON、多写一个字段、
 * 给一个不存在的枚举值）。这里把所有异常都收敛到 **IN_SCOPE 放行** ——
 * 放行的代价是多花一次主模型调用，拦截的代价是把用户挡在门外。
 */
export function normalizeVerdict(raw: unknown): ScopeVerdict {
  if (!raw || typeof raw !== "object") return { kind: "IN_SCOPE", reason: "分类器输出无法解析" };
  const scope = (raw as Record<string, unknown>).scope;
  const reason = (raw as Record<string, unknown>).reason;

  const known: ScopeKind[] = ["IN_SCOPE", "ADJACENT", "OUT_OF_SCOPE", "CRISIS"];
  if (typeof scope !== "string" || !known.includes(scope as ScopeKind)) {
    return { kind: "IN_SCOPE", reason: "分类器返回了未知取值" };
  }

  return {
    kind: scope as ScopeKind,
    reason: typeof reason === "string" ? reason.slice(0, 40) : null,
  };
}

/* SECTION_DECIDE */

/**
 * 本轮内的越界计数。
 *
 * ## 为什么是「本轮」而不是「这个人」
 *
 * 二二的原话：「本轮内两次就行，总不能他一开始只是玩玩，弄得新开 session
 * 都没法预约实验了。」
 *
 * 挂在用户身上（存库）会让一次好奇的试探永久污染账号；挂在会话上
 * 又会让「关掉标签页重开」绕过限制。挂在**这一轮请求**上两头都对：
 * 同一次交互里连试探两次立刻升硬拒，而换一轮（甚至换一天）又是干净的。
 */
export type StrikeCounter = { outOfScope: number };

export function nextStrike(counter: StrikeCounter, kind: ScopeKind): StrikeCounter {
  // 只数越界。ADJACENT 是正常表达，不该累计 —— 否则描述自己身体状况的人
  // 两句就被当试探者。
  if (kind !== "OUT_OF_SCOPE") return counter;
  return { outOfScope: counter.outOfScope + 1 };
}

/** 这一次该用软话术还是硬话术 */
export function strikeLevel(counter: StrikeCounter): StrikeLevel {
  return counter.outOfScope > 1 ? "repeat" : "first";
}

/**
 * 该不该真的把这一轮拦下来（不进主模型）。
 *
 * `ADJACENT` 永远放行（只是末尾引导一句）；`CRISIS` 本期不可能出现
 * （规则层开关关闭），留在这里是为了将来打开开关时行为明确。
 */
export function shouldBlock(verdict: ScopeVerdict): boolean {
  return verdict.kind === "OUT_OF_SCOPE" || verdict.kind === "CRISIS";
}
