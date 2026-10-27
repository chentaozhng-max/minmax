"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { TabBar } from "@/components/tab-bar";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { SlotBatchGenerator, type SlotDraft } from "@/components/slot-batch-generator";
import { toast } from "@/components/toast";
import { postJson } from "@/lib/api-client";
import {
  addDaysToDateStr,
  formatDateTimeCN,
  formatDateTimeInput,
  formatDayCN,
  formatHM,
  todayInShanghai,
} from "@/lib/time";
import { cn } from "@/lib/cn";

export function NewExperimentForm() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [durationMin, setDurationMin] = useState("30");
  const [rewardText, setRewardText] = useState("¥30");
  const [type, setType] = useState<"INDIVIDUAL" | "GROUP">("INDIVIDUAL");
  const [groupSize, setGroupSize] = useState("3");
  const [requirements, setRequirements] = useState("");
  const [minCreditScore, setMinCreditScore] = useState("0");
  const [needsVerification, setNeedsVerification] = useState(true);
  // 默认报名截止设在明天中午：比默认的第一批时段（明天 14:00 起）更早，默认路径不会卡在校验上
  const [deadline, setDeadline] = useState(`${addDaysToDateStr(todayInShanghai(), 1)}T12:00`);

  const [slots, setSlots] = useState<SlotDraft[]>([]);

  const grouped = useMemo(() => {
    const map = new Map<string, SlotDraft[]>();
    for (const slot of slots) {
      const key = new Date(slot.startAt).toISOString().slice(0, 10);
      const list = map.get(key) ?? [];
      list.push(slot);
      map.set(key, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [slots]);

  function mergeSlots(generated: SlotDraft[]) {
    setSlots((prev) => {
      const keys = new Set(prev.map((s) => s.startAt));
      const merged = [...prev];
      for (const slot of generated) if (!keys.has(slot.startAt)) merged.push(slot);
      return merged.sort((a, b) => a.startAt.localeCompare(b.startAt));
    });

    // 报名截止必须早于最早时段。生成时段后如果冲突，直接把截止时间调到最早时段前 2 小时，
    // 否则用户会在第 2 步被卡住却不知道要改哪个字段。
    const earliest = Math.min(...generated.map((s) => new Date(s.startAt).getTime()));
    if (new Date(`${deadline}:00+08:00`).getTime() >= earliest) {
      const adjusted = new Date(earliest - 2 * 3600 * 1000);
      setDeadline(formatDateTimeInput(adjusted));
      toast(
        `已生成 ${generated.length} 个时段；报名截止自动改为 ${formatDateTimeCN(adjusted)}`,
      );
      return;
    }

    toast(`已生成 ${generated.length} 个时段`);
  }

  function next() {
    if (step === 1) {
      if (title.trim().length < 4) return toast("标题至少 4 个字", "error");
      if (description.trim().length < 10) return toast("描述至少 10 个字", "error");
      if (!location.trim()) return toast("填一下实验地点", "error");
      if (Number(minCreditScore) < 0 || Number(minCreditScore) > 100)
        return toast("信誉门槛要在 0–100 之间", "error");
      if (type === "GROUP" && Number(groupSize) < 2) return toast("团体实验人数至少 2", "error");
    }
    if (step === 2) {
      if (slots.length === 0) return toast("至少加一个时段", "error");
      const earliest = Math.min(...slots.map((s) => new Date(s.startAt).getTime()));
      if (new Date(`${deadline}:00+08:00`).getTime() >= earliest)
        return toast("报名截止时间必须早于最早时段", "error");
    }
    setStep((s) => Math.min(3, s + 1));
  }

  async function submit(publish: boolean) {
    setSubmitting(true);
    try {
      const data = await postJson<{ id: string }>("/api/experiments", {
        title: title.trim(),
        description: description.trim(),
        location: location.trim(),
        durationMin: Number(durationMin),
        rewardText: rewardText.trim(),
        type,
        groupSize: type === "GROUP" ? Number(groupSize) : null,
        requirements: requirements.trim() || undefined,
        minCreditScore: Number(minCreditScore),
        needsVerification,
        signupDeadline: new Date(`${deadline}:00+08:00`).toISOString(),
        slots,
        publish,
      });
      toast(publish ? "实验已发布" : "已保存为草稿");
      router.replace(`/r/experiments/${data.id}`);
    } catch (error) {
      toast(error instanceof Error ? error.message : "发布失败", "error");
      setSubmitting(false);
    }
  }

  return (
    <main className="shell with-actionbar">
      <PageHeader title="发布实验" back="auto" profile={{ role: "RESEARCHER" }} />

      <div className="flex items-center gap-1 px-4 pt-3">
        {["基本信息", "时段", "确认"].map((label, i) => {
          const index = i + 1;
          const active = step === index;
          const done = step > index;
          return (
            <div key={label} className="flex flex-1 items-center gap-1">
              <span
                className={cn(
                  "flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-medium",
                  active && "bg-moss text-white",
                  done && "bg-moss/15 text-moss",
                  !active && !done && "bg-mist text-ink-soft",
                )}
              >
                {index}
              </span>
              <span
                className={cn(
                  "text-[12px]",
                  active ? "font-medium text-ink" : "text-ink-soft",
                )}
              >
                {label}
              </span>
              {i < 2 ? <span className="ml-1 h-px flex-1 bg-line" /> : null}
            </div>
          );
        })}
      </div>

      <div className="px-4 pt-4">
        {step === 1 ? (
          <div className="space-y-3">
            <Field label="实验标题">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例：面孔吸引力判断实验" maxLength={60} />
            </Field>
            <Field label="实验说明" hint={`${description.length}/800`}>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={5}
                maxLength={800}
                placeholder="被试需要做什么、用多久、数据怎么处理"
              />
            </Field>
            <Field label="地点">
              <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="例：俊秀楼 305 认知实验室" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="时长（分钟）">
                <Input
                  inputMode="numeric"
                  value={durationMin}
                  onChange={(e) => setDurationMin(e.target.value.replace(/\D/g, ""))}
                />
              </Field>
              <Field label="报酬">
                <Input value={rewardText} onChange={(e) => setRewardText(e.target.value)} placeholder="¥30 / 1 学分" />
              </Field>
            </div>

            <Field label="实验类型">
              <div className="flex gap-2">
                {(["INDIVIDUAL", "GROUP"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setType(t)}
                    className={cn(
                      "h-10 flex-1 rounded-[10px] border text-[13px]",
                      type === t ? "border-moss bg-moss-tint text-moss" : "border-line bg-surface text-ink-soft",
                    )}
                  >
                    {t === "INDIVIDUAL" ? "一对一" : "团体"}
                  </button>
                ))}
              </div>
            </Field>
            {type === "GROUP" ? (
              <Field label="团体人数" hint="每个时段同时到场的被试数">
                <Input
                  inputMode="numeric"
                  value={groupSize}
                  onChange={(e) => setGroupSize(e.target.value.replace(/\D/g, ""))}
                />
              </Field>
            ) : null}

            <Field label="参加要求" hint="选填">
              <Textarea
                value={requirements}
                onChange={(e) => setRequirements(e.target.value)}
                rows={2}
                placeholder="例：矫正视力正常；近三个月未参加过同类实验"
              />
            </Field>

            <Field label="信誉分门槛" hint="0–100">
              <Input
                inputMode="numeric"
                value={minCreditScore}
                onChange={(e) => setMinCreditScore(e.target.value.replace(/\D/g, "").slice(0, 3))}
              />
            </Field>
            <Field label="报名截止" hint="必须早于最早时段">
              <Input type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
            </Field>

            <label className="flex items-center justify-between rounded-[10px] border border-line bg-surface px-3 py-2.5">
              <span>
                <span className="block text-[13px] text-ink">仅限已认证学生报名</span>
                <span className="block text-[11px] text-ink-soft">未认证的用户会被拦在报名之外</span>
              </span>
              <input
                type="checkbox"
                checked={needsVerification}
                onChange={(e) => setNeedsVerification(e.target.checked)}
                className="h-5 w-5 accent-[#2e5e4e]"
              />
            </label>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="space-y-3">
            <SlotBatchGenerator defaultSegment={Number(durationMin) || 30} onGenerate={mergeSlots} />

            <div className="flex items-baseline justify-between">
              <h3 className="section-title">
                已添加 <span className="num text-ink">{slots.length}</span> 个时段
              </h3>
              {slots.length > 0 ? (
                <button type="button" onClick={() => setSlots([])} className="text-[11px] text-danger">
                  全部清空
                </button>
              ) : null}
            </div>

            {slots.length === 0 ? (
              <div className="rounded-card border border-dashed border-line bg-surface/60 px-4 py-8 text-center text-[12px] text-ink-soft">
                还没有时段。用上面的批量生成，或按需调整后再生成。
              </div>
            ) : (
              <div className="space-y-2">
                {grouped.map(([day, list]) => (
                  <div key={day} className="rounded-card border border-line bg-surface p-2.5">
                    <p className="mb-1.5 text-[12px] font-medium text-ink">
                      {formatDayCN(new Date(list[0].startAt))}
                      <span className="num ml-1.5 text-ink-soft">{list.length} 段</span>
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {list.map((slot) => (
                        <span
                          key={slot.startAt}
                          className="num inline-flex items-center gap-1 rounded-[5px] border border-line bg-paper px-1.5 py-0.5 text-[11px] text-ink"
                        >
                          {formatHM(new Date(slot.startAt))}
                          <span className="text-ink-soft">×{slot.capacity}</span>
                          <button
                            type="button"
                            aria-label="删除该时段"
                            onClick={() => setSlots((prev) => prev.filter((s) => s.startAt !== slot.startAt))}
                            className="text-ink-soft/60"
                          >
                            <Trash2 size={11} />
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}

        {step === 3 ? (
          <div className="space-y-3">
            <div className="rounded-card border border-line bg-surface p-4">
              <h3 className="text-[16px] font-semibold text-ink">{title}</h3>
              <p className="mt-1 text-[12px] text-ink-soft">
                {location} · <span className="num">{durationMin} 分钟</span> · {rewardText} ·{" "}
                {type === "GROUP" ? `团体 ${groupSize} 人` : "一对一"}
              </p>
              <div className="mt-2 space-y-1 text-[12px] text-ink-soft">
                <p>
                  报名截止：
                  <span className="num text-ink">
                    {formatDateTimeCN(new Date(`${deadline}:00+08:00`))}
                  </span>
                </p>
                <p>
                  信誉门槛 <span className="num text-ink">{minCreditScore}</span> ·{" "}
                  {needsVerification ? "需学生认证" : "不限认证"}
                </p>
                <p>
                  时段 <span className="num text-ink">{slots.length}</span> 个，总容量{" "}
                  <span className="num text-ink">
                    {slots.reduce((n, s) => n + s.capacity, 0)}
                  </span>
                </p>
              </div>
              <p className="mt-2 line-clamp-4 text-[12px] leading-5 text-ink-soft">{description}</p>
            </div>

            <div className="rounded-card border border-line bg-surface p-3">
              <p className="mb-1.5 text-[12px] font-medium text-ink">时段一览</p>
              <div className="space-y-1">
                {grouped.slice(0, 6).map(([day, list]) => (
                  <p key={day} className="num text-[11px] text-ink-soft">
                    {formatDayCN(new Date(list[0].startAt))}：{list.map((s) => formatHM(new Date(s.startAt))).join("、")}
                  </p>
                ))}
                {grouped.length > 6 ? (
                  <p className="text-[11px] text-ink-soft">…还有 {grouped.length - 6} 天</p>
                ) : null}
              </div>
            </div>

            <p className="text-[11px] leading-5 text-ink-soft">
              发布后被试就能在列表里看到。被试只能从你开放的这些时段里挑，系统不会自己加时间。
            </p>
          </div>
        ) : null}
      </div>

      <div className="fixed bottom-14 left-0 right-0 z-30 border-t border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-[480px] gap-2 px-4 py-2.5">
          {step > 1 ? (
            <Button variant="outline" size="lg" onClick={() => setStep((s) => s - 1)} className="flex-1">
              上一步
            </Button>
          ) : null}
          {step < 3 ? (
            <Button size="lg" className="flex-[2]" onClick={next}>
              下一步
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                size="lg"
                className="flex-1"
                loading={submitting}
                onClick={() => submit(false)}
              >
                存草稿
              </Button>
              <Button size="lg" className="flex-[2]" loading={submitting} onClick={() => submit(true)}>
                发布
              </Button>
            </>
          )}
        </div>
      </div>

      <TabBar role="RESEARCHER" />
    </main>
  );
}
