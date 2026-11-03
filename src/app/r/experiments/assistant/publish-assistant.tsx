"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowUp, CheckCircle2, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/toast";
import { postJson } from "@/lib/api-client";
import { savePublishDraft } from "@/lib/publish-draft-storage";
import { toShanghai } from "@/lib/time";

/**
 * 发布助手对话页。
 *
 * 交互模型和别的聊天框不同：每条助手消息都带一张**结构化草稿卡片**，
 * 用户看的不是文字而是字段；不满意就再说一句，模型在上一版上改。
 * 点「填入发布表单」把草稿交给 /r/experiments/new，发布仍由人确认。
 */

type Issue = { field: string; level: "block" | "warn"; message: string };

type Draft = {
  title: string;
  description: string;
  location: string;
  durationMin: number;
  rewardYuan: number;
  type: "INDIVIDUAL" | "GROUP";
  groupSize: number | null;
  requirements: string;
  minCreditScore: number;
  needsVerification: boolean;
  slots: { startAt: string; endAt: string; capacity: number }[];
};

type DraftResult = {
  reply: string;
  draft: Draft;
  issues: Issue[];
  assumptions: string[];
  mode: "llm" | "fallback";
  notice: string | null;
};

type Bubble =
  | { id: string; role: "user"; content: string }
  | { id: string; role: "assistant"; content: string; result?: DraftResult };

/**
 * 示例不是摆设：点一下就把完整 brief 发出去。
 * 标签只放能一眼分辨的特征（时长/报酬/时间），整句藏在 text 里，
 * 否则一条示例就把 375px 占满、后面两条被裁掉。
 */
const QUICK_BRIEFS = [
  {
    label: "一对一 · 30 分钟 · 下周下午",
    text: "面孔吸引力判断实验，一对一，30 分钟，报酬 30 元，下周工作日下午",
  },
  {
    label: "团体 3 人 · 60 分钟",
    text: "团体决策实验，3 人一组，60 分钟，报酬 40 元，下周二和周四下午",
  },
  {
    label: "45 分钟 · 这周末上午",
    text: "情绪记忆实验，45 分钟，报酬 50 元，这周末上午",
  },
];

let seq = 0;
function nextId(prefix: string) {
  seq += 1;
  return `${prefix}-${Date.now()}-${seq}`;
}

export function PublishAssistant({ researcherName }: { researcherName: string }) {
  const router = useRouter();
  const [bubbles, setBubbles] = useState<Bubble[]>([
    {
      id: "greeting",
      role: "assistant",
      content: `${researcherName ? `${researcherName}，` : ""}说说你想做的实验吧。比如「面孔吸引力判断，30 分钟，报酬 30 元，下周工作日下午」，我把标题、说明、要求和时段一次写全。`,
    },
  ]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const lastDraft = (() => {
    for (let i = bubbles.length - 1; i >= 0; i -= 1) {
      const b = bubbles[i];
      if (b.role === "assistant" && b.result) return b.result.draft;
    }
    return null;
  })();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [bubbles.length, pending]);

  async function send(text: string) {
    const brief = text.trim();
    if (!brief || pending) return;

    // 只把文字带回去；上一版草稿单独传，模型才知道「再便宜点」是在改什么
    const history = bubbles
      .filter((b) => b.id !== "greeting")
      .slice(-8)
      .map((b) => ({ role: b.role, content: b.content }));

    setBubbles((prev) => [...prev, { id: nextId("u"), role: "user", content: brief }]);
    setInput("");
    setPending(true);

    try {
      const res = await postJson<DraftResult>("/api/r/experiments/draft", {
        brief,
        previousDraft: lastDraft,
        history,
      });
      setBubbles((prev) => [
        ...prev,
        { id: nextId("a"), role: "assistant", content: res.reply, result: res },
      ]);
    } catch (error) {
      toast(error instanceof Error ? error.message : "助手暂时不可用", "error");
    } finally {
      setPending(false);
    }
  }

  function apply(draft: Draft) {
    savePublishDraft(draft);
    toast("已填入，核对后就能发布");
    router.push("/r/experiments/new");
  }

  const hasUserMessage = bubbles.some((b) => b.role === "user");

  return (
    <main className="mx-auto flex h-[100dvh] w-full max-w-[480px] flex-col bg-paper">
      <PageHeader
        title="发布助手"
        subtitle="一句话写成招募信息"
        back="/r/experiments"
        profile={{ role: "RESEARCHER" }}
      />

      <div className="border-b border-line bg-moss-tint/40 px-4 py-1.5 text-center text-[11px] text-ink-soft">
        AI 只负责起草；发布前每一项都由你确认
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {bubbles.map((b) =>
          b.role === "user" ? (
            <div key={b.id} className="mb-3 flex justify-end">
              <div className="max-w-[82%] rounded-[12px] rounded-tr-[4px] bg-moss px-3 py-2 text-[14px] leading-[22px] text-white">
                {b.content}
              </div>
            </div>
          ) : (
            <div key={b.id} className="mb-3">
              <div className="flex items-start gap-2">
                <Avatar />
                <div className="max-w-[86%] rounded-[12px] rounded-tl-[4px] border border-line bg-surface px-3 py-2 text-[14px] leading-[22px] text-ink">
                  {b.content}
                </div>
              </div>
              {b.result ? <DraftCard result={b.result} onApply={apply} /> : null}
            </div>
          ),
        )}

        {pending ? (
          <div className="mb-3 flex items-center gap-2 pl-1">
            <Avatar />
            <span className="flex gap-1 rounded-card border border-line bg-surface px-3 py-2">
              <Dot delay="0ms" />
              <Dot delay="140ms" />
              <Dot delay="280ms" />
            </span>
          </div>
        ) : null}

        <div ref={bottomRef} className="h-2" />
      </div>

      <div className="border-t border-line bg-surface px-3 py-2 pb-[calc(8px+env(safe-area-inset-bottom))]">
        {!hasUserMessage ? (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {QUICK_BRIEFS.map((brief) => (
              <button
                key={brief.text}
                type="button"
                disabled={pending}
                onClick={() => send(brief.text)}
                title={brief.text}
                className="press rounded-pill border border-line bg-paper px-2.5 py-1 text-[11px] text-ink-soft disabled:opacity-50"
              >
                {brief.label}
              </button>
            ))}
          </div>
        ) : null}

        <div className="flex items-end gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) send(input);
            }}
            placeholder={lastDraft ? "再改一句，例如：改成晚上，报酬 40" : "说说实验主题、时长、报酬、想排的时间"}
            maxLength={500}
            className="h-11 flex-1 rounded-pill bg-[#F5F6F7] px-4 text-[14px] outline-none focus:bg-surface focus:ring-1 focus:ring-moss/40"
          />
          <button
            type="button"
            onClick={() => send(input)}
            disabled={!input.trim() || pending}
            aria-label="发送"
            className="press mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-moss text-white disabled:opacity-40"
          >
            <ArrowUp size={19} strokeWidth={2.4} />
          </button>
        </div>
      </div>
    </main>
  );
}

/* ---------------- 草稿卡片 ---------------- */

function DraftCard({ result, onApply }: { result: DraftResult; onApply: (draft: Draft) => void }) {
  const { draft, issues, assumptions, mode, notice } = result;
  const blocking = issues.filter((i) => i.level === "block");

  return (
    <div className="mb-1 ml-9 mt-2 overflow-hidden rounded-card border border-line bg-surface">
      <div className="flex items-center justify-between bg-moss-tint/60 px-3 py-1.5">
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-moss">
          <Sparkles size={11} strokeWidth={2.2} />
          AI 草稿 · 请核对
        </span>
        <span className="text-[10px] text-ink-soft">{mode === "fallback" ? "规则版" : "模型版"}</span>
      </div>

      <div className="px-3 py-2.5">
        <h3 className="text-[15px] font-semibold leading-6 text-ink">
          {draft.title || "（标题待补充）"}
        </h3>

        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-ink-soft">
          <span className="num">{draft.durationMin} 分钟</span>
          <span className="text-line">|</span>
          <span className="num text-clay">¥{draft.rewardYuan}</span>
          <span className="text-line">|</span>
          <span>{draft.type === "GROUP" ? `团体 ${draft.groupSize ?? 2} 人` : "一对一"}</span>
          {draft.minCreditScore > 0 ? (
            <>
              <span className="text-line">|</span>
              <span className="num">信誉 ≥ {draft.minCreditScore}</span>
            </>
          ) : null}
          {draft.needsVerification ? (
            <>
              <span className="text-line">|</span>
              <span>需认证</span>
            </>
          ) : null}
        </div>

        <p className="mt-2 line-clamp-4 whitespace-pre-line text-[12px] leading-5 text-ink-soft">
          {draft.description || "（说明待补充）"}
        </p>

        {draft.requirements ? (
          <p className="mt-1.5 line-clamp-2 text-[11px] leading-5 text-ink-soft">
            <span className="text-ink">要求：</span>
            {draft.requirements}
          </p>
        ) : null}

        <div className="mt-2 flex items-start gap-1.5 text-[11px] leading-5 text-ink-soft">
          <span className="shrink-0 text-ink">地点：</span>
          <span className={draft.location.length < 2 ? "text-danger" : ""}>
            {draft.location.length < 2 ? "还没填" : draft.location}
          </span>
        </div>

        <div className="mt-1 text-[11px] leading-5 text-ink-soft">
          <span className="text-ink">时段：</span>
          {slotSummary(draft)}
        </div>

        {assumptions.length > 0 ? (
          <ul className="mt-2 space-y-0.5 rounded-[6px] bg-mist/60 px-2 py-1.5">
            {assumptions.slice(0, 3).map((a) => (
              <li key={a} className="text-[11px] leading-5 text-ink-soft">
                · {a}
              </li>
            ))}
          </ul>
        ) : null}

        {blocking.length > 0 ? (
          <ul className="mt-2 space-y-1">
            {blocking.slice(0, 3).map((issue) => (
              <li key={`${issue.field}-${issue.message}`} className="flex items-start gap-1.5 text-[11px] leading-5">
                <AlertTriangle size={12} className="mt-0.5 shrink-0 text-warn" />
                <span className="text-ink">{issue.message}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 inline-flex items-center gap-1 text-[11px] text-moss">
            <CheckCircle2 size={12} />
            必填项齐全，可以直接发布
          </p>
        )}

        {notice ? <p className="mt-1.5 text-[10px] leading-4 text-warn">{notice}</p> : null}
      </div>

      <div className="border-t border-line p-2.5">
        <Button size="md" block onClick={() => onApply(draft)}>
          填入发布表单
        </Button>
      </div>
    </div>
  );
}

function slotSummary(draft: Draft): string {
  if (draft.slots.length === 0) return "还没排，可在下一步的课程表里点";
  const pad = (n: number) => String(n).padStart(2, "0");
  const days = new Map<string, string>();
  for (const slot of draft.slots) {
    const p = toShanghai(new Date(slot.startAt));
    const key = `${pad(p.month)}/${pad(p.day)}`;
    if (!days.has(key)) {
      days.set(key, `${pad(p.hour)}:${pad(p.minute)}`);
    }
  }
  const entries = [...days.entries()];
  const head = entries
    .slice(0, 3)
    .map(([day, time]) => `${day} ${time}`)
    .join("、");
  const more = entries.length > 3 ? ` 等 ${entries.length} 天` : "";
  return `${head}${more} · 共 ${draft.slots.length} 段`;
}

function Avatar() {
  return (
    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-moss-tint">
      <Sparkles size={14} className="text-moss" strokeWidth={1.9} />
    </span>
  );
}

function Dot({ delay }: { delay: string }) {
  return (
    <span
      className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-soft/50"
      style={{ animationDelay: delay }}
    />
  );
}
