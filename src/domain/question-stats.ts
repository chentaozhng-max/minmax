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
