/**
 * 工具闸的接线层 —— 把 `tool-policy.ts` 的纯函数接到 `ToolRegistry.exec` 上。
 *
 * ## 为什么不直接写进 registry.ts
 *
 * registry 的职责是「注册 + 校验参数 + 执行」，它对业务规则一无所知，
 * 也不知道 book_slot 为什么不能调。把规则写进去会让它同时承担
 * 「工具容器」和「行为策略」两件事，以后改策略要动容器。
 *
 * 所以这里只做三件小事：算出 argsKey、调纯函数判、把结果记回去。
 * 真正的判断逻辑全在领域层，可以脱离 registry 单测。
 */
import {
  evaluateToolCall,
  recordToolCall,
  type GuardVerdict,
  type ToolCallState,
  type ToolRisk,
} from "@/domain/tool-policy";
import type { ToolResult } from "./registry";

/**
 * 一次对话轮次内的闸状态。
 *
 * 用可变对象而不是「传进去再传出来」：工具是**循环里逐个**执行的，
 * 每执行一个就要把记录追加上去给下一个判。纯函数式写法会让调用方
 * 在 for 循环里反复重赋值 state，读起来比可变对象更容易出错。
 *
 * 领域层的函数仍然是纯的 —— 只有这一层持有可变引用。
 */
export type GuardState = {
  state: ToolCallState;
};

export function createGuardState(over: Partial<ToolCallState> = {}): GuardState {
  return {
    state: { turnCalls: [], appointmentBooked: false, availableSlotIds: [], ...over },
  };
}

/**
 * 把参数序列化成稳定的字符串，用作「是不是同一个调用」的比较键。
 *
 * 键的顺序必须稳定，否则 `{a:1,b:2}` 和 `{b:2,a:1}` 会被当成两次不同调用，
 * 重复检测就失效了。模型不保证字段顺序。
 */
export function stableArgsKey(args: Record<string, unknown>): string {
  const keys = Object.keys(args).sort();
  const normalized: Record<string, unknown> = {};
  for (const key of keys) normalized[key] = args[key];
  return JSON.stringify(normalized);
}

/**
 * 判一次调用。
 *
 * @param risk 工具声明的风险类别；未声明时按 `read` 处理（最宽松，不会误判成写）
 */
export function guardToolCall(input: {
  name: string;
  args: Record<string, unknown>;
  risk?: ToolRisk;
  guard: GuardState;
}): GuardVerdict {
  return evaluateToolCall({
    name: input.name,
    risk: input.risk ?? "read",
    args: input.args,
    argsKey: stableArgsKey(input.args),
    state: input.guard.state,
  });
}

/**
 * 把这次调用记进状态。**被拦下的也要记** —— 否则模型原样重试时
 * 永远被当成「第一次」，重复检测形同虚设。
 *
 * @param booked 这次调用是否产出了预约（book_slot 成功时由调用方告知）
 */
export function noteToolCall(input: {
  name: string;
  args: Record<string, unknown>;
  guard: GuardState;
  booked?: boolean;
}): void {
  input.guard.state = recordToolCall({
    name: input.name,
    argsKey: stableArgsKey(input.args),
    state: input.guard.state,
    booked: input.booked,
  });
}

/**
 * 被拦下时回给模型的 result。
 *
 * 形状必须和正常 `ToolResult` 一致（`ok:false` + `error`），
 * 因为 agent 循环把它原样序列化成 role:"tool" 消息发给模型 ——
 * 换一种形状会让模型收到它不认识的返回体。
 *
 * 额外带 `denied: true`：审计日志和前端靠它区分「业务失败」（比如时段满了）
 * 和「被闸拦下」（模型行为问题），两者的排查方向完全不同。
 */
export function deniedResult(verdict: Extract<GuardVerdict, { allow: false }>): ToolResult {
  return { ok: false, error: verdict.reason, denied: true, rule: verdict.rule };
}
