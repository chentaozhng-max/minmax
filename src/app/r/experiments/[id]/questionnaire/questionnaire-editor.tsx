"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ArrowDown, ArrowUp, FileUp, Plus, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { toast } from "@/components/toast";
import { postForm, postJson } from "@/lib/api-client";
import { cn } from "@/lib/cn";

type QuestionType = "SINGLE" | "MULTI" | "SCALE" | "TEXT";

type EditableQuestion = {
  key: string;
  type: QuestionType;
  title: string;
  required: boolean;
  options: string[];
  scaleMin: number;
  scaleMax: number;
};

type Initial = {
  title: string;
  intro: string;
  status: "DRAFT" | "PUBLISHED";
  scoringRule: string;
  passScore: number | null;
  questions: EditableQuestion[];
};

const TYPE_LABEL: Record<QuestionType, string> = {
  SINGLE: "单选",
  MULTI: "多选",
  SCALE: "量表",
  TEXT: "填空",
};

function keyOf() {
  return Math.random().toString(36).slice(2, 10);
}

export function QuestionnaireEditor({
  experiment,
  initial,
  responseCount,
}: {
  experiment: { id: string; title: string; mode: "ONLINE" | "OFFLINE"; status: string };
  initial: Initial;
  responseCount: number;
}) {
  const [title, setTitle] = useState(initial.title);
  const [intro, setIntro] = useState(initial.intro);
  const [questions, setQuestions] = useState<EditableQuestion[]>(initial.questions);
  const [scoringRule, setScoringRule] = useState(initial.scoringRule);
  const [passScore, setPassScore] = useState(initial.passScore === null ? "" : String(initial.passScore));
  const [status, setStatus] = useState(initial.status);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [brief, setBrief] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [experimentStatus, setExperimentStatus] = useState(experiment.status);

  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  function update(index: number, patch: Partial<EditableQuestion>) {
    setQuestions((prev) => prev.map((q, i) => (i === index ? { ...q, ...patch } : q)));
  }

  function remove(index: number) {
    setQuestions((prev) => prev.filter((_, i) => i !== index));
  }

  function move(index: number, delta: number) {
    setQuestions((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function addQuestion() {
    setQuestions((prev) => [
      ...prev,
      {
        key: keyOf(),
        type: "SINGLE",
        title: "",
        required: true,
        options: ["", ""],
        scaleMin: 1,
        scaleMax: 5,
      },
    ]);
  }

  async function importFile() {
    const file = fileRef.current?.files?.[0];
    if (!file && !brief.trim()) return toast("选一份文件，或写一句你想问什么", "error");

    setImporting(true);
    setNotice(null);
    try {
      const form = new FormData();
      if (file) form.append("file", file);
      if (brief.trim()) form.append("brief", brief.trim());

      const data = await postForm<{
        draft: { title: string; intro: string; questions: Omit<EditableQuestion, "key">[] };
        notice: string | null;
        mode: string;
        chars: number;
      }>(`/api/r/experiments/${experiment.id}/questionnaire/import`, form);

      const draft = data.draft;
      setQuestions(
        draft.questions.map((q) => ({
          ...q,
          key: keyOf(),
          scaleMin: q.scaleMin ?? 1,
          scaleMax: q.scaleMax ?? 5,
        })),
      );
      if (draft.title) setTitle(draft.title);
      setIntro(draft.intro || intro);
      setNotice(
        data.notice ??
          (data.chars
            ? `已读取 ${data.chars} 个字，生成 ${draft.questions.length} 道题，请逐题核对。`
            : `已生成 ${draft.questions.length} 道题。`),
      );
      toast(data.mode === "llm" ? "已用 AI 填写题目" : "已按规则填写题目");
    } catch (error) {
      toast(error instanceof Error ? error.message : "生成失败", "error");
    } finally {
      setImporting(false);
    }
  }

  async function save(publish: boolean) {
    if (questions.length === 0) return toast("至少加一道题", "error");
    if (questions.some((q) => !q.title.trim())) return toast("有题目还没填题干", "error");
    if (questions.some((q) => (q.type === "SINGLE" || q.type === "MULTI") && q.options.filter((o) => o.trim()).length < 2)) {
      return toast("选择题至少要有两个选项", "error");
    }

    setSaving(true);
    try {
      const payload = {
        title: title.trim(),
        intro: intro.trim(),
        questions: questions.map((q) => ({
          type: q.type,
          title: q.title.trim(),
          required: q.required,
          options: q.type === "SINGLE" || q.type === "MULTI" ? q.options.map((o) => o.trim()).filter(Boolean) : [],
          scaleMin: q.type === "SCALE" ? q.scaleMin : null,
          scaleMax: q.type === "SCALE" ? q.scaleMax : null,
        })),
        scoringRule: scoringRule.trim() || null,
        passScore: passScore.trim() === "" ? null : Number(passScore),
        publish,
      };
      const data = await postJson<{ status: "DRAFT" | "PUBLISHED" }>(
        `/api/r/experiments/${experiment.id}/questionnaire`,
        payload,
      );
      setStatus(data.status);
      // 发布完就是「这件事做完了」，停在原地只会让人怀疑没成功。
      // 保存草稿不跳：还在改，跳走会打断
      if (publish) {
        // 线上实验的问卷就是实验本身，问卷发布完实验也该上线了；
        // 让人回去再点一次「发布实验」容易漏。上架失败就留在原地，按钮还在
        if (experimentStatus !== "PUBLISHED") {
          try {
            await postJson(`/api/r/experiments/${experiment.id}/publish`, { publish: true });
            setExperimentStatus("PUBLISHED");
          } catch (error) {
            toast(
              `问卷已发布，但实验上架没成功：${error instanceof Error ? error.message : "请稍后重试"}`,
              "error",
            );
            return;
          }
        }
        toast("问卷已发布，实验已上线");
        router.push("/r/experiments");
        return;
      }
      toast("已保存");
    } catch (error) {
      toast(error instanceof Error ? error.message : "保存失败", "error");
    } finally {
      setSaving(false);
    }
  }

  async function publishExperiment() {
    setSaving(true);
    try {
      await postJson(`/api/r/experiments/${experiment.id}/publish`, { publish: true });
      setExperimentStatus("PUBLISHED");
      toast("实验已发布，被试现在能看到它");
    } catch (error) {
      toast(error instanceof Error ? error.message : "发布失败", "error");
    } finally {
      setSaving(false);
    }
  }

  const totalPoints = questions.length;

  return (
    <section className="px-4 pb-8 pt-3">
      <div className="rounded-card border border-line bg-surface p-4">
        <div className="flex items-center justify-between">
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[11px]",
              status === "PUBLISHED" ? "bg-moss-tint text-moss" : "bg-mist text-ink-soft",
            )}
          >
            {status === "PUBLISHED" ? "问卷已发布" : "问卷草稿"}
          </span>
          <Link
            href={`/r/experiments/${experiment.id}/responses`}
            className="text-[12px] font-medium text-moss"
          >
            答卷后台{responseCount > 0 ? `（${responseCount}）` : ""}
          </Link>
        </div>
        <p className="mt-2 text-[11px] leading-5 text-ink-soft">
          {experiment.mode === "ONLINE"
            ? "线上实验：被试提交问卷即视为完成，不需要预约。"
            : "线下实验：被试填完问卷后，要等你在这里通过筛选才能预约时段。"}
        </p>
      </div>

      <div className="mt-3 rounded-card border border-moss/25 bg-moss-tint/40 p-4">
        <div className="flex items-center gap-1.5">
          <FileUp size={15} className="text-moss" />
          <p className="text-[13px] font-medium text-ink">上传实验材料，让 AI 填写题目</p>
        </div>
        <p className="mt-1 text-[11px] leading-5 text-ink-soft">
          支持 PDF / Word(.docx) / Excel / TXT，10 MB 以内。没有文件也可以写一句要求。
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.docx,.xlsx,.xls,.txt,.md,.csv"
          className="mt-2 block w-full text-[12px] text-ink-soft file:mr-2 file:rounded-full file:border-0 file:bg-moss file:px-3 file:py-1.5 file:text-[12px] file:text-white"
        />
        <Input
          className="mt-2"
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder="补充要求，例：加两道 1–5 分的量表题，筛掉做过同类实验的人"
          maxLength={500}
        />
        <Button className="mt-2" size="sm" block disabled={importing} onClick={importFile}>
          {importing ? "正在读文件并填写…" : "填写题目"}
        </Button>
        {notice ? <p className="mt-2 text-[11px] leading-5 text-moss">{notice}</p> : null}
      </div>

      <div className="mt-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-[14px] font-medium text-ink">
            题目 <span className="num text-ink-soft">{totalPoints}</span>
          </h2>
          <button
            type="button"
            onClick={addQuestion}
            className="flex items-center gap-1 text-[12px] font-medium text-moss"
          >
            <Plus size={14} /> 加一题
          </button>
        </div>

        {questions.length === 0 ? (
          <p className="rounded-card border border-dashed border-line px-4 py-8 text-center text-[12px] text-ink-soft">
            还没有题目。上传材料让 AI 填写，或点「加一题」手动写。
          </p>
        ) : null}

        {questions.map((q, index) => (
          <div key={q.key} className="rounded-card border border-line bg-surface p-3.5">
            <div className="flex items-center gap-2">
              <span className="num text-[12px] text-ink-soft">{index + 1}</span>
              <select
                value={q.type}
                onChange={(e) => update(index, { type: e.target.value as QuestionType })}
                className="h-8 rounded-[6px] border border-line bg-surface px-2 text-[12px] text-ink"
              >
                {(Object.keys(TYPE_LABEL) as QuestionType[]).map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
              <label className="ml-auto flex items-center gap-1 text-[11px] text-ink-soft">
                <input
                  type="checkbox"
                  checked={q.required}
                  onChange={(e) => update(index, { required: e.target.checked })}
                  className="h-4 w-4 accent-[#2e5e4e]"
                />
                必答
              </label>
              <button type="button" onClick={() => move(index, -1)} className="p-1 text-ink-soft" aria-label="上移">
                <ArrowUp size={14} />
              </button>
              <button type="button" onClick={() => move(index, 1)} className="p-1 text-ink-soft" aria-label="下移">
                <ArrowDown size={14} />
              </button>
              <button type="button" onClick={() => remove(index)} className="p-1 text-danger" aria-label="删除">
                <Trash2 size={14} />
              </button>
            </div>

            <Input
              className="mt-2"
              value={q.title}
              onChange={(e) => update(index, { title: e.target.value })}
              placeholder="题干，例：过去三个月你参加过同类实验吗？"
              maxLength={200}
            />

            {q.type === "SINGLE" || q.type === "MULTI" ? (
              <div className="mt-2 space-y-1.5">
                {q.options.map((option, oi) => (
                  <div key={oi} className="flex items-center gap-1.5">
                    <span className="text-[11px] text-ink-soft">{String.fromCharCode(65 + oi)}</span>
                    <Input
                      value={option}
                      onChange={(e) =>
                        update(index, {
                          options: q.options.map((o, i) => (i === oi ? e.target.value : o)),
                        })
                      }
                      placeholder={`选项 ${oi + 1}`}
                      maxLength={80}
                    />
                    <button
                      type="button"
                      onClick={() => update(index, { options: q.options.filter((_, i) => i !== oi) })}
                      className="p-1 text-ink-soft"
                      aria-label="删除选项"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => update(index, { options: [...q.options, ""] })}
                  className="text-[11px] font-medium text-moss"
                >
                  + 加选项
                </button>
              </div>
            ) : null}

            {q.type === "SCALE" ? (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-[11px] text-ink-soft">从</span>
                <Input
                  className="w-14"
                  inputMode="numeric"
                  value={String(q.scaleMin)}
                  onChange={(e) => update(index, { scaleMin: Number(e.target.value.replace(/\D/g, "")) || 1 })}
                />
                <span className="text-[11px] text-ink-soft">到</span>
                <Input
                  className="w-14"
                  inputMode="numeric"
                  value={String(q.scaleMax)}
                  onChange={(e) => update(index, { scaleMax: Number(e.target.value.replace(/\D/g, "")) || 5 })}
                />
                <span className="text-[11px] text-ink-soft">分</span>
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-card border border-line bg-surface p-4">
        <div className="flex items-center gap-1.5">
          <Sparkles size={14} className="text-moss" />
          <h2 className="text-[14px] font-medium text-ink">评分与筛选</h2>
        </div>
        <p className="mt-1 text-[11px] leading-5 text-ink-soft">
          AI 按你写的规则给每份答卷打 0–100 分；达到分数线的人才能收到预约邀请。
        </p>

        <Field label="评分要求" hint="给 AI 看的评分标准">
          <Textarea
            rows={4}
            value={scoringRule}
            onChange={(e) => setScoringRule(e.target.value)}
            placeholder="例：每周冥想 ≥4 次得 40 分，2–3 次得 25 分，≤1 次得 5 分；有冥想经验但不足半年加 20 分；总分为两项之和。"
            maxLength={2000}
          />
        </Field>

        <Field label="通过分数线" hint="0–100，留空表示不筛选">
          <Input
            inputMode="numeric"
            value={passScore}
            onChange={(e) => setPassScore(e.target.value.replace(/\D/g, "").slice(0, 3))}
            placeholder="60"
          />
        </Field>
      </div>

      <div className="mt-4 rounded-card border border-line bg-surface p-4">
        <p className="text-[13px] font-medium text-ink">实验状态</p>
        <p className="mt-1 text-[11px] leading-5 text-ink-soft">
          {experimentStatus === "PUBLISHED"
            ? "已发布，被试可以在列表里看到。改问卷不会影响已提交的答卷。"
            : "还没发布。问卷发布后，点下面的按钮让实验上线。"}
        </p>
        {experimentStatus !== "PUBLISHED" ? (
          <Button
            className="mt-2"
            size="sm"
            block
            disabled={saving || status !== "PUBLISHED"}
            onClick={publishExperiment}
          >
            {status === "PUBLISHED" ? "发布实验" : "先发布问卷"}
          </Button>
        ) : null}
      </div>

      <div className="mt-5 flex gap-2">
        <Button size="lg" variant="outline" className="flex-1" disabled={saving} onClick={() => save(false)}>
          保存
        </Button>
        <Button size="lg" className="flex-1" disabled={saving} onClick={() => save(true)}>
          {saving ? "处理中…" : "保存并发布问卷"}
        </Button>
      </div>

      {/* 发布后已经没有「下一步」了，给一条随时能走的路 */}
      <Link
        href={`/r/experiments/${experiment.id}`}
        className="mt-3 block text-center text-[13px] text-moss"
      >
        返回实验详情
      </Link>
    </section>
  );
}
