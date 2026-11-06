/**
 * 范围分类器的 LLM 实现 —— `ScopeClassifier` 端口的一个适配器。
 *
 * ## 为什么它自己建一个 LlmPort，而不是复用主对话那个
 *
 * 二二定的「小模型 = 用主模型，但做好定义」。分类只要 20 个 token 的输出，
 * 却和主对话共用模型名的话，将来想换一个更便宜的分类模型就得改应用层。
 * 所以这里读 `SCOPE_MODEL`（没配就回落到 `LLM_MODEL`），
 * 通过 `createLlm()` 造一个独立实例 —— 换模型只改环境变量。
 *
 * ## 三条铁律
 *
 * 1. **不抛异常。** 端口契约要求的。任何失败都降级成 IN_SCOPE（放行）。
 *    这一层是体验优化，分类器挂了把用户挡在门外是拿体验换一个
 *    本来就不该靠它保证的东西。
 * 2. **超时短。** 3 秒。用户等多 3 秒才看到「我不知道你在说什么」，
 *    体验比直接放行进主模型差得多。
 * 3. **输出不可信。** 模型可能回一段解释、包一层 ```json、多写字段。
 *    解析上尽量宽容（抓第一个 JSON 对象），取值上尽量严格
 *    （未知枚举值一律当 IN_SCOPE，见 `normalizeVerdict`）。
 */
import type { LlmPort } from "@/domain/ports/llm";
import type { ScopeClassifier } from "@/domain/ports/scope-classifier";
import { normalizeVerdict, type ScopeVerdict } from "@/domain/scope-guard";
import { createLlm, type EnvLike } from "./index";

/** 分类器超时。超过这个时间收益就转负了 —— 主模型已经能开始干活 */
export const SCOPE_TIMEOUT_MS = 3000;

/**
 * 输出上限 60 token。
 *
 * 我们的目标输出是 `{"scope":"IN_SCOPE","reason":"..."}`，约 15 个 token。
 * 给到 60 是留余量，同时**故意卡死**让它没机会写一段分析 ——
 * 上限本身就是一种提示词。
 */
const SCOPE_MAX_TOKENS = 60;

/**
 * 提示词。
 *
 * 三类分开写清楚，并给出**边界例子**而不是抽象定义。
 * 小模型对「什么算沾边」这类模糊判断，例子比定义有用得多。
 */
const SYSTEM_PROMPT = `你是「心理学实验报名平台」的话题范围分类器。判断用户这句话属于哪一类，只输出 JSON。

四类：
- IN_SCOPE：在找实验、问报名条件、问时间地点报酬、查自己的预约、问怎么取消。
- ADJACENT：在描述自己的状态（睡眠、情绪、压力、注意力、饮食习惯），但没提找实验。这类人来对地方了，只是还没说到正题。
- OUT_OF_SCOPE：与心理学实验报名无关的任何事。例如：游戏攻略、编程作业、写论文、情感咨询、心理创伤倾诉与治疗建议、算命、闲聊八卦、问你是谁/什么模型。
- CRISIS：表达自伤、自杀、不想活。

判定要点：
- 「我最近好焦虑」→ ADJACENT（在描述状态，可能是目标人群）
- 「我该怎么缓解焦虑」→ OUT_OF_SCOPE（在要治疗方案，不是找实验）
- 「我想找个关于睡眠的实验」→ IN_SCOPE
- 「星穹铁道怎么配队」→ OUT_OF_SCOPE
- 「我和男朋友吵架了怎么办」→ OUT_OF_SCOPE

只输出这个 JSON，不要任何解释、不要 markdown 代码块：
{"scope":"IN_SCOPE","reason":"不超过15字的依据"}`;

export type LlmScopeClassifierOptions = {
  llm: LlmPort;
  timeoutMs?: number;
};

export class LlmScopeClassifier implements ScopeClassifier {
  private readonly llm: LlmPort;
  private readonly timeoutMs: number;

  constructor(opts: LlmScopeClassifierOptions) {
    this.llm = opts.llm;
    this.timeoutMs = opts.timeoutMs ?? SCOPE_TIMEOUT_MS;
  }

  configured(): boolean {
    return this.llm.configured();
  }

  /** 永远不抛异常；任何失败都降级成放行 */
  async classify(text: string): Promise<ScopeVerdict> {
    if (!this.llm.configured()) {
      return { kind: "IN_SCOPE", reason: "分类器未配置" };
    }

    try {
      const reply = await this.withTimeout(
        this.llm.chat({
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: text.slice(0, 500) },
          ],
          // 分类不需要工具 —— 传空数组而不是省略，因为端口签名要求
          tools: [],
          temperature: 0,
          maxTokens: SCOPE_MAX_TOKENS,
        }),
      );
      return normalizeVerdict(extractJson(reply.content));
    } catch {
      // 超时 / 网络 / 限流 / 畸形响应，一律放行。
      // 这里不区分异常类型：都是「分类这件事没做成」，处理方式完全一样。
      return { kind: "IN_SCOPE", reason: "分类失败，已放行" };
    }
  }

  /**
   * 超时保护。
   *
   * 注意：这里只**放弃等待**，不会取消底层请求（LlmPort 没有 abort 能力）。
   * 后果是多一个悬挂的 fetch，会在自己的超时后自然结束。
   * 这是有意的取舍 —— 为了 3 秒的响应预算给端口加 abort 参数，
   * 会让所有实现都要改，收益不匹配。
   */
  private async withTimeout<T>(promise: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("scope classifier timeout")), this.timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

/**
 * 从模型输出里捞出 JSON 对象。
 *
 * 宽容解析：模型经常包一层 ```json、或者在 JSON 前后加一句「好的，我的判断是」。
 * 抓第一个 `{` 到最后一个 `}` 是最省事且够用的做法 ——
 * 反正取到的内容还要过 `normalizeVerdict` 的严格校验。
 */
export function extractJson(content: string): unknown {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(content.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * 工厂。
 *
 * `SCOPE_MODEL` 没配时回落到 `LLM_MODEL` —— 也就是二二说的「小模型先用主模型」。
 * 但走的是**独立的 LlmPort 实例**，所以将来配一个便宜模型只改环境变量。
 */
export function createScopeClassifier(env: EnvLike = process.env): ScopeClassifier {
  const llm = createLlm({
    ...env,
    LLM_MODEL: env.SCOPE_MODEL || env.LLM_MODEL,
  });
  return new LlmScopeClassifier({ llm });
}
