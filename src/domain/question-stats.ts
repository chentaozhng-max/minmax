/**
 * 答卷的题目分布 —— 纯函数，不碰 IO。
 *
 * 主试写论文时要写「样本中 62% 每周练习 3 次以上」，
 * 一份份点开数不现实。这里把同一题的答案汇总成频次。
 *
 * 三个刻意的口径：
 *   1. **分母是「回答了这题的人数」**，不是答卷总数 —— 选做题没填的人
 *      不该拉低比例。每题单独显示「N/M 人作答」。
 *   2. **多选的比例会加起来超过 100%**，这是多选的正常现象，不是 bug。
 *   3. 选项按**原顺序**（量表按分值升序）排，不按票数排 ——
 *      主试看的是「从不 → 每天」这个梯度，打乱了反而读不出趋势。
 */

import { passState } from "@/domain/questionnaire";

import type { AnswerMap, AnswerValue } from "@/domain/questionnaire";
import { QuestionType } from "@/domain/questionnaire";

export type OptionTally = {
  label: string;
  count: number;
  /** 占「回答了这题的人数」的比例，0–1 */
  ratio: number;
};

export type QuestionStat = {
  questionId: string;
  title: string;
  type: string;
  /** 这道题被回答了多少份 */
  answered: number;
  /** 选项题（单选/多选/量表）的频次；文本题是空数组 */
  tallies: OptionTally[];
  /** 文本题的全部非空回答；选项题是空数组 */
  texts: string[];
};

export type StatQuestion = {
  id: string;
  title: string;
  type: string;
  options: string[];
  scaleMin: number | null;
  scaleMax: number | null;
};

function isBlank(value: AnswerValue | undefined): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/** 量表的刻度：1–5、0–60 都得能画出来；上限兜到 100 防手抖 */
function scaleLabels(question: StatQuestion): string[] {
  const min = question.scaleMin ?? 1;
  const max = question.scaleMax ?? 5;
  if (max < min) return [];
  const labels: string[] = [];
  for (let n = min; n <= Math.min(max, min + 100); n += 1) labels.push(String(n));
  return labels;
}

/**
 * @param questions 按 order 排好序的题目
 * @param responses 全部答卷（只要 answers，别的字段不需要）
 */
export function summarizeAnswers(
  questions: StatQuestion[],
  responses: { answers: AnswerMap }[],
): QuestionStat[] {
  return questions.map((question) => {
    const values = responses.map((r) => r.answers[question.id]).filter((v) => !isBlank(v));
    const base: QuestionStat = {
      questionId: question.id,
      title: question.title,
      type: question.type,
      answered: values.length,
      tallies: [],
      texts: [],
    };

    if (question.type === QuestionType.TEXT) {
      return { ...base, texts: values.map((v) => String(v)) };
    }

    const labels =
      question.type === QuestionType.SCALE ? scaleLabels(question) : question.options;
    const counts = new Map<string, number>();
    const bump = (key: string) => counts.set(key, (counts.get(key) ?? 0) + 1);

    for (const value of values) {
      if (Array.isArray(value)) value.forEach((v) => bump(String(v)));
      else bump(String(value));
    }

    // 先把原选项按顺序铺全（0 票的也要在），再补上不在选项里的历史答案
    const tallies: OptionTally[] = labels.map((label) => ({
      label,
      count: counts.get(label) ?? 0,
      ratio: values.length === 0 ? 0 : (counts.get(label) ?? 0) / values.length,
    }));
    const known = new Set(labels);
    for (const [label, count] of counts) {
      if (!known.has(label)) {
        tallies.push({ label, count, ratio: values.length === 0 ? 0 : count / values.length });
      }
    }

    return { ...base, tallies };
  });
}

/* ─────────────────────────────────────────────
 * 长程重复测量的完成情况
 *
 * 主试真正关心的不是「收了多少份卷」，而是「多少人真的坚持填完了」。
 * 一个人填 7 天算 7 份，按份统计看不出流失。
 * ───────────────────────────────────────────── */

export type RepeatStat = {
  /** 一共要求填几天 */
  repeatCount: number;
  /** 去重后的人数 */
  participants: number;
  /** 其中填满了 N 天的人数 */
  completed: number;
  /** 人均填了几天（保留 1 位） */
  averageRounds: number;
  /** 每一天收到了多少份 —— 用来看流失曲线 */
  perRound: { round: number; count: number }[];
};

export function summarizeRepeats(
  responses: { subjectId: string; round: number }[],
  repeatCount: number,
): RepeatStat {
  const days = Math.max(1, Math.round(repeatCount));
  const bySubject = new Map<string, Set<number>>();

  for (const response of responses) {
    const set = bySubject.get(response.subjectId) ?? new Set<number>();
    set.add(response.round);
    bySubject.set(response.subjectId, set);
  }

  const participants = bySubject.size;
  let filled = 0;
  for (const set of bySubject.values()) filled += set.size;

  const perRound: { round: number; count: number }[] = [];
  for (let round = 1; round <= days; round += 1) {
    let count = 0;
    for (const set of bySubject.values()) if (set.has(round)) count += 1;
    perRound.push({ round, count });
  }

  return {
    repeatCount: days,
    participants,
    completed: [...bySubject.values()].filter((set) => set.size >= days).length,
    averageRounds: participants === 0 ? 0 : Math.round((filled / participants) * 10) / 10,
    perRound,
  };
}

/* ─────────────────────────────────────────────
 * 按人聚合（长程重复测量）
 *
 * 答卷是一份一份的，但主试脑子里的单位是「人」：
 * 「周叙填了 3 天、林知夏填了 2 天」比「收了 6 份卷」有用得多。
 * ───────────────────────────────────────────── */

export type PersonGroup<T> = {
  subjectId: string;
  /** 这个人填过的所有轮次，按 round 升序 */
  rounds: T[];
  doneCount: number;
  /** 第 1 轮（基线）的判定 —— 入选与否看基线，后面几天只是数据 */
  firstPass: "PASS" | "FAIL" | "UNKNOWN";
  /** 这个人所有轮次的平均分（一位小数）；一份都没分时为 null */
  averageScore: number | null;
};

export function groupResponsesByPerson<
  T extends {
    subjectId: string;
    round: number;
    score: number | null;
    passed: boolean | null;
  },
>(responses: T[], passScore: number | null): PersonGroup<T>[] {
  const map = new Map<string, T[]>();
  for (const response of responses) {
    const list = map.get(response.subjectId) ?? [];
    list.push(response);
    map.set(response.subjectId, list);
  }

  return [...map.entries()]
    .map(([subjectId, rounds]) => {
      const sorted = [...rounds].sort((a, b) => a.round - b.round);
      const first = sorted.find((r) => r.round === 1) ?? sorted[0];
      const scores = sorted.filter((r) => typeof r.score === "number").map((r) => r.score as number);

      return {
        subjectId,
        rounds: sorted,
        doneCount: new Set(sorted.map((r) => r.round)).size,
        /**
         * 和 hasPassed 同一口径：只看基线那一轮。
         * 判定优先用库里存的 `passed`（主试可能手改过），没有才按分数线算 ——
         * 只按分数线算会和上面的「达标 N 份」对不上。
         */
        firstPass:
          first?.passed === true
            ? "PASS"
            : first?.passed === false
              ? "FAIL"
              : passState(first?.score ?? null, passScore),
        averageScore: scores.length
          ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10
          : null,
      };
    })
    // 填得多的排前面；一样多按平均分降序
    .sort((a, b) => b.doneCount - a.doneCount || (b.averageScore ?? -1) - (a.averageScore ?? -1));
}
