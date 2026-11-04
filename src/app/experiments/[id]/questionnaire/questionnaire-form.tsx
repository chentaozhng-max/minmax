"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { toast } from "@/components/toast";
import { postJson } from "@/lib/api-client";
import { cn } from "@/lib/cn";

type Question = {
  id: string;
  type: string;
  title: string;
  required: boolean;
  options: string[];
  scaleMin: number | null;
  scaleMax: number | null;
};

type Answer = string | string[] | number;

export function QuestionnaireForm({
  experimentId,
  experimentTitle,
  mode,
  title,
  intro,
  questions,
  initialAnswers,
  submittedAt,
}: {
  experimentId: string;
  experimentTitle: string;
  mode: "ONLINE" | "OFFLINE";
  title: string;
  intro: string;
  questions: Question[];
  initialAnswers: Record<string, Answer> | null;
  submittedAt: string | null;
}) {
  const [answers, setAnswers] = useState<Record<string, Answer>>(initialAnswers ?? {});
  const [editing, setEditing] = useState(!initialAnswers);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(Boolean(initialAnswers));

  function setAnswer(id: string, value: Answer) {
    setAnswers((prev) => ({ ...prev, [id]: value }));
  }

  function toggleMulti(id: string, option: string) {
    const current = answers[id];
    const list = Array.isArray(current) ? current : [];
    const next = list.includes(option) ? list.filter((v) => v !== option) : [...list, option];
    setAnswer(id, next);
  }

  function validate(): string | null {
    for (const [index, q] of questions.entries()) {
      const value = answers[q.id];
      const empty =
        value === undefined ||
        value === null ||
        (typeof value === "string" && !value.trim()) ||
        (Array.isArray(value) && value.length === 0);
      if (q.required && empty) return `第 ${index + 1} 题还没有回答`;
    }
    return null;
  }

  async function submit() {
    const problem = validate();
    if (problem) return toast(problem, "error");

    setSubmitting(true);
    try {
      await postJson(`/api/experiments/${experimentId}/questionnaire`, { answers });
      setDone(true);
      setEditing(false);
      toast("问卷已提交");
    } catch (error) {
      toast(error instanceof Error ? error.message : "提交失败", "error");
    } finally {
      setSubmitting(false);
    }
  }

  if (done && !editing) {
    return (
      <section className="px-4 py-8">
        <div className="rounded-card border border-line bg-surface p-5 text-center">
          <p className="text-[15px] font-medium text-ink">问卷已提交</p>
          <p className="mt-2 text-[12px] leading-6 text-ink-soft">
            {mode === "ONLINE"
              ? "这是一项线上实验，提交问卷即视为完成。主试如果安排了后续环节，会通过站内消息通知你。"
              : "主试会按问卷结果筛选。通过后会给你发消息，届时回到实验页就能选时段预约。"}
          </p>
          {submittedAt ? (
            <p className="num mt-2 text-[11px] text-ink-soft">
              提交于 {new Date(submittedAt).toLocaleString("zh-CN", { hour12: false })}
            </p>
          ) : null}
        </div>

        <div className="mt-4 space-y-2.5">
          {questions.map((q, index) => (
            <div key={q.id} className="rounded-card border border-line bg-surface px-3.5 py-3">
              <p className="text-[13px] leading-5 text-ink">
                <span className="num mr-1 text-ink-soft">{index + 1}.</span>
                {q.title}
              </p>
              <p className="mt-1 text-[12px] leading-5 text-moss">{renderAnswer(q, answers[q.id])}</p>
            </div>
          ))}
        </div>

        <div className="mt-5 flex gap-2">
          <Link href={`/experiments/${experimentId}`} className="flex-1">
            <Button size="lg" block variant="outline">
              返回实验
            </Button>
          </Link>
          <Button size="lg" block className="flex-1" onClick={() => setEditing(true)}>
            重新填写
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className="px-4 pb-8 pt-4">
      <div className="rounded-card border border-line bg-surface p-4">
        <h1 className="text-[16px] font-medium leading-6 text-ink">{title}</h1>
        <p className="mt-1 text-[11px] text-ink-soft">来自「{experimentTitle}」</p>
        {intro ? <p className="mt-2 text-[12px] leading-6 text-ink-soft">{intro}</p> : null}
      </div>

      <div className="mt-3 space-y-3">
        {questions.map((q, index) => (
          <div key={q.id} className="rounded-card border border-line bg-surface px-3.5 py-3">
            <p className="text-[13.5px] leading-6 text-ink">
              <span className="num mr-1 text-ink-soft">{index + 1}.</span>
              {q.title}
              {q.required ? <span className="ml-0.5 text-danger">*</span> : null}
            </p>

            <div className="mt-2.5">
              {q.type === "SINGLE" ? (
                <div className="space-y-1.5">
                  {q.options.map((option) => {
                    const active = answers[q.id] === option;
                    return (
                      <button
                        key={option}
                        type="button"
                        onClick={() => setAnswer(q.id, option)}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-[8px] border px-3 py-2 text-left text-[13px]",
                          active ? "border-moss bg-moss-tint text-moss" : "border-line bg-surface text-ink",
                        )}
                      >
                        <span
                          className={cn(
                            "h-3.5 w-3.5 shrink-0 rounded-full border",
                            active ? "border-moss bg-moss" : "border-line",
                          )}
                        />
                        {option}
                      </button>
                    );
                  })}
                </div>
              ) : null}

              {q.type === "MULTI" ? (
                <div className="space-y-1.5">
                  {q.options.map((option) => {
                    const list = Array.isArray(answers[q.id]) ? (answers[q.id] as string[]) : [];
                    const active = list.includes(option);
                    return (
                      <button
                        key={option}
                        type="button"
                        onClick={() => toggleMulti(q.id, option)}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-[8px] border px-3 py-2 text-left text-[13px]",
                          active ? "border-moss bg-moss-tint text-moss" : "border-line bg-surface text-ink",
                        )}
                      >
                        <span
                          className={cn(
                            "h-3.5 w-3.5 shrink-0 rounded-[3px] border",
                            active ? "border-moss bg-moss" : "border-line",
                          )}
                        />
                        {option}
                      </button>
                    );
                  })}
                  <p className="text-[11px] text-ink-soft">可多选</p>
                </div>
              ) : null}

              {q.type === "SCALE" ? (
                <div className="flex flex-wrap gap-1.5">
                  {range(q.scaleMin ?? 1, q.scaleMax ?? 5).map((n) => {
                    const active = Number(answers[q.id]) === n;
                    return (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setAnswer(q.id, n)}
                        className={cn(
                          "num h-9 min-w-9 rounded-[8px] border px-2 text-[13px]",
                          active ? "border-moss bg-moss text-white" : "border-line bg-surface text-ink",
                        )}
                      >
                        {n}
                      </button>
                    );
                  })}
                </div>
              ) : null}

              {q.type === "TEXT" ? (
                <Textarea
                  rows={3}
                  value={typeof answers[q.id] === "string" ? (answers[q.id] as string) : ""}
                  onChange={(e) => setAnswer(q.id, e.target.value)}
                  placeholder="写你的回答"
                  maxLength={2000}
                />
              ) : null}
            </div>
          </div>
        ))}
      </div>

      <Button size="lg" block className="mt-5" disabled={submitting} onClick={submit}>
        {submitting ? "提交中…" : "提交问卷"}
      </Button>
      <p className="mt-2 text-center text-[11px] leading-5 text-ink-soft">
        提交后可以重新填写，以最后一次为准。
      </p>
    </section>
  );
}

function range(min: number, max: number): number[] {
  const out: number[] = [];
  for (let n = min; n <= max; n += 1) out.push(n);
  return out;
}

function renderAnswer(q: Question, value: Answer | undefined): string {
  if (value === undefined || value === null || value === "") return "（未作答）";
  if (Array.isArray(value)) return value.length ? value.join("、") : "（未作答）";
  return String(value);
}
