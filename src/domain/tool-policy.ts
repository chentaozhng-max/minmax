/**
 * 工具闸 —— 纯函数，零 IO。
 *
 * 回答的是「这一次工具调用该不该被执行」，不是「怎么执行」。
 *
 * ## 为什么闸放在注册表层而不是工具内部
 *
 * 工具内部的校验（比如 `book_slot` 检查 slotId 在不在候选列表里）是**业务正确性**，
 * 它只保护自己；而这里要挡的是**模型的调用行为**——重复刷同一个读接口、
 * 绕过用户直接下单、一激动连调八九次。这类问题跟具体工具无关，跨工具发生，
 * 所以必须在所有工具的共同入口（`ToolRegistry.exec`）之前判。
 *
 * ## 为什么 deny 一定要带 reason
 *
 * 只说「不允许」的话，模型会换个工具再试一遍（甚至原样重试）。给它一句
 * **能照着做的下一步**（「改用 propose_slots」），它才有可能自我纠正。
 * 这是这条链路上唯一有效的纠错信号 —— 主模型看不到我们的代码。
 */

/**
 * 工具的风险类别。
 *
 * 用「类别」而不是「工具名清单」：以后加工具的人不会记得去改一张清单，
 * 但他会在写接口时看到 `risk` 这个字段必须填。
 */
export type ToolRisk =
  /** 只读：查时段、查信誉分、搜实验 */
  | "read"
  /** 写业务单据：下单、登记候补 */
  | "write"
  /** 有对外副作用：给主试留言、推卡片给用户 */
  | "side-effect"
  /** 只产草稿不落库 */
  | "draft";

/** 拒绝原因。常量化的好处：审计日志能按 rule 聚合，改文案不影响统计 */
export type ToolRule =
  | "HUMAN_CONFIRMS_ORDER"
  | "WAITLIST_UNSUPPORTED"
  | "ARG_NOT_FROM_SOURCE"
  | "DUPLICATE_CALL"
  | "REPEAT_TOOL"
  | "TURN_BUDGET"
  | "ALREADY_BOOKED";

export type GuardVerdict =
  | { allow: true }
  | {
      allow: false;
      /** 给模型看的原因，必须是「下一步该干什么」而不是「你错了」 */
      reason: string;
      rule: ToolRule;
      /** 恒定 true，审计日志与前端都靠它区分「业务失败」和「被闸拦下」 */
      denied: true;
    };

/** 本轮到目前为止发生了什么 —— 闸做判断所需的全部事实 */
export type ToolCallState = {
  /** 本轮已发生的调用，按时间顺序（name + 序列化后的 args） */
  turnCalls: { name: string; args: string }[];
  /** 本轮是否已经约上了一场 */
  appointmentBooked: boolean;
  /**
   * 当前真实可约的时段 id。
   *
   * 空数组 = 调用方没提供（不做这项校验）。**不能**把「空数组」当成
   * 「一个时段都没有，所以全都非法」—— 那会在没有空位的实验里把所有
   * 合法的 propose_slots 也一起否掉。
   */
  availableSlotIds: string[];
};

/** 单轮读类调用上限。真需要更多信息说明 prompt 该改，不是放模型继续刷 */
export const MAX_READ_CALLS_PER_TURN = 6;

/** 同一个工具在本轮最多调几次（不管参数） */
export const MAX_CALLS_PER_TOOL = 3;

/** 读类工具名。这里是唯一一处按名字判断的地方，新增读工具要记得加 */
const READ_TOOLS = new Set([
  "get_available_slots",
  "get_my_busy_slots",
  "get_my_credit_status",
  "search_experiments",
]);

function isReadLike(name: string): boolean {
  return READ_TOOLS.has(name);
}

/**
 * 读类调用总数。
 *
 * 只数读类不数写类：写类有自己的规则。混在一起会让「读了 6 次」
 * 被一次下单顶掉 —— 下单不该给阅读额度充值。
 */
function countReadCalls(state: ToolCallState): number {
  return state.turnCalls.filter((c) => isReadLike(c.name)).length;
}

/** 同 name + 同 args 是否在本轮出现过 */
function isDuplicate(name: string, argsKey: string, state: ToolCallState): boolean {
  return state.turnCalls.some((c) => c.name === name && c.args === argsKey);
}

/** 本轮这个工具总共被调了几次（不看参数） */
function countToolCalls(name: string, state: ToolCallState): number {
  return state.turnCalls.filter((c) => c.name === name).length;
}

/**
 * 判一次工具调用能不能放行。
 *
 * 规则按代价从高到低排：先挡「绕过用户下单」（不可逆、后果最重），
 * 再挡参数来源错误，最后才是啰嗦和刷次数（只是浪费 token）。
 *
 * @param argsKey 已序列化的参数（调用方负责 JSON.stringify，保证稳定比较）
 */
export function evaluateToolCall(input: {
  name: string;
  risk: ToolRisk;
  args: Record<string, unknown>;
  argsKey: string;
  state: ToolCallState;
}): GuardVerdict {
  const { name, args, argsKey, state } = input;

  // ── 1. 下单必须由用户点组件完成 ──────────────────────────
  // 前端 chat-view 的 SlotGrid 已经是「用户点卡片 → POST /api/appointments」，
  // 模型调 book_slot 只会绕过那一手。所以这里不是「确认过就放行」，是一律拒绝。
  if (name === "book_slot") {
    return {
      allow: false,
      rule: "HUMAN_CONFIRMS_ORDER",
      denied: true,
      reason:
        "下单必须由用户自己在卡片上点确认。请改用 propose_slots 展示候选时段，" +
        "用户点选后系统会自动创建预约。不要再次尝试 book_slot。",
    };
  }

  // ── 2. 候补功能尚未真正实现 ──────────────────────────────
  // join_waitlist 只把会话状态改成 WAITLIST，没有落库、没有名额占用、
  // 有空位也不会通知任何人 —— 它给用户一个兑现不了的承诺。
  if (name === "join_waitlist") {
    return {
      allow: false,
      rule: "WAITLIST_UNSUPPORTED",
      denied: true,
      reason:
        "目前还没有候补排队机制（登记了也不会有人通知用户）。请改用 escalate_to_researcher " +
        "给主试留言，或者直接告诉用户暂时没有合适时段。",
    };
  }

  // ── 3. 参数必须来自事实源 ────────────────────────────────
  if (name === "propose_slots") {
    const ids = Array.isArray(args.slotIds) ? args.slotIds.map(String) : [];
    // 只在调用方提供了真实列表时校验（空数组 = 没提供，不是「全都不合法」）
    if (state.availableSlotIds.length > 0) {
      const unknown = ids.filter((id) => !state.availableSlotIds.includes(id));
      if (unknown.length > 0) {
        return {
          allow: false,
          rule: "ARG_NOT_FROM_SOURCE",
          denied: true,
          reason:
            "这些时段 id 不在当前候选列表里（可能是编的，也可能刚被约满）。" +
            "请先调用 get_available_slots 拿真实 id 再 propose_slots。",
        };
      }
    }
  }

  // ── 4. 本轮已约成，别再写 ────────────────────────────────
  if (state.appointmentBooked && input.risk === "write") {
    return {
      allow: false,
      rule: "ALREADY_BOOKED",
      denied: true,
      reason: "这一轮已经约上一场了。请先问用户是否还需要再约一场，不要自己继续下单。",
    };
  }

  // ── 5. 同一个工具调太多次 ────────────────────────────────
  if (countToolCalls(name, state) >= MAX_CALLS_PER_TOOL) {
    return {
      allow: false,
      rule: "REPEAT_TOOL",
      denied: true,
      reason: "同一个工具在这一轮已经用过几次了，再调也不会得到新信息。请直接用已有结果回答。",
    };
  }

  // ── 6. 同轮同参完全重复 ──────────────────────────────────
  if (isDuplicate(name, argsKey, state)) {
    return {
      allow: false,
      rule: "DUPLICATE_CALL",
      denied: true,
      reason: "这个结果你刚才已经拿到了，直接用它回答用户即可，不要重复调用。",
    };
  }

  // ── 7. 单轮读预算 ────────────────────────────────────────
  if (isReadLike(name) && countReadCalls(state) >= MAX_READ_CALLS_PER_TURN) {
    return {
      allow: false,
      rule: "TURN_BUDGET",
      denied: true,
      reason: "这一轮查询次数已经够多了，信息不会更多。请直接用现有结果回答用户。",
    };
  }

  return { allow: true };
}

/**
 * 把一次真实发生的调用记进 state。
 *
 * 和 evaluateToolCall 分开：**被拦下的调用也要记**，否则模型重试同一个被拦
 * 调用时会永远得到「第一次」的判定，我们的计数就形同虚设。
 */
export function recordToolCall(input: {
  name: string;
  argsKey: string;
  state: ToolCallState;
  booked?: boolean;
}): ToolCallState {
  return {
    turnCalls: [...input.state.turnCalls, { name: input.name, args: input.argsKey }],
    appointmentBooked: input.booked ?? input.state.appointmentBooked,
    availableSlotIds: input.state.availableSlotIds,
  };
}
