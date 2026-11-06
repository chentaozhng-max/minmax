import Link from "next/link";
import { notFound } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { requirePage } from "@/lib/page-auth";
import { PageHeader } from "@/components/page-header";
import { loadOwnedBriefOrNull } from "@/server/experiment-state";
import { listResponses } from "@/server/questionnaire-service";
import { ResponsesBoard } from "./responses-board";

/**
 * 主试的答卷后台。
 *
 * 数据在服务端取齐：统计、答卷、题目顺序一次查完，
 * 客户端只负责筛选、展开和三个动作（调分数线 / 重算 / 发邀请）。
 */
export default async function ResponsesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePage("RESEARCHER");
  const { id } = await params;
  const user = await currentUser();

  const experiment = user ? await loadOwnedBriefOrNull(id, user.id) : null;
  if (!experiment) notFound();

  const { questionnaire, responses, summary } = await listResponses(id);

  if (!questionnaire) {
    return (
      <main className="shell">
        <PageHeader title="答卷" back={`/r/experiments/${id}`} profile={{ role: "RESEARCHER" }} />
        <section className="px-4 py-10 text-center">
          <p className="text-[14px] font-medium text-ink">还没有问卷</p>
          <Link
            href={`/r/experiments/${id}/questionnaire`}
            className="mt-4 inline-block rounded-full bg-moss px-5 py-2 text-[13px] text-white"
          >
            去创建问卷
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="shell">
      <PageHeader title="答卷" back={`/r/experiments/${id}`} profile={{ role: "RESEARCHER" }} />
      <ResponsesBoard
        experimentId={id}
        experimentTitle={experiment.title}
        mode={experiment.mode === "ONLINE" ? "ONLINE" : "OFFLINE"}
        questionnaire={{
          title: questionnaire.title,
          status: questionnaire.status,
          passScore: questionnaire.passScore,
        }}
        summary={summary}
        questions={questionnaire.questions.map((q) => ({
          id: q.id,
          order: q.order,
          title: q.title,
          type: q.type,
          options: q.options,
          scaleMin: q.scaleMin,
          scaleMax: q.scaleMax,
        }))}
        responses={responses.map((r) => ({
          id: r.id,
          subjectId: r.subjectId,
          name: r.subjectName,
          school: r.subjectSchool,
          verified: r.subjectVerified,
          credit: r.subjectCredit,
          score: r.score,
          reason: r.scoreReason,
          breakdown: r.scoreBreakdown,
          passed: r.passed,
          passState: r.passState,
          round: r.round,
          status: r.status,
          submittedAt: r.submittedAt.toISOString(),
          invitedAt: r.invitedAt ? r.invitedAt.toISOString() : null,
          declinedAt: r.declinedAt ? r.declinedAt.toISOString() : null,
          answers: r.answers,
        }))}
      />
    </main>
  );
}
