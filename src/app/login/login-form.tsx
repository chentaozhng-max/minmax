"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/toast";
import { postJson } from "@/lib/api-client";

type DemoAccount = {
  phone: string;
  name: string;
  role: "SUBJECT" | "RESEARCHER";
  note: string;
};

const DEMO: DemoAccount[] = [
  { phone: "13900000001", name: "林知夏", role: "SUBJECT", note: "信誉 100 · 有 1 条申诉在等" },
  { phone: "13900000002", name: "周叙", role: "SUBJECT", note: "信誉 100 · 空白账号" },
  { phone: "13900000003", name: "许一然", role: "SUBJECT", note: "信誉 72 · 未认证" },
  { phone: "13900000004", name: "沈栗", role: "SUBJECT", note: "禁报名中" },
  { phone: "13800000001", name: "陈砚", role: "RESEARCHER", note: "主试 · 有 5 个实验" },
  { phone: "13800000002", name: "谢秋池", role: "RESEARCHER", note: "主试 · 信誉 55" },
];

export function LoginForm() {
  const router = useRouter();
  const [role, setRole] = useState<"SUBJECT" | "RESEARCHER">("SUBJECT");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  const accounts = DEMO.filter((a) => a.role === role);

  async function sendCode(phoneOverride?: string) {
    const target = phoneOverride ?? phone;
    if (!/^1\d{10}$/.test(target)) {
      toast("先填 11 位手机号", "error");
      return;
    }
    setSending(true);
    try {
      await postJson<{ sent: boolean }>("/api/auth/send-code", { phone: target });
      setCode("123456");
      setHint("开发环境验证码固定为 123456，已自动填入");
      toast("验证码已发送");
    } catch (error) {
      toast(error instanceof Error ? error.message : "发送失败", "error");
    } finally {
      setSending(false);
    }
  }

  async function login() {
    if (!/^1\d{10}$/.test(phone)) {
      toast("手机号格式不对", "error");
      return;
    }
    setLoading(true);
    try {
      const data = await postJson<{ role: string; profileCompleted: boolean }>(
        "/api/auth/login",
        { phone, code },
      );
      if (!data.profileCompleted) router.replace("/onboarding");
      else router.replace(data.role === "RESEARCHER" ? "/r/experiments" : "/");
    } catch (error) {
      toast(error instanceof Error ? error.message : "登录失败", "error");
      setLoading(false);
    }
  }

  return (
    <main className="shell min-h-dvh px-5 pb-10 pt-16">
      <div className="flex items-end gap-2">
        <h1 className="text-[34px] font-semibold leading-none tracking-[-0.02em] text-moss-deep">
          PsyMatch
        </h1>
      </div>
      <p className="mt-3 max-w-[19em] text-[14px] leading-6 text-ink-soft">
        心理学实验的报名与排期。被试说什么时候有空，剩下的交给排期助手。
      </p>

      {/* 角色插画：一眼看出"你现在是哪种身份" */}
      <div className="mt-6 flex justify-center">
        <div className="h-[148px] w-[148px] overflow-hidden rounded-full bg-mist">
          <img
            src={role === "SUBJECT" ? "/illustrations/subject.png" : "/illustrations/researcher.png"}
            alt={role === "SUBJECT" ? "被试形象" : "主试形象"}
            width={148}
            height={148}
            className="h-full w-full object-cover object-[50%_12%]"
          />
        </div>
      </div>

      <div className="mt-5">
        <div className="mb-4 flex justify-center">
          <div className="inline-flex rounded-pill border border-line bg-surface p-0.5">
          {(["SUBJECT", "RESEARCHER"] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRole(r)}
              className={`h-8 rounded-pill px-4 text-[13px] transition-colors ${
                role === r ? "bg-moss text-white" : "text-ink-soft"
              }`}
            >
              {r === "SUBJECT" ? "我是被试" : "我是主试"}
            </button>
          ))}
          </div>
        </div>

        <div className="space-y-3">
          <Input
            inputMode="numeric"
            autoComplete="tel"
            placeholder="手机号"
            maxLength={11}
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
          />
          <div className="flex gap-2">
            <Input
              inputMode="numeric"
              placeholder="6 位验证码"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => {
                if (e.key === "Enter") void login();
              }}
            />
            <Button variant="outline" size="lg" onClick={() => sendCode()} loading={sending} className="shrink-0">
              获取验证码
            </Button>
          </div>
        </div>

        {hint ? <p className="mt-2 text-[11px] text-moss">{hint}</p> : null}

        <Button size="lg" block className="mt-4" onClick={login} loading={loading}>
          登录
        </Button>

        <div className="mt-8">
          <p className="section-title mb-2">
            {role === "SUBJECT" ? "被试演示账号" : "主试演示账号"}
          </p>
          <div className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
            {accounts.map((a) => (
              <button
                key={a.phone}
                type="button"
                onClick={() => {
                  setPhone(a.phone);
                  setCode("123456");
                  void sendCode(a.phone);
                }}
                className="flex w-full items-center justify-between px-3.5 py-2.5 text-left active:bg-mist"
              >
                <span className="min-w-0">
                  <span className="text-[14px] font-medium text-ink">{a.name}</span>
                  <span className="num ml-2 text-[12px] text-ink-soft">{a.phone}</span>
                  <span className="mt-0.5 block truncate text-[11px] text-ink-soft">{a.note}</span>
                </span>
                <span className="shrink-0 text-[11px] text-moss">填入</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
