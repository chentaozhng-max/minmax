/**
 * 范围闸的应用层编排 —— 把「规则 → 分类器 → 计数 → 话术」串成一次判断。
 *
 * ## 为什么单独抽一层
 *
 * `agent.ts` 和 `assistant-agent.ts` 是两个不同的入口（房间 / 门厅），
 * 各有各的会话模型和降级路径，但「这句话该不该进主模型」的判断完全一样。
 * 写在两个 try 块里迟早会分叉 —— 一处改了阈值另一处忘了。
 *
 * ## 分层
 *
 * 这里只 import 领域层与端口类型，不认识 LLM 适配器、不认识数据库。
 * 真正的模型由调用方通过 `classifier` 注入 —— 生产是 `createScopeClassifier()`，
 * 测试是几行假对象。
 */
import type { ScopeClassifier } from "@/domain/ports/scope-classifier";
import {
  ADJACENT_HINT,
  nextStrike,
  outOfScopeReply,
  ruleScreen,
  shouldBlock,
  strikeLevel,
  type ScopeKind,
  type ScopeVerdict,
  type StrikeCounter,
  type StrikeLevel,
} from "@/domain/scope-guard";

export type ScopeDecision = {
  kind: ScopeKind;
  /** 是否要拦下这一轮（不进主模型） */
  blocked: boolean;
  /**
   * 这次拦截的强度档。前端靠它决定要不要建议「开个新对话」。
   *
   * 只有 `blocked` 一个布尔不够：第一次越界是「你问的这个我帮不上」，
   * 第二次是「你在试探」—— 两者的 UI 诉求完全不同（后者才值得给出口）。
   * 这个值本来就在算（`strikeLevel(counter)`），只是之前没往上传。
   */
  strikeLevel: StrikeLevel;
  /** 拦下时直接回给用户的话术（已按软硬档选好）；不拦时为 null */
  reply: string | null;
  /** 不拦但要追加在回复末尾的引导语（ADJACENT 用） */
  hint: string | null;
  /** 更新后的计数，调用方要接着传下一轮 */
  counter: StrikeCounter;
};

/**
 * 判一句话，并顺便把计数推进一步。
 *
 * 判定顺序：规则层先跑（零成本、可复现），规则判不了才问分类器。
 * 这个顺序不能反 —— 分类器是付费且有延迟的，能用规则判掉的一律不问。
 */
export async function checkScope(input: {
  text: string;
  classifier: ScopeClassifier;
  counter: StrikeCounter;
}): Promise<ScopeDecision> {
  const verdict = await decide(input.text, input.classifier);
  const counter = nextStrike(input.counter, verdict.kind);
  const level = strikeLevel(counter);

  if (shouldBlock(verdict)) {
    return {
      kind: verdict.kind,
      blocked: true,
      strikeLevel: level,
      reply: outOfScopeReply(level),
      hint: null,
      counter,
    };
  }

  return {
    kind: verdict.kind,
    blocked: false,
    strikeLevel: level,
    reply: null,
    hint: verdict.kind === "ADJACENT" ? ADJACENT_HINT : null,
    counter,
  };
}

/**
 * 规则优先，判不了再问分类器。
 *
 * 分类器未配置时直接放行 —— 不调一个明知不可用的东西。
 */
async function decide(text: string, classifier: ScopeClassifier): Promise<ScopeVerdict> {
  const byRule = ruleScreen(text);
  if (byRule) return byRule;

  if (!classifier.configured()) {
    return { kind: "IN_SCOPE", reason: "分类器未配置，放行" };
  }

  return classifier.classify(text);
}
