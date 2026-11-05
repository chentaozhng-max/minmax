/**
 * 会话的持久事实 —— 把它们写成模型能读的几行。
 *
 * ## 为什么这些事实每轮都要现查，不能塞进会话里
 *
 * 会话（`AssistantThread`）是易失的：每次打开网站就是新的一条。如果「他做过
 * 什么实验」要靠上一次对话里的文字来传递，那么一换窗口就全丢了，用户得再说一遍。
 *
 * 反过来，如果为了「不丢」把它快照进会话，问题更大：约完第二场之后，
 * 会话里那句「你现在没有进行中的实验」就过期了，而模型会当真照着说。
 * 连约三场，过期程度放大三倍。
 *
 * 所以只有两条路是对的：每轮现查，或者不查。这里是每轮现查 + 纯函数格式化。
 *
 * ## 为什么格式化在应用层而不是领域层
 *
 * 它要调 `formatDateTimeCN`（lib 层），而领域层禁止 import lib（L1 红线）。
 * 更实质的理由：「事实怎么变成一句话」是**编排**（把查到的数据组装成提示词），
 * 不是领域规则 —— 领域层只回答「什么是有效的」，不回答「怎么排版给人看」。
 * 领域规则（做过/在做怎么切时间轴）留在 domain/ports/assistant-query.ts。
 */
import type { DurableFacts } from "@/domain/ports/assistant-query";
import { formatDateTimeCN } from "@/lib/time";

/** 最多列几条：再多模型也不会逐条念，反而挤掉真正该说的话 */
const MAX_PAST = 5;
const MAX_UPCOMING = 5;

/**
 * 把持久事实写成提示词里的一块。
 *
 * 三件事必须明确：
 *   1. 这是**系统查到的**，不是用户刚说的 —— 否则模型会当成用户新提的条件
 *   2. 没有就说没有（空数组要落成一句话，不留空白让模型自由发挥）
 *   3. 明确告诉它「已约的实验不该再推荐」—— 这是 exclude 的语义来源
 */
export function formatDurableFacts(facts: DurableFacts): string {
  const lines: string[] = ["## 这个人的已知情况（系统实时查到的，不是他刚说的）"];

  if (facts.upcoming.length === 0) {
    lines.push("- 当前没有进行中的实验。");
  } else {
    lines.push(`- 进行中的实验 ${facts.upcoming.length} 场：`);
    for (const a of facts.upcoming.slice(0, MAX_UPCOMING)) {
      lines.push(
        `  · ${a.experimentTitle}：${formatDateTimeCN(a.startAt)}，${a.location}（${a.status}）`,
      );
    }
    if (facts.upcoming.length > MAX_UPCOMING) {
      lines.push(`  · 还有 ${facts.upcoming.length - MAX_UPCOMING} 场未列出`);
    }
  }

  if (facts.past.length === 0) {
    lines.push("- 还没有完成过的实验。");
  } else {
    lines.push(`- 完成过的实验 ${facts.past.length} 场（最近的在前）：`);
    for (const p of facts.past.slice(0, MAX_PAST)) {
      lines.push(`  · ${p.experimentTitle}：${formatDateTimeCN(p.finishedAt)}`);
    }
    if (facts.past.length > MAX_PAST) {
      lines.push(`  · 还有 ${facts.past.length - MAX_PAST} 场未列出`);
    }
  }

  lines.push(
    "",
    "## 怎么用这些情况",
    "- 进行中的实验不要再推荐给同一个人（他没时间，也不该重复报名）。",
    "- 他问「我有什么安排」时，直接用上面的时间回答，不要说「我查一下」。",
    "- 他问「我以前做过什么」时，用上面「完成过的实验」回答；没有就照实说没有。",
    "- 不要把这些事实原样念一遍。他已经知道了，只在相关时提一句。",
  );

  return lines.join("\n");
}
