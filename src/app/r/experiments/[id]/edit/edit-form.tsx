"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { TabBar } from "@/components/tab-bar";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { StatusPill } from "@/components/ui/badge";
import { SlotTimetable, toTimetableSlots, type TimetableSlot } from "@/components/slot-timetable";
import { toast } from "@/components/toast";
import { api, postJson } from "@/lib/api-client";
import { experimentStatusLabel, type ExperimentStatus } from "@/lib/domain";
import { formatDateTimeInput, todayInShanghai } from "@/lib/time";
import { rewardYuan, toRewardText } from "@/lib/reward";

type Detail = {
  id: string;
  title: string;
  description: string;
  location: string;
  durationMin: number;
  rewardText: string;
  requirements: string | null;
  minCreditScore: number;
  needsVerification: boolean;
  openAnytime: boolean;
  signupDeadline: string;
  status: string;
  slots: {
    id: string;
    startAt: string;
    endAt: string;
    capacity: number;
    bookedCount: number;
    remaining: number;
  }[];
  applicants: unknown[];
};

function fromLocalInput(value: string) {
  return new Date(`${value}:00+08:00`).toISOString();
}

export function EditExperimentForm({ experimentId }: { experimentId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["r-experiment", experimentId],
    queryFn: () => api<Detail>(`/api/r/experiments/${experimentId}`),
  });

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [durationMin, setDurationMin] = useState("40");
  const [rewardYuanInput, setRewardYuanInput] = useState("30");
  const [requirements, setRequirements] = useState("");
  const [minCreditScore, setMinCreditScore] = useState("0");
  const [needsVerification, setNeedsVerification] = useState(true);
  const [deadline, setDeadline] = useState("");
  /** 追加时段的暂存区：点格子只改这里，按「追加」才落库 */
  const [pendingSlots, setPendingSlots] = useState<TimetableSlot[]>([]);

  useEffect(() => {
    if (!data) return;
    setTitle(data.title);
    setDescription(data.description);
    setLocation(data.location);
    setDurationMin(String(data.durationMin));
    setRewardYuanInput(String(rewardYuan(data.rewardText) ?? 30));
    setRequirements(data.requirements ?? "");
    setMinCreditScore(String(data.minCreditScore));
    setNeedsVerification(data.needsVerification);
    setDeadline(formatDateTimeInput(new Date(data.signupDeadline)));
  }, [data]);

  const save = useMutation({
    mutationFn: (patch: Record<string, unknown>) =>
      api<{ id: string }>(`/api/experiments/${experimentId}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    onSuccess: async (_res, patch) => {
      toast("已保存");
      await queryClient.invalidateQueries({ queryKey: ["r-experiment", experimentId] });
      await queryClient.invalidateQueries({ queryKey: ["r-experiments"] });
      if (patch.status) router.refresh();
    },
    onError: (err: Error) => toast(err.message, "error"),
  });

  const addSlots = useMutation({
    mutationFn: (slots: TimetableSlot[]) =>
      postJson<{ created: number }>(
        `/api/experiments/${experimentId}/slots/batch`,
        slots.map((s) => ({ startAt: s.startAt, endAt: s.endAt, capacity: s.capacity })),
      ),
    onSuccess: async (res) => {
      toast(res.created > 0 ? `已追加 ${res.created} 个时段` : "这些时段已经有了");
      setPendingSlots([]);
      await queryClient.invalidateQueries({ queryKey: ["r-experiment", experimentId] });
    },
    onError: (err: Error) => toast(err.message, "error"),
  });

  if (isLoading) {
    return (
      <main className="shell">
        <PageHeader title="编辑实验" back={`/r/experiments/${experimentId}`} />
        <div className="space-y-2 px-4 pt-3">
          <div className="skeleton h-36" />
          <div className="skeleton h-24" />
        </div>
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="shell">
        <PageHeader title="编辑实验" back="/r/experiments" />
        <p className="px-4 pt-10 text-center text-[13px] text-ink-soft">
          {error instanceof Error ? error.message : "加载失败"}
        </p>
      </main>
    );
  }

  const isPublished = data.status === "PUBLISHED";

  function submitInfo() {
    if (title.trim().length < 4) return toast("标题至少 4 个字", "error");
    if (description.trim().length < 10) return toast("描述至少 10 个字", "error");
    if (!location.trim()) return toast("填一下实验地点", "error");
    if (!toRewardText(rewardYuanInput)) return toast("填一下奖励金额（元）", "error");
    save.mutate({
      title: title.trim(),
      description: description.trim(),
      location: location.trim(),
      durationMin: Number(durationMin) || 40,
      rewardText: toRewardText(rewardYuanInput),
      requirements: requirements.trim() || null,
      minCreditScore: Number(minCreditScore) || 0,
      needsVerification,
      signupDeadline: fromLocalInput(deadline),
    });
  }

  return (
    <main className="shell with-actionbar">
      <PageHeader
        title="编辑实验"
        back="auto"
        profile={{ role: "RESEARCHER" }}
        right={
          <StatusPill tone={isPublished ? "moss" : "grey"}>
            {experimentStatusLabel[data.status as ExperimentStatus] ?? data.status}
          </StatusPill>
        }
      />

      <div className="space-y-4 px-4 pt-4">
        <section className="space-y-3">
          <h3 className="section-title">基本信息</h3>
          <Field label="实验标题">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} />
          </Field>
          <Field label="实验说明" hint={`${description.length}/800`}>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              maxLength={800}
            />
          </Field>
          <Field label="地点">
            <Input value={location} onChange={(e) => setLocation(e.target.value)} />
          </Field>
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
                  value={rewardYuanInput}
                  onChange={(e) => setRewardYuanInput(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  placeholder="30"
                />
              </div>
            </Field>
          </div>
          <Field label="参加要求" hint="选填">
            <Textarea
              value={requirements}
              onChange={(e) => setRequirements(e.target.value)}
              rows={2}
            />
          </Field>
          <Field label="信誉分门槛" hint="0–100">
            <Input
              inputMode="numeric"
              value={minCreditScore}
              onChange={(e) => setMinCreditScore(e.target.value.replace(/\D/g, "").slice(0, 3))}
            />
          </Field>
          {data.openAnytime ? (
            <Field label="报名截止" hint="线上实验，不设截止">
              <p className="rounded-[6px] bg-mist px-3 py-2 text-[12px] text-ink-soft">
                全时段可填写，问卷一直开放
              </p>
            </Field>
          ) : (
            <Field label="报名截止" hint="必须早于最早时段">
              <Input type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
            </Field>
          )}
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
        </section>

        <section>
          <div className="mb-2 flex items-baseline justify-between">
            <h3 className="section-title">已有时段</h3>
            <span className="text-[11px] text-ink-soft">
              已订的不能删，避免被试预约凭空消失
            </span>
          </div>
          <SlotTimetable
            slots={toTimetableSlots(data.slots)}
            durationMin={Number(durationMin) || 30}
            capacity={data.slots[0]?.capacity ?? 1}
            today={todayInShanghai()}
            showBooked
          />
        </section>

        <section>
          <h3 className="section-title mb-1.5">追加时段</h3>
          <p className="mb-2 text-[11px] leading-4 text-ink-soft">
            点格子选要新开的时段，点「追加」才写入；已有时段不会被覆盖。
          </p>
          <SlotTimetable
            slots={pendingSlots}
            durationMin={Number(durationMin) || 30}
            capacity={data.slots[0]?.capacity ?? 1}
            today={todayInShanghai()}
            onChange={setPendingSlots}
          />
          {pendingSlots.length > 0 ? (
            <Button
              size="md"
              block
              className="mt-2"
              loading={addSlots.isPending}
              onClick={() => addSlots.mutate(pendingSlots)}
            >
              追加 {pendingSlots.length} 个时段
            </Button>
          ) : null}
        </section>

        <section className="pb-4">
          <h3 className="section-title mb-2">上架状态</h3>
          <div className="rounded-card border border-line bg-surface p-3.5">
            <p className="text-[12px] leading-5 text-ink-soft">
              {isPublished
                ? "当前在招募中，被试可以在列表里看到。下架后已确认的预约不受影响，但不再接受新报名。"
                : "当前不在招募列表里。重新发布后，被试又能看到并预约剩余时段。"}
            </p>
            <Button
              size="md"
              variant={isPublished ? "outline" : "primary"}
              className="mt-2.5"
              loading={save.isPending}
              onClick={() => save.mutate({ status: isPublished ? "CLOSED" : "PUBLISHED" })}
            >
              {isPublished ? "下架实验" : "重新发布"}
            </Button>
          </div>
        </section>
      </div>

      <div className="fixed bottom-14 left-0 right-0 z-30 border-t border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto w-full max-w-[480px] px-4 py-2.5">
          <Button size="lg" block loading={save.isPending} onClick={submitInfo}>
            保存修改
          </Button>
        </div>
      </div>

      <TabBar role="RESEARCHER" />
    </main>
  );
}
