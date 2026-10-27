"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { toast } from "@/components/toast";
import { postJson } from "@/lib/api-client";
import { CheckCircle2 } from "lucide-react";

/** 身份认证：被试端与主试端共用，只是叫法不同（学生认证 / 主试认证） */
export function VerifyForm({
  initial,
  done,
  role = "SUBJECT",
}: {
  initial: { school: string; studentId: string; eduEmail: string };
  done: boolean;
  role?: "SUBJECT" | "RESEARCHER";
}) {
  const isResearcher = role === "RESEARCHER";
  const title = isResearcher ? "主试认证" : "学生认证";
  const router = useRouter();
  const [school, setSchool] = useState(initial.school);
  const [studentId, setStudentId] = useState(initial.studentId);
  const [eduEmail, setEduEmail] = useState(initial.eduEmail);
  const [step, setStep] = useState<"form" | "code">(done ? "code" : "form");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);

  if (done) {
    return (
      <div className="rounded-card border border-verify/25 bg-verify-tint p-4">
        <div className="flex items-center gap-2 text-verify">
          <CheckCircle2 size={17} strokeWidth={2} />
          <span className="text-[15px] font-medium">已完成{title}</span>
        </div>
        <p className="mt-1.5 text-[12px] leading-5 text-verify/80">
          {isResearcher
            ? "你的姓名旁边会显示「已认证」角标，被试能看到这个实验出自认证过的主试。"
            : "你的姓名旁边会显示蓝色「已认证」角标，可以报名需要认证的实验。"}
        </p>
        {initial.eduEmail ? (
          <p className="num mt-2 text-[11px] text-verify/70">{initial.eduEmail}</p>
        ) : null}
      </div>
    );
  }

  async function sendCode() {
    if (school.trim().length < 2) return toast("请填写学校全称", "error");
    if (studentId.trim().length < 4)
      return toast(isResearcher ? "请填写学号 / 工号" : "请填写学号", "error");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(eduEmail)) return toast("邮箱格式不正确", "error");
    setLoading(true);
    try {
      const data = await postJson<{ devCode?: string }>("/api/auth/verify-edu-email", {
        school: school.trim(),
        studentId: studentId.trim(),
        eduEmail: eduEmail.trim(),
      });
      setStep("code");
      if (data.devCode) setDevCode(data.devCode);
      toast("验证码已发到你的教育邮箱");
    } catch (error) {
      toast(error instanceof Error ? error.message : "发送失败", "error");
    } finally {
      setLoading(false);
    }
  }

  async function confirm() {
    setLoading(true);
    try {
      await postJson("/api/auth/confirm-verify", { eduEmail: eduEmail.trim(), code });
      toast("认证完成");
      router.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : "验证失败", "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      {step === "form" ? (
        <>
          <Field label="学校">
            <Input value={school} onChange={(e) => setSchool(e.target.value)} placeholder="例：华东师范大学" />
          </Field>
          <Field label={isResearcher ? "学号 / 工号" : "学号"}>
            <Input value={studentId} onChange={(e) => setStudentId(e.target.value)} placeholder="例：2023110205" />
          </Field>
          <Field label="教育邮箱" hint="支持 .edu.cn / .edu">
            <Input
              value={eduEmail}
              onChange={(e) => setEduEmail(e.target.value)}
              placeholder="name@stu.xxx.edu.cn"
              inputMode="email"
            />
          </Field>
          <Button size="lg" block loading={loading} onClick={sendCode}>
            发送验证码
          </Button>
        </>
      ) : (
        <>
          <p className="text-[12px] leading-5 text-ink-soft">
            验证码已发送到 <span className="num text-ink">{eduEmail}</span>，10 分钟内有效。
          </p>
          <Input
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            placeholder="6 位验证码"
            className="num text-center text-[22px] tracking-[0.3em]"
          />
          {devCode ? (
            <p className="text-[11px] text-warn">开发环境验证码：{devCode}（也接受 123456）</p>
          ) : null}
          <Button size="lg" block disabled={code.length !== 6} loading={loading} onClick={confirm}>
            完成认证
          </Button>
          <button
            type="button"
            onClick={() => setStep("form")}
            className="w-full text-center text-[12px] text-ink-soft"
          >
            改一下信息
          </button>
        </>
      )}
    </div>
  );
}
