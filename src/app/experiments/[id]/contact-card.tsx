"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { VerifiedBadge } from "@/components/ui/badge";
import { toast } from "@/components/toast";
import { postJson } from "@/lib/api-client";

/**
 * 详情页的主试卡：点一下（头像/整行）直接开私信——被试不用先预约也能问问题。
 * 右侧「主页」仍然去主试的实验列表。
 */
export function ContactCard({
  researcher,
  experimentId,
}: {
  researcher: {
    id: string;
    name: string;
    school: string | null;
    department: string | null;
    studentVerified: boolean;
    creditScore: number;
  };
  experimentId: string;
}) {
  const router = useRouter();
  const [opening, setOpening] = useState(false);

  async function openChat() {
    if (opening) return;
    setOpening(true);
    try {
      const data = await postJson<{ id: string }>("/api/dm/threads", {
        researcherId: researcher.id,
        experimentId,
      });
      router.push(`/messages/${data.id}`);
    } catch (error) {
      toast(error instanceof Error ? error.message : "打不开会话", "error");
      setOpening(false);
    }
  }

  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      <button
        type="button"
        onClick={openChat}
        disabled={opening}
        className="flex min-w-0 flex-1 items-center gap-3 text-left active:opacity-70"
        aria-label={`和 ${researcher.name} 沟通`}
      >
        <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-moss-tint text-[16px] font-semibold text-moss">
          {researcher.name.slice(0, 1)}
          <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full border-2 border-surface bg-moss">
            <svg viewBox="0 0 24 24" className="h-2.5 w-2.5 text-white" fill="currentColor">
              <path d="M2 21l21-9L2 3v7l15 2-15 2z" />
            </svg>
          </span>
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[15px] font-medium text-ink">{researcher.name}</span>
            <VerifiedBadge verified={researcher.studentVerified} />
          </span>
          <span className="mt-0.5 block truncate text-[12px] leading-5 text-ink-soft">
            {researcher.school ?? "未填写学校"}
            {researcher.department ? ` · ${researcher.department}` : ""}
          </span>
          <span className="mt-0.5 block text-[11px] leading-5 text-moss">
            {opening ? "正在打开会话…" : "点头像直接沟通 · 不用先预约"}
          </span>
        </span>
      </button>

      <Link
        href={`/researchers/${researcher.id}`}
        className="flex shrink-0 items-center gap-0.5 text-[12px] text-ink-soft"
      >
        主页
        <ChevronRight size={13} strokeWidth={2} />
      </Link>
    </div>
  );
}
