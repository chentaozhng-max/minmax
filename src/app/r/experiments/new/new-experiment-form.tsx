"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ChevronRight, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { SlotTimetable, toTimetableSlots, type TimetableSlot } from "@/components/slot-timetable";
import { PublishBlocked } from "@/components/publish-blocked";
import { toast } from "@/components/toast";
import { postJson } from "@/lib/api-client";
import { addDaysToDateStr, formatDateTimeCN, formatDateTimeInput, formatDayCN, formatHM } from "@/lib/time";
import { cn } from "@/lib/cn";
import { rewardLabel, toRewardText } from "@/lib/reward";
import { clearPublishDraft, readPublishDraft } from "@/lib/publish-draft-storage";
import {
  DRAFT_FIELD_LABEL,
  isPlaceholderLocation,
  prunePastSlots,
  reviewExperimentDraft,
  suggestSignupDeadline,
  type DraftIssue,
} from "@/domain/experiment-draft";

/**
 * 发布实验。
 *
 * 三处改动都围绕同一件事：**别让主试填到最后一步才知道发不出去**。
 *   1. 禁期在进页面时就拦（PublishBlocked），不是等到点发布
 *   2. 时段用课程表点，截止时间冲突当场提示并能一键修正
 *   3. 第 3 步先跑一遍领域层的体检，有 blocking 就禁用发布按钮
 *
 * 判定本身全部来自 `@/domain/experiment-draft` 与 `@/domain/experiment-rules`，
 * 页面只负责把结果画出来 —— 同一套规则也用在服务端和发布助手上。
 */
export function NewExperimentForm({
  today,
  nowIso,
  bannedUntil,
}: {
  today: string;
  nowIso: string;
  bannedUntil: string | null;
}) {
  const banned = bannedUntil ? new Date(bannedUntil) : null;
  if (banned && banned.getTime() > new Date(nowIso).getTime()) {
    return <PublishBlocked bannedUntil={banned} now={new Date(nowIso)} />;
  }
  return <NewExperimentFormInner today={today} nowIso={nowIso} />;
}

function NewExperimentFormInner({ today, nowIso }: { today: string; nowIso: string }) {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [durationMin, setDurationMin] = useState("30");
  const [rewardYuan, setRewardYuan] = useState("30");
  const [type, setType] = useState<"INDIVIDUAL" | "GROUP">("INDIVIDUAL");
  /** 线上实验：问卷即实验，不排时段；线下才需要预约 */
  const [mode, setMode] = useState<"OFFLINE" | "ONLINE">("OFFLINE");
  /** 线下实验也可以要求先填问卷（用于筛选被试） */
  const [needsQuestionnaire, setNeedsQuestionnaire] = useState(false);
  const [groupSize, setGroupSize] = useState("3");
  const [requirements, setRequirements] = useState("");
  const [minCreditScore, setMinCreditScore] = useState("0");
  const [needsVerification, setNeedsVerification] = useState(true);
  // 默认报名截止设在明天中午：比默认的第一批时段（明天 14:00 起）更早，默认路径不会卡在校验上
  const [deadline, setDeadline] = useState(`${addDaysToDateStr(today, 1)}T12:00`);

  const [slots, setSlots] = useState<TimetableSlot[]>([]);

  // 发布助手写完 → 跳到这里。只读一次，读完就删，避免下次莫名回填
  useEffect(() => {
    const draft = readPublishDraft();
    if (!draft) return;
    clearPublishDraft();

    setTitle(draft.title);
    setDescription(draft.description);
    setLocation(draft.location);
    setDurationMin(String(draft.durationMin));
    setRewardYuan(String(draft.rewardYuan));
    setType(draft.type === "GROUP" ? "GROUP" : "INDIVIDUAL");
    if (draft.groupSize) setGroupSize(String(draft.groupSize));
    setRequirements(draft.requirements);
    setMinCreditScore(String(draft.minCreditScore));
    setNeedsVerification(draft.needsVerification);

    // 草稿可能是几小时前写的：里面的过去时段直接丢掉，否则截止时间怎么改都不合法
    const now = new Date(nowIso);
    const fresh = prunePastSlots(draft.slots, now);
    setSlots(toTimetableSlots(fresh));

    const suggestion = suggestSignupDeadline(fresh, now);
    if (suggestion) setDeadline(formatDateTimeInput(suggestion));

    if (draft.slots.length > 0 && fresh.length === 0) {
      toast("助手写的时段都已经开始了，请在课程表里重新排", "error");
    } else {
      toast(
        fresh.length < draft.slots.length
          ? `已填入草稿，并去掉了 ${draft.slots.length - fresh.length} 个已开始的时段`
          : "已填入发布助手写的草稿，请逐项核对",
      );
    }
  }, [nowIso]);

  const capacity = type === "GROUP" ? Math.max(2, Number(groupSize) || 2) : 1;

  /** 容量是派生值：切类型 / 改团体人数时，已点的时段要跟着变，否则名额对不上 */
  function applyCapacity(size: number) {
    setSlots((prev) => prev.map((s) => ({ ...s, capacity: size })));
  }

  const nowMs = new Date(nowIso).getTime();
  /** 最早一个还没开始的时段 —— 已经开始的不能当截止时间的上界 */
  const firstUpcoming = useMemo(() => {
    let min: number | null = null;
    for (const slot of slots) {
      const t = new Date(slot.startAt).getTime();
      if (!Number.isFinite(t) || t <= nowMs) continue;
      if (min === null || t < min) min = t;
    }
    return min;
  }, [slots, nowMs]);

  const deadlineMs = new Date(`${deadline}:00+08:00`).getTime();
  /** 截止时间没填 / 已过去 / 晚于最早时段 —— 三种都发不出去，统一在这一处喊 */
  const deadlineConflict =
    Number.isNaN(deadlineMs) || deadlineMs <= nowMs || (firstUpcoming !== null && deadlineMs >= firstUpcoming);

  const suggestedDeadline = useMemo(
    () => suggestSignupDeadline(slots, new Date(nowIso)),
    [slots, nowIso],
  );

  const suggestedDeadlineText = suggestedDeadline ? formatDateTimeCN(suggestedDeadline) : null;

  const grouped = useMemo(() => {
    const map = new Map<string, TimetableSlot[]>();
    for (const slot of slots) {
      const key = new Date(new Date(slot.startAt).getTime() + 8 * 3600 * 1000)
        .toISOString()
        .slice(0, 10);
      const list = map.get(key) ?? [];
      list.push(slot);
      map.set(key, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [slots]);

  const formDraft = useMemo(
    () => ({
      title: title.trim(),
      description: description.trim(),
      location: location.trim(),
      durationMin: Number(durationMin) || 0,
      rewardYuan: Number(rewardYuan) || 0,
      type: type === "GROUP" ? ("GROUP" as const) : ("INDIVIDUAL" as const),
      groupSize: type === "GROUP" ? Number(groupSize) || 0 : null,
      requirements: requirements.trim(),
      minCreditScore: Number(minCreditScore) || 0,
      needsVerification,
      slots,
      slotPlan: null,
    }),
    [title, description, location, durationMin, rewardYuan, type, groupSize, requirements, minCreditScore, needsVerification, slots],
  );

  // 第 3 步的体检：和发布接口、发布助手用的是同一份规则
  const issues = useMemo(
    () =>
      reviewExperimentDraft(formDraft, {
        now: new Date(nowIso),
        // 截止时间只有手填表单知道，助手草稿不带，所以单独传
        signupDeadline: new Date(deadlineMs),
        // 线上实验不排时段，体检里跳过与时段相关的三条
        mode,
      }),
    [formDraft, nowIso, deadlineMs, mode],
  );
  const blocking = issues.filter((i) => i.level === "block");

  function fixDeadline() {
    if (!suggestedDeadline) {
      return toast("时段都开始过了，先把最早的一段往后挪", "error");
    }
    setDeadline(formatDateTimeInput(suggestedDeadline));
    toast(`报名截止已改到 ${formatDateTimeCN(suggestedDeadline)}`);
  }

  function next() {
    if (step === 1) {
      if (title.trim().length < 4) return toast("标题至少 4 个字", "error");
      if (description.trim().length < 10) return toast("描述至少 10 个字", "error");
      if (!location.trim()) return toast("填一下实验地点", "error");
      if (!toRewardText(rewardYuan)) return toast("填一下奖励金额（元）", "error");
      if (Number(durationMin) < 5) return toast("时长至少 5 分钟", "error");
      if (Number(minCreditScore) < 0 || Number(minCreditScore) > 100)
        return toast("信誉门槛要在 0–100 之间", "error");
      if (type === "GROUP" && Number(groupSize) < 2) return toast("团体实验人数至少 2", "error");
    }
    if (step === 2) {
      // 线上实验没有时段这一步，直接进确认
      if (mode === "ONLINE") {
        setStep(3);
        return;
      }
      if (slots.length === 0) return toast("在课程表里点几个时段", "error");
      // 排时段的过程中可能跨过了某个时段的开始时间：进确认页前清掉，
      // 否则名额算多了，发布时服务端也会把这些时段丢掉
      const fresh = prunePastSlots(slots, new Date());
      if (fresh.length !== slots.length) {
        setSlots(fresh);
        toast(`去掉了 ${slots.length - fresh.length} 个已开始的时段`);
      }
      if (fresh.length === 0) return toast("时段都开始了，重新点几个", "error");
      // 截止时间冲突不拦在这里：放到第 3 步的体检里给「一键修正」，
      // 否则用户被一句 toast 顶回去，还得自己回头找那一项在哪
    }
    setStep((s) => Math.min(3, s + 1));
  }

  async function submit(publish: boolean) {
    if (blocking.length > 0) {
      return toast(`还有 ${blocking.length} 项要补：${blocking[0].message}`, "error");
    }
    setSubmitting(true);
    try {
      // 需要问卷的实验不能直接发布：没有问卷，被试点进去无事可做。
      // 先落成草稿，做完问卷在编辑器里再发布。
      const needQuestionnaire = mode === "ONLINE" || needsQuestionnaire;
      const data = await postJson<{ id: string }>("/api/experiments", {
        title: title.trim(),
        description: description.trim(),
        location: location.trim(),
        durationMin: Number(durationMin),
        rewardText: toRewardText(rewardYuan),
        type,
        mode,
        needsQuestionnaire: needQuestionnaire,
        groupSize: type === "GROUP" ? Number(groupSize) : null,
        requirements: requirements.trim() || undefined,
        minCreditScore: Number(minCreditScore),
        needsVerification,
        signupDeadline: new Date(`${deadline}:00+08:00`).toISOString(),
        slots:
          mode === "ONLINE"
            ? []
            : slots.map((s) => ({ startAt: s.startAt, endAt: s.endAt, capacity: s.capacity })),
        publish: needQuestionnaire ? false : publish,
      });
      toast(
        needQuestionnaire
          ? "实验已存为草稿，接下来做问卷"
          : publish
            ? "实验已发布"
            : "已保存为草稿",
      );
      router.replace(
        needQuestionnaire
          ? `/r/experiments/${data.id}/questionnaire?first=1`
          : `/r/experiments/${data.id}`,
      );
    } catch (error) {
      toast(error instanceof Error ? error.message : "发布失败", "error");
      setSubmitting(false);
    }
  }

  return (
    <main className="shell actionbar-space">
      <PageHeader title="发布实验" back="auto" profile={{ role: "RESEARCHER" }} />

      <div className="flex items-center gap-1 px-4 pt-3">
        {["基本信息", mode === "ONLINE" ? "线上设置" : "时段", "确认"].map((label, i) => {
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
                className={cn("text-[12px]", active ? "font-medium text-ink" : "text-ink-soft")}
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
            <Field label="实验形式">
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    { key: "OFFLINE" as const, label: "线下实验", hint: "被试到实验室" },
                    { key: "ONLINE" as const, label: "线上实验", hint: "填问卷即完成" },
                  ]
                ).map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => {
                      setMode(item.key);
                      // 线上实验也要填地点（详情页会显示），给个默认值省一步
                      if (item.key === "ONLINE" && !location.trim()) setLocation("线上");
                      if (item.key === "OFFLINE" && location.trim() === "线上") setLocation("");
                    }}
                    className={cn(
                      "rounded-[10px] border px-3 py-2.5 text-left",
                      mode === item.key ? "border-moss bg-moss-tint" : "border-line bg-surface",
                    )}
                  >
                    <span
                      className={cn(
                        "block text-[13px] font-medium",
                        mode === item.key ? "text-moss" : "text-ink",
                      )}
                    >
                      {item.label}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-ink-soft">{item.hint}</span>
                  </button>
                ))}
              </div>
            </Field>

            {mode === "OFFLINE" ? (
              <label className="flex items-center justify-between rounded-[10px] border border-line bg-surface px-3 py-2.5">
                <span>
                  <span className="block text-[13px] text-ink">需要先填问卷</span>
                  <span className="block text-[11px] text-ink-soft">
                    用来筛选被试；填完还要等你在后台通过才能预约
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={needsQuestionnaire}
                  onChange={(e) => setNeedsQuestionnaire(e.target.checked)}
                  className="h-5 w-5 accent-[#2e5e4e]"
                />
              </label>
            ) : (
              <p className="rounded-[8px] bg-moss-tint/50 px-3 py-2 text-[11px] leading-5 text-ink-soft">
                线上实验必须有问卷：被试提交问卷即视为完成，不需要预约时段。
              </p>
            )}

            <Link
              href="/r/experiments/assistant"
              className="press block rounded-card border border-moss/25 bg-moss-tint/40 px-3 py-2.5"
            >
              <div className="flex items-center gap-1.5">
                <Sparkles size={14} className="text-moss" strokeWidth={2} />
                <span className="text-[13px] font-medium text-ink">不想逐项填？让发布助手写</span>
                <ChevronRight size={14} className="ml-auto text-moss" />
              </div>
              <p className="mt-1 text-[11px] leading-4 text-ink-soft">
                说一句「30 分钟、报酬 30 元、下周下午」，标题、说明、要求和时段都会填好。
              </p>
            </Link>

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
              <Input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="例：俊秀楼 305 认知实验室"
                className={isPlaceholderLocation(location) ? "border-danger/50" : undefined}
              />
            </Field>
            {/* 助手写草稿时不知道房间号，会留「待补充」；当场提醒，别等第 3 步 */}
            {isPlaceholderLocation(location) ? (
              <p className="flex items-start gap-1 text-[11px] leading-4 text-danger">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                这是助手留的占位词，换成具体楼栋和房间才能发布。
              </p>
            ) : null}
            <div className="grid grid-cols-2 gap-3">
              <Field label="时长（分钟）">
                <Input
                  inputMode="numeric"
                  value={durationMin}
                  onChange={(e) => setDurationMin(e.target.value.replace(/\D/g, ""))}
                />
              </Field>
              <Field label="奖励金额（元）">
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[15px] text-ink-soft">
                    ¥
                  </span>
                  <Input
                    inputMode="numeric"
                    className="num pl-7"
                    value={rewardYuan}
                    onChange={(e) => setRewardYuan(e.target.value.replace(/\D/g, "").slice(0, 4))}
                    placeholder="30"
                  />
                </div>
              </Field>
            </div>

            <Field label="实验类型">
              <div className="flex gap-2">
                {(["INDIVIDUAL", "GROUP"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => {
                      setType(t);
                      applyCapacity(t === "GROUP" ? Math.max(2, Number(groupSize) || 3) : 1);
                    }}
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
              <Field label="团体人数" hint="每场必须凑满的人数">
                <Input
                  inputMode="numeric"
                  value={groupSize}
                  onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, "");
                    setGroupSize(v);
                    const size = Number(v);
                    if (size >= 2) applyCapacity(size);
                  }}
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
          mode === "ONLINE" ? (
            <div className="rounded-card border border-line bg-surface p-4">
              <h3 className="text-[15px] font-medium text-ink">线上实验不需要排时段</h3>
              <p className="mt-2 text-[12px] leading-6 text-ink-soft">
                被试在实验详情页直接填写问卷，提交即完成。你可以在问卷里设置通过线，
                决定哪些人进入后续环节（比如发消息邀请他们参加第二轮）。
              </p>
              <p className="mt-2 text-[12px] leading-6 text-ink-soft">
                下一步会先保存成草稿，然后进入问卷编辑器。做好问卷并发布后，实验才会出现在被试的列表里。
              </p>
            </div>
          ) : (
          <div className="space-y-2.5">
            <div>
              <h3 className="section-title mb-1.5">点格子排时段</h3>
              <p className="mb-2 text-[11px] leading-4 text-ink-soft">
                点一下加一段（每段 {Number(durationMin) || 30} 分钟），再点一下取消。已经过去的时间不能选。
              </p>

              {/* 冲突提示放在课程表上面：课程表一屏就占满了，提示压到下面等于没提示 */}
              {deadlineConflict ? (
                <div className="mb-2 rounded-[8px] border border-warn/30 bg-warn/5 px-3 py-2">
                  <p className="flex items-start gap-1.5 text-[12px] leading-5 text-ink">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warn" />
                    <span>
                      {Number.isNaN(deadlineMs) ? (
                        "报名截止还没填。"
                      ) : deadlineMs <= nowMs ? (
                        <>
                          报名截止（
                          <span className="num">{formatDateTimeCN(new Date(deadlineMs))}</span>
                          ）已经过去了。
                        </>
                      ) : (
                        <>
                          报名截止（
                          <span className="num">{formatDateTimeCN(new Date(deadlineMs))}</span>
                          ）晚于最早时段（
                          <span className="num">
                            {firstUpcoming !== null ? formatDateTimeCN(new Date(firstUpcoming)) : "—"}
                          </span>
                          ）。
                        </>
                      )}
                      发布会被拒绝。
                    </span>
                  </p>
                  {suggestedDeadlineText ? (
                    <button
                      type="button"
                      onClick={fixDeadline}
                      className="mt-1 pl-5 text-[12px] font-medium text-moss"
                    >
                      改成 {suggestedDeadlineText}
                    </button>
                  ) : (
                    <p className="mt-1 pl-5 text-[11px] text-ink-soft">
                      最早的一段离现在太近，往后挪一段再试。
                    </p>
                  )}
                </div>
              ) : null}

              <SlotTimetable
                slots={slots}
                durationMin={Number(durationMin) || 30}
                capacity={capacity}
                today={today}
                onChange={setSlots}
              />
            </div>

            <p className="px-1 text-[11px] leading-5 text-ink-soft">
              报名截止：<span className="num text-ink">{formatDateTimeCN(new Date(deadlineMs))}</span>
            </p>
          </div>
          )
        ) : null}

        {step === 3 ? (
          <div className="space-y-3">
            <PreflightPanel
              issues={issues}
              onFixDeadline={suggestedDeadline ? fixDeadline : undefined}
            />

            <div className="rounded-card border border-line bg-surface p-4">
              <h3 className="text-[16px] font-semibold text-ink">{title}</h3>
              <p className="mt-1 text-[12px] text-ink-soft">
                {mode === "ONLINE" ? "线上实验" : "线下实验"} · {location} ·{" "}
                <span className="num">{durationMin} 分钟</span> ·{" "}
                {rewardLabel(toRewardText(rewardYuan))} ·{" "}
                {type === "GROUP" ? `团体 ${groupSize} 人` : "一对一"}
              </p>
              <div className="mt-2 space-y-1 text-[12px] text-ink-soft">
                <p>
                  报名截止：
                  <span className="num text-ink">{formatDateTimeCN(new Date(deadlineMs))}</span>
                </p>
                <p>
                  信誉门槛 <span className="num text-ink">{minCreditScore}</span> ·{" "}
                  {needsVerification ? "需学生认证" : "不限认证"}
                </p>
                <p>
                  {mode === "ONLINE" ? (
                    <>线上实验：被试提交问卷即完成，不需要预约时段</>
                  ) : (
                    <>
                      时段 <span className="num text-ink">{slots.length}</span> 个
                      {type === "GROUP" ? (
                        <>
                          ，每场 <span className="num text-ink">{groupSize}</span> 人，共{" "}
                          <span className="num text-ink">
                            {slots.length * (Number(groupSize) || 0)}
                          </span>{" "}
                          个名额
                        </>
                      ) : (
                        <>
                          ，总容量{" "}
                          <span className="num text-ink">
                            {slots.reduce((n, s) => n + s.capacity, 0)}
                          </span>
                        </>
                      )}
                    </>
                  )}
                </p>
              </div>
              <p className="mt-2 line-clamp-4 text-[12px] leading-5 text-ink-soft">{description}</p>
            </div>

            <div className="rounded-card border border-line bg-surface p-3">
              <p className="mb-1.5 text-[12px] font-medium text-ink">时段一览</p>
              <div className="space-y-1">
                {grouped.slice(0, 6).map(([day, list]) => (
                  <p key={day} className="text-[11px] text-ink-soft">
                    <span className="num">{formatDayCN(new Date(list[0].startAt))}</span>：
                    <span className="num">{list.map((s) => formatHM(new Date(s.startAt))).join("、")}</span>
                  </p>
                ))}
                {grouped.length > 6 ? (
                  <p className="text-[11px] text-ink-soft">…还有 {grouped.length - 6} 天</p>
                ) : null}
              </div>
            </div>

            <p className="text-[11px] leading-5 text-ink-soft">
              发布后被试就能在列表里看到。发布前可以再回上一步改时段。
            </p>
          </div>
        ) : null}
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-line bg-surface/95 backdrop-blur safe-bottom">
        <div className="mx-auto w-full max-w-[480px] gap-2 px-4 py-2.5">
          {step === 3 && blocking.length > 0 ? (
            <p className="mb-1.5 text-center text-[11px] text-danger">
              还有 {blocking.length} 项要补，补完才能发布
            </p>
          ) : null}
          <div className="flex gap-2">
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
                  disabled={blocking.length > 0}
                  onClick={() => submit(false)}
                >
                  存草稿
                </Button>
                <Button
                  size="lg"
                  className="flex-[2]"
                  loading={submitting}
                  disabled={blocking.length > 0}
                  onClick={() => submit(true)}
                >
                  发布
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

/** 发布前体检面板：逐条列出 domain 的判定结果，页面不重复写规则 */
function PreflightPanel({
  issues,
  onFixDeadline,
}: {
  issues: DraftIssue[];
  /** 截止时间冲突可以当场改好，不必让用户退回第 1 步 */
  onFixDeadline?: () => void;
}) {
  const blocking = issues.filter((i) => i.level === "block");

  return (
    <div className="rounded-card border border-line bg-surface p-3">
      <div className="flex items-baseline justify-between">
        <p className="text-[12px] font-medium text-ink">发布前检查</p>
        <span className={cn("text-[11px]", blocking.length ? "text-danger" : "text-moss")}>
          {blocking.length ? `${blocking.length} 项要补` : "全部通过"}
        </span>
      </div>

      {issues.length === 0 ? (
        <p className="mt-1.5 text-[12px] leading-5 text-ink-soft">
          标题、说明、地点、时长、报酬和时段都齐了，可以直接发布。
        </p>
      ) : (
        <ul className="mt-1.5 space-y-1">
          {issues.map((issue, i) => (
            <li key={`${issue.field}-${i}`} className="flex items-start gap-1.5 text-[12px] leading-5">
              <span
                className={cn(
                  "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px]",
                  issue.level === "block" ? "bg-danger/10 text-danger" : "bg-warn/10 text-warn",
                )}
                aria-hidden
              >
                !
              </span>
              <span className={issue.level === "block" ? "text-ink" : "text-ink-soft"}>
                {/* 文案本身已经带字段名时不再重复前缀，否则会读出「报名截止：报名截止时间…」 */}
                {issue.message.startsWith(DRAFT_FIELD_LABEL[issue.field]) ? null : (
                  <span className="text-ink-soft">{DRAFT_FIELD_LABEL[issue.field]}：</span>
                )}
                {issue.message}
                {issue.field === "signupDeadline" && onFixDeadline ? (
                  <button type="button" onClick={onFixDeadline} className="ml-1 font-medium text-moss">
                    一键改好
                  </button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
