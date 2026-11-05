"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, RefreshCw, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/toast";
import { postJson } from "@/lib/api-client";
import { cn } from "@/lib/cn";

type Summary = {
  total: number;
  scored: number;
  unscored: number;
  passed: number;
  failed: number;
  unknown: number;
  average: number | null;
};

type Row = {
  id: string;
  name: string;
  school: string | null;
  verified: boolean;
  credit: number;
  score: number | null;
  reason: string | null;
  passed: boolean | null;
  status: string;
  submittedAt: string;
  invitedAt: string | null;
  answers: { title: string; answer: string }[];
};

export function ResponsesBoard({
  experimentId,
  experimentTitle,
  mode,
  questionnaire,
  summary,
  responses,
}: {
  experimentId: string;
  experimentTitle: string;
  mode: "ONLINE" | "OFFLINE";
  questionnaire: { title: string; status: string; passScore: number | null };
  summary: Summary;
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

  const threshold = passScore.trim() === "" ? null : Number(passScore);
  const qualified = responses.filter(
    (r) => r.passed === true || (r.passed === null && r.score !== null && threshold !== null && r.score >= threshold),
  );

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
        <p className="text-[14px] font-medium text-ink">{questionnaire.title}</p>
        <p className="mt-0.5 text-[11px] text-ink-soft">
          {questionnaire.status === "PUBLISHED" ? "已发布" : "草稿（被试看不到）"} ·{" "}
          {mode === "ONLINE" ? "线上实验" : "线下实验"}
        </p>

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
        <h2 className="text-[14px] font-medium text-ink">
          答卷 <span className="num text-ink-soft">{responses.length}</span>
        </h2>

        {responses.length === 0 ? (
          <p className="rounded-card border border-dashed border-line px-4 py-8 text-center text-[12px] text-ink-soft">
            还没有人填写。问卷发布后，被试在实验详情页就能看到入口。
          </p>
        ) : null}

        {responses.map((row) => {
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
                    {row.answers.map((a, i) => (
                      <div key={i}>
                        <p className="text-[11px] text-ink-soft">
                          <span className="num mr-1">{i + 1}.</span>
                          {a.title}
                        </p>
                        <p className="mt-0.5 text-[12px] leading-5 text-ink">{a.answer}</p>
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
