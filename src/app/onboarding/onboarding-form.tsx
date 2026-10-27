"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { toast } from "@/components/toast";
import { ApiClientError, postJson } from "@/lib/api-client";
import { cn } from "@/lib/cn";

const GRADES = ["大一", "大二", "大三", "大四", "研一", "研二", "研三", "博士"];

const INTERESTS = [
  "认知",
  "社会",
  "发展与教育",
  "临床与咨询",
  "工程/人因",
  "神经科学",
  "消费与决策",
];

const TIMES = ["工作日上午", "工作日下午", "工作日晚上", "周末上午", "周末下午"];

/**
 * 完善资料。对应招聘类 App 首次进入的引导：先问身份，再问偏好，
 * 目的是让首页推荐和后续撮合有依据，而不是一上来就面对空列表。
 */
export function OnboardingForm({
  role,
  initial,
}: {
  role: "SUBJECT" | "RESEARCHER";
  initial: {
    school: string;
    department: string;
    grade: string;
    interests: string[];
    timePreference: string[];
  };
}) {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);

  const [isStudent, setIsStudent] = useState(true);
  const [school, setSchool] = useState(initial.school);
  const [department, setDepartment] = useState(initial.department);
  const [grade, setGrade] = useState(initial.grade);
  const [interests, setInterests] = useState<string[]>(initial.interests);
  const [times, setTimes] = useState<string[]>(initial.timePreference);

  function toggle(list: string[], setList: (v: string[]) => void, value: string) {
    setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }

  async function finish(skip = false) {
    setSaving(true);
    try {
      // 保存资料是幂等的（覆盖写），丢包后重试一次没有副作用；
      // 手机上切网络、云端冷启动都可能让第一个请求直接失败。
      await postJson(
        "/api/me/profile",
        { skip, isStudent, school, department, grade, interests, timePreference: times },
        { retryNetworkError: 1 },
      );
      toast(skip ? "先跳过，随时可以在「我的」里补" : "资料已保存");
      router.replace(role === "RESEARCHER" ? "/r/experiments" : "/");
    } catch (error) {
      const network = error instanceof ApiClientError && error.network;
      const message = error instanceof Error ? error.message : "保存失败";
      toast(network ? `${message}，再点一次「完成」就好` : message, "error");
      setSaving(false);
    }
  }

  return (
    <main className="shell min-h-dvh bg-surface pb-8">
      <div className="px-5 pt-10">
        <p className="num text-[12px] text-ink-soft">第 {step} / 2 步</p>
        <h1 className="mt-2 text-[24px] font-semibold leading-8 tracking-[-0.01em] text-ink">
          {step === 1 ? "完善资料，开始找实验" : "想做什么方向、常在哪个时段"}
        </h1>
        <p className="mt-2 text-[13px] leading-6 text-ink-soft">
          {step === 1
            ? "这些信息只用于匹配实验，不会公开展示。学校填了才能做学生认证。"
            : "选几个方向和你常在的时段，有对得上的实验会更容易看到。"}
        </p>
      </div>

      <div className="mt-6 space-y-5 px-5">
        {step === 1 ? (
          <>
            <div>
              <p className="mb-2 text-[15px] font-semibold text-ink">你是学生吗？</p>
              <div className="flex gap-2">
                {[true, false].map((value) => (
                  <button
                    key={String(value)}
                    type="button"
                    onClick={() => setIsStudent(value)}
                    className={cn(
                      "h-11 flex-1 rounded-[6px] border text-[14px]",
                      isStudent === value
                        ? "border-moss bg-moss-tint text-moss"
                        : "border-line bg-surface text-ink-soft",
                    )}
                  >
                    {value ? "是" : "不是"}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] leading-5 text-ink-soft">
                学生可以报名面向在校生的实验，也才能做学生认证。
              </p>
            </div>

            {isStudent ? (
              <>
                <Field label="学校">
                  <Input
                    value={school}
                    onChange={(e) => setSchool(e.target.value)}
                    placeholder="例：华东师范大学"
                  />
                </Field>
                <Field label="院系 / 专业">
                  <Input
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    placeholder="例：心理与认知科学学院"
                  />
                </Field>
                <div>
                  <p className="mb-2 text-[15px] font-semibold text-ink">年级</p>
                  <div className="flex flex-wrap gap-2">
                    {GRADES.map((item) => (
                      <Chip
                        key={item}
                        active={grade === item}
                        onClick={() => setGrade(grade === item ? "" : item)}
                      >
                        {item}
                      </Chip>
                    ))}
                  </div>
                </div>
              </>
            ) : null}
          </>
        ) : (
          <>
            <div>
              <p className="mb-1 text-[15px] font-semibold text-ink">
                感兴趣的方向 <span className="text-[12px] font-normal text-ink-soft">可多选</span>
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {INTERESTS.map((item) => (
                  <Chip
                    key={item}
                    active={interests.includes(item)}
                    onClick={() => toggle(interests, setInterests, item)}
                  >
                    {item}
                  </Chip>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-1 text-[15px] font-semibold text-ink">
                常来的时段 <span className="text-[12px] font-normal text-ink-soft">可多选</span>
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {TIMES.map((item) => (
                  <Chip
                    key={item}
                    active={times.includes(item)}
                    onClick={() => toggle(times, setTimes, item)}
                  >
                    {item}
                  </Chip>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      <div className="mt-8 space-y-2 px-5">
        {step === 1 ? (
          <Button size="lg" block onClick={() => setStep(2)}>
            下一步
          </Button>
        ) : (
          <Button size="lg" block loading={saving} onClick={() => finish(false)}>
            完成
          </Button>
        )}
        <button
          type="button"
          onClick={() => (step === 1 ? finish(true) : setStep(1))}
          disabled={saving}
          className="w-full py-2 text-center text-[13px] text-ink-soft"
        >
          {step === 1 ? "先跳过，随便看看" : "上一步"}
        </button>
      </div>
    </main>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 rounded-[6px] border px-3 py-2 text-[13px]",
        active ? "border-moss bg-moss-tint text-moss" : "border-line bg-surface text-ink-soft",
      )}
    >
      {active ? <Check size={13} strokeWidth={2.6} /> : null}
      {children}
    </button>
  );
}
