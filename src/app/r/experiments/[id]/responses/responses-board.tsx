"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BarChart3, ChevronDown, ChevronUp, Download, RefreshCw, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/toast";
import { postJson } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { formatAnswer, type AnswerMap } from "@/domain/questionnaire";
import { summarizeAnswers, type QuestionStat, type StatQuestion } from "@/domain/question-stats";

type Summary = {
  total: number;
  scored: number;
  unscored: number;
  passed: number;
  failed: number;
  unknown: number;
  average: number | null;
};

/** 和 QuestionStat 的三态对齐：通过 / 未通过 / 待定（未算分或没设分数线） */
type PassState = "PASS" | "FAIL" | "UNKNOWN";
type PassFilter = "ALL" | PassState;

type Row = {
  id: string;
  name: string;
  school: string | null;
  verified: boolean;
  credit: number;
  score: number | null;
  reason: string | null;
  passed: boolean | null;
  passState: PassState;
  status: string;
  submittedAt: string;
  invitedAt: string | null;
  answers: AnswerMap;
};

export function ResponsesBoard({
  experimentId,
  experimentTitle,
  mode,
  questionnaire,
  summary,
  questions,
  responses,
}: {
  experimentId: string;
  experimentTitle: string;
  mode: "ONLINE" | "OFFLINE";
  questionnaire: { title: string; status: string; passScore: number | null };
  summary: Summary;
  questions: StatQuestion[];
  responses: Row[];
}) {
  const router = useRouter();
  const [passScore, setPassScore] = useState(
    questionnaire.passScore === null ? "" : String(questionnaire.passScore),
  );
  const [goal, setGoal] = useState("");
  const [message, setMessage] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState<"suggest" | "save" | "score" | "invite" | null>(null);
  const [filter, setFilter] = useState<PassFilter>("ALL");
  const [showStats, setShowStats] = useState(false);

  const threshold = passScore.trim() === "" ? null : Number(passScore);
  const qualified = responses.filter(
    (r) => r.passed === true || (r.passed === null && r.score !== null && threshold !== null && r.score >= threshold),
  );

  const visible = filter === "ALL" ? responses : responses.filter((r) => r.passState === filter);
  const stats = showStats ? summarizeAnswers(questions, responses) : [];

  async function suggest() {
    if (!goal.trim()) return toast("先说一句你的筛选要求", "error");
    setBusy("suggest");
    try {
      const data = await postJson<{ passScore: number | null; explanation: string }>(
        `/api/r/experiments/${experimentId}/questionnaire/suggest`,
        { goal: goal.trim() },
      );
      if (data.passScore !== null) setPassScore(String(data.passScore));
      toast(data.explanation);
    } catch (error) {
      toast(error instanceof Error ? error.message : "建议失败", "error");
    } finally {
      setBusy(null);
    }
  }

  async function saveThreshold() {
    setBusy("save");
    try {
      await postJson(`/api/r/experiments/${experimentId}/questionnaire/settings`, {
        passScore: threshold,
      });
      toast("分数线已保存");
      router.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : "保存失败", "error");
    } finally {
      setBusy(null);
    }
  }

  async function rescore() {
    setBusy("score");
    try {
      const data = await postJson<{ total: number; scored: number; failed: number }>(
        `/api/r/experiments/${experimentId}/questionnaire/score`,
        {},
      );
      toast(`重算完成：成功 ${data.scored} 份${data.failed ? `，${data.failed} 份仍失败` : ""}`);
      router.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : "重算失败", "error");
    } finally {
      setBusy(null);
    }
  }

  async function invite() {
    if (threshold === null) return toast("先设置分数线", "error");
    if (qualified.length === 0) return toast("当前没有人达标", "error");
    setBusy("invite");
    try {
      const data = await postJson<{ qualified: number; sent: number; alreadyInvited: number; failed: number }>(
        `/api/r/experiments/${experimentId}/questionnaire/invite`,
        { passScore: threshold, message: message.trim() || null },
      );
      toast(
        `达标 ${data.qualified} 人，本次通知 ${data.sent} 人${data.alreadyInvited ? `，${data.alreadyInvited} 人之前已通知` : ""}${data.failed ? `，${data.failed} 人发送失败` : ""}`,
      );
      router.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : "发送失败", "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="px-4 pb-10 pt-3">
      <div className="rounded-card border border-line bg-surface p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[14px] font-medium text-ink">{questionnaire.title}</p>
            <p className="mt-0.5 text-[11px] text-ink-soft">
              {questionnaire.status === "PUBLISHED" ? "已发布" : "草稿（被试看不到）"} ·{" "}
              {mode === "ONLINE" ? "线上实验" : "线下实验"}
            </p>
          </div>
          {/* 没有答卷时不显示：空表导下去只会让人以为坏了 */}
          {summary.total > 0 ? (
            <a
              href={`/api/r/experiments/${experimentId}/questionnaire/export`}
              className="shrink-0 rounded-pill border border-line px-2.5 py-1 text-[11px] text-moss active:bg-mist"
            >
              <Download size={11} className="mr-1 inline align-[-1px]" />
              导出 CSV
            </a>
          ) : null}
        </div>

        <div className="mt-3 grid grid-cols-4 gap-2 text-center">
          {[
            { label: "答卷", value: summary.total },
            { label: "已评分", value: summary.scored },
            { label: "达标", value: summary.passed },
            { label: "均分", value: summary.average ?? "—" },
          ].map((item) => (
            <div key={item.label} className="rounded-[8px] bg-mist/60 py-2">
              <p className="num text-[16px] font-semibold text-ink">{item.value}</p>
              <p className="text-[10px] text-ink-soft">{item.label}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3 rounded-card border border-line bg-surface p-4">
        <div className="flex items-center gap-1.5">
          <Sparkles size={14} className="text-moss" />
          <p className="text-[13px] font-medium text-ink">用一句话设门槛</p>
        </div>
        <div className="mt-2 flex gap-2">
          <Input
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="例：只要得分 60 分以上的"
            maxLength={200}
          />
          <Button size="sm" disabled={busy === "suggest"} onClick={suggest} className="shrink-0">
            问 AI
          </Button>
        </div>

        <div className="mt-3 flex items-end gap-2">
          <label className="flex-1">
            <span className="mb-1 block text-[11px] text-ink-soft">通过分数线</span>
            <Input
              inputMode="numeric"
              value={passScore}
              onChange={(e) => setPassScore(e.target.value.replace(/\D/g, "").slice(0, 3))}
              placeholder="60"
            />
          </label>
          <Button size="sm" variant="outline" disabled={busy === "save"} onClick={saveThreshold}>
            保存
          </Button>
          <Button size="sm" variant="outline" disabled={busy === "score"} onClick={rescore}>
            <RefreshCw size={13} className="mr-1" />
            {busy === "score" ? "打分中" : "重算"}
          </Button>
        </div>

        <p className="mt-2 text-[11px] leading-5 text-ink-soft">
          当前达标 <span className="num text-ink">{qualified.length}</span> 人
          {summary.unscored > 0 ? ` · 还有 ${summary.unscored} 份没打分` : ""}
        </p>
      </div>

      <div className="mt-3 rounded-card border border-line bg-surface p-4">
        <p className="text-[13px] font-medium text-ink">
          {mode === "ONLINE" ? "给达标者发消息" : "邀请达标者预约"}
        </p>
        <p className="mt-1 text-[11px] leading-5 text-ink-soft">
          {mode === "ONLINE"
            ? "通过筛选的人会收到站内消息，可用来约后续环节。未达标的不发。"
            : "只有被邀请的人才能选时段。未达标的不会收到消息。"}
        </p>
        <Input
          className="mt-2"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={
            mode === "ONLINE"
              ? "附一句话（选填），例：请回复你方便的时间"
              : "附一句话（选填），例：请在本周内选一个时段"
          }
          maxLength={200}
        />
        <Button
          className="mt-2"
          size="sm"
          block
          disabled={busy === "invite" || qualified.length === 0}
          onClick={invite}
        >
          <Send size={13} className="mr-1" />
          {busy === "invite" ? "发送中…" : `给 ${qualified.length} 人发消息`}
        </Button>
      </div>

      <div className="mt-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[14px] font-medium text-ink">
            答卷 <span className="num text-ink-soft">{responses.length}</span>
          </h2>
          {responses.length > 0 ? (
            <button
              type="button"
              onClick={() => setShowStats((v) => !v)}
              className="rounded-pill border border-line px-2.5 py-1 text-[11px] text-moss active:bg-mist"
            >
              <BarChart3 size={11} className="mr-1 inline align-[-1px]" />
              {showStats ? "收起分布" : "看题目分布"}
            </button>
          ) : null}
        </div>

        {/* 三个筛选项与上面的统计口径一一对应，数字能对上 */}
        {responses.length > 0 ? (
          <div className="flex gap-1.5">
            {(
              [
                { key: "ALL", label: "全部", count: summary.total },
                { key: "PASS", label: "通过", count: summary.passed },
                { key: "FAIL", label: "未通过", count: summary.failed },
                { key: "UNKNOWN", label: "待定", count: summary.unknown },
              ] as const
            ).map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setFilter(item.key)}
                className={cn(
                  "press flex-1 rounded-pill py-1.5 text-[12px]",
                  filter === item.key
                    ? "bg-moss text-white"
                    : "border border-line bg-surface text-ink-soft",
                )}
              >
                {item.label} <span className="num">{item.count}</span>
              </button>
            ))}
          </div>
        ) : null}

        {showStats ? <QuestionStatsPanel stats={stats} total={summary.total} /> : null}

        {responses.length === 0 ? (
          <p className="rounded-card border border-dashed border-line px-4 py-8 text-center text-[12px] text-ink-soft">
            还没有人填写。问卷发布后，被试在实验详情页就能看到入口。
          </p>
        ) : null}

        {responses.length > 0 && visible.length === 0 ? (
          <p className="rounded-card border border-dashed border-line px-4 py-8 text-center text-[12px] text-ink-soft">
            这一类里没有答卷。
          </p>
        ) : null}

        {visible.map((row) => {
          const open = expanded === row.id;
          const isQualified =
            row.passed === true ||
            (row.passed === null && row.score !== null && threshold !== null && row.score >= threshold);
          return (
            <div key={row.id} className="rounded-card border border-line bg-surface">
              <button
                type="button"
                onClick={() => setExpanded(open ? null : row.id)}
                className="flex w-full items-center gap-2 px-3.5 py-3 text-left"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[13px] text-ink">{row.name}</span>
                    {row.verified ? (
                      <span className="rounded-full bg-verify-tint px-1.5 text-[10px] text-verify">已认证</span>
                    ) : null}
                    {row.invitedAt ? (
                      <span className="rounded-full bg-moss-tint px-1.5 text-[10px] text-moss">已通知</span>
                    ) : null}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-ink-soft">
                    {row.school ?? "未填学校"} · 信誉 {row.credit} ·{" "}
                    {new Date(row.submittedAt).toLocaleString("zh-CN", { hour12: false })}
                  </span>
                </span>
                <span
                  className={cn(
                    "num shrink-0 rounded-full px-2 py-0.5 text-[12px]",
                    row.score === null
                      ? "bg-mist text-ink-soft"
                      : isQualified
                        ? "bg-moss-tint text-moss"
                        : "bg-[#f9e9e6] text-danger",
                  )}
                >
                  {row.score === null ? "待评" : `${row.score} 分`}
                </span>
                {open ? <ChevronUp size={15} className="text-ink-soft" /> : <ChevronDown size={15} className="text-ink-soft" />}
              </button>

              {open ? (
                <div className="border-t border-line px-3.5 py-3">
                  {row.reason ? (
                    <p className="mb-2 rounded-[6px] bg-mist/60 px-2.5 py-2 text-[11px] leading-5 text-ink-soft">
                      评分理由：{row.reason}
                    </p>
                  ) : null}
                  <div className="space-y-2">
                    {questions.map((q, i) => (
                      <div key={q.id}>
                        <p className="text-[11px] text-ink-soft">
                          <span className="num mr-1">{i + 1}.</span>
                          {q.title}
                        </p>
                        <p className="mt-0.5 text-[12px] leading-5 text-ink">
                          {formatAnswer(q, row.answers[q.id])}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <p className="mt-4 text-center text-[11px] leading-5 text-ink-soft">
        「{experimentTitle}」的答卷只对你自己可见。
      </p>
    </section>
  );
}

/**
 * 题目分布。
 *
 * 分母是「回答了这题的人数」，不是答卷总数 —— 选做题没填的人不该拉低比例，
 * 所以每题单独标「N 人作答」。多选题的百分比加起来会超过 100%，这是多选的
 * 正常现象，不做归一。
 */
function QuestionStatsPanel({ stats, total }: { stats: QuestionStat[]; total: number }) {
  if (stats.length === 0) return null;

  return (
    <div className="rounded-card border border-line bg-surface p-3.5">
      <p className="text-[11px] leading-5 text-ink-soft">
        共 {total} 份答卷。每题的比例以「回答了这题的人」为分母，多选题会加起来超过 100%。
      </p>

      <div className="mt-3 space-y-4">
        {stats.map((stat, index) => (
          <div key={stat.questionId}>
            <p className="text-[12px] leading-5 text-ink">
              <span className="num mr-1 text-ink-soft">{index + 1}.</span>
              {stat.title}
            </p>
            <p className="num mt-0.5 text-[10px] text-ink-soft">
              {stat.answered} 人作答
              {stat.answered < total ? `（${total - stat.answered} 人跳过）` : ""}
            </p>

            {stat.texts.length > 0 ? (
              <ul className="mt-1.5 space-y-1">
                {stat.texts.map((text, i) => (
                  <li
                    key={i}
                    className="rounded-[6px] bg-mist/50 px-2 py-1.5 text-[11px] leading-5 text-ink"
                  >
                    {text}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="mt-1.5 space-y-1">
                {stat.tallies.map((tally) => (
                  <div key={tally.label} className="flex items-center gap-2">
                    {/* 不截断：选项文案本身就是结果的一部分，「每周 3 次及…」等于没读 */}
                    <span className="w-[96px] shrink-0 text-[11px] leading-[14px] text-ink-soft">
                      {tally.label}
                    </span>
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-mist">
                      <span
                        className="block h-full rounded-full bg-moss"
                        style={{ width: `${Math.round(tally.ratio * 100)}%` }}
                      />
                    </span>
                    <span className="num w-[38px] shrink-0 text-right text-[11px] text-ink">
                      {tally.count > 0 ? `${Math.round(tally.ratio * 100)}%` : "—"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
