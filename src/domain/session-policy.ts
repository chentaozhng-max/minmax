/**
 * 门厅会话的策略判断 —— 纯函数，零 IO。
 *
 * 这里放的每一个函数回答的都是「要不要做某件事」，而不是「怎么做」：
 *   · 该不该压缩（以及留多少条）
 *   · 该不该结转（换窗口）
 *   · 用户这句话是不是在表示「聊完了」/「先不聊了」
 *   · 软结束的会话还能不能复活
 *
 * 为什么这些判断要独立成文件、不能写在 `server/assistant-agent.ts` 里：
 * 它们全是「输入几个数、输出一个决定」，放进去就会被 await 和 prisma 淹没，
 * 只能靠跑整条链路来验。抽出来之后每条判断都是一行的单测。
 */
import type { SessionEndReason } from "@/domain/ports/session-store";

/* ---------------- 压缩 ---------------- */

/** 超过这个条数开始压缩（用户与助手合计） */
export const COMPACT_THRESHOLD = 20;
/** 压缩时最近多少条原样保留（含完整工具返回） */
export const KEEP_RECENT = 12;
/** 存储条数硬上限：超过它先压缩；压完仍然超，就丢掉最老的一批 */
export const MAX_STORED = 80;

export type CompactionPlan = {
  /** 第 1 层：更早轮次的工具返回体降级为 {summary, cards} */
  compact: boolean;
  /** 压缩时保留多少条原文 */
  keepRecent: number;
  /**
   * 第 2 层：把最老的 N 条折进 `summary` 后丢弃（0 = 不摘要）。
   *
   * 这一层才真正让 `MAX_STORED` 起作用：第 1 层只降级不删条，条数不会减少。
   * 只有超过存储上限时才把最老的一段压成摘要 —— 那是唯一需要模型参与的地方，
   * 所以门槛要设得高，别让常规对话都去调一次模型。
   */
  summarizeCount: number;
};

/**
 * 压缩决策（两层分开算）。
 *
 * 第 1 层（工具结果降级）**免费**，因为门厅前端只渲染最后一轮搜索的卡片
 * （`lastSearchIndex`），更早轮次的 `result` 本来就是死数据 —— 实测占历史体积 91%。
 * 所以门槛可以很低（20 条就做）。
 *
 * 第 2 层（文本摘要）要调模型，只在超过存储上限时才做。
 */
export function planCompaction(count: number): CompactionPlan {
  if (count <= COMPACT_THRESHOLD) {
    return { compact: false, keepRecent: KEEP_RECENT, summarizeCount: 0 };
  }
  return {
    compact: true,
    keepRecent: KEEP_RECENT,
    summarizeCount: Math.max(0, count - MAX_STORED),
  };
}

/* ---------------- 结转（换窗口） ---------------- */

/**
 * 一轮 = 一条 user 消息。这个数字只看用户说了多少句，不看助手回了多少。
 *
 * 为什么按 user 数而不是消息总数：消息总数里工具轮次会让「3 句话」变成
 * 10 条消息，那样触发点会随工具调用次数漂移，同一段对话在不同行为下
 * 长度完全不同 —— 用户感知不到「我聊了很多」，只会觉得莫名其妙换窗口。
 */
export const HANDOFF_TURNS = 40;

/** 该不该结转。到了就压、就换窗口，但**不结束**对话 */
export function shouldHandoff(turnCount: number): boolean {
  return turnCount >= HANDOFF_TURNS;
}

/* ---------------- 意图识别 ---------------- */

/** 明确表示「聊完了」的说法。命中才结束，宁可不命中也不要瞎猜 */
const DONE_PATTERNS = [
  "够了",
  "就这些",
  "就这样",
  "不用了",
  "没有了",
  "先这样",
  "结束了",
  "谢谢再见",
  "不找了",
];

/** 软结束：用户想走但没关死门 */
const SOFT_END_PATTERNS = ["我再看看", "再想想", "回头再来", "先看看", "晚点再说"];

/**
 * 会**反转**上面那些说法的前置词。
 *
 * 「够了」和「不够了」只差一个字，意思完全相反：「时间不够了」是在说
 * 条件太苛、找不到合适的，不是"我聊完了"。如果不管，用户问一句就被
 * 结束对话 —— 这是这条链路上代价最高的误判。
 */
const NEGATED_DONE_PATTERNS = ["不够", "没够", "还差", "没有空", "抽不出"];

/**
 * 判断用户这句话的意图。
 *
 * ⚠️ 只用**整串包含**，不用正则模糊匹配。历史教训：早期版本用
 * `/一|二|三/` 判星期，「随便」二字里的「三」让它判成了周三，
 * 闲聊被当成搜索条件。宁可返回 null 让上层按「无特殊意图」处理，
 * 也不要在这种地方瞎猜 —— 猜错的代价是替用户结束了对话。
 */
export function detectIntent(text: string): SessionEndReason | "SEALED" | null {
  const t = text.trim();
  if (!t) return null;
  // 先看否定式，再看肯定式：顺序很重要，否则「不够」里的「够」会先命中
  if (NEGATED_DONE_PATTERNS.some((p) => t.includes(p))) return null;
  if (DONE_PATTERNS.some((p) => t.includes(p))) return "USER_DONE";
  if (SOFT_END_PATTERNS.some((p) => t.includes(p))) return "SEALED";
  return null;
}

/* ---------------- 复活窗口 ---------------- */

/**
 * 软结束的会话可复活窗口。
 *
 * 二二把 30 分钟改成了 1 小时：软结束是「我先想想」，想法不会半小时就消失，
 * 而超过一小时再接着聊，用户自己也不记得聊到哪了 —— 那时候新开一条
 * 反而更干净（该记的条件本来就在 DB 里，不在对话里）。
 */
export const SEAL_REVIVE_MS = 60 * 60 * 1000;

/** 软结束的会话还能不能复活。没软结束过的一律 false（不需要复活） */
export function canRevive(sealedAt: Date | null, now: Date): boolean {
  if (!sealedAt) return false;
  return now.getTime() - sealedAt.getTime() <= SEAL_REVIVE_MS;
}

/* ---------------- 空闲 ---------------- */

/**
 * 兜底扫描的空闲阈值。
 *
 * 注意这是**兜底**，不是主判定：正常路径是「用户下次进站时发现上一条已经
 * 隔了很久，直接开新的」，扫库只是为了把那些再也不会回来的人的记录标上
 * `IDLE`，别让它们永远挂着 `endedAt = null`。
 */
export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

export function idleCutoff(now: Date): Date {
  return new Date(now.getTime() - IDLE_TIMEOUT_MS);
}
