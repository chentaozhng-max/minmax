import Link from "next/link";
import { notFound } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { requirePage } from "@/lib/page-auth";
import { PageHeader } from "@/components/page-header";
import { loadExperimentBrief } from "@/server/experiment-state";
import { loadQuestionnaireForSubject } from "@/server/questionnaire-service";
import { QuestionnaireForm } from "./questionnaire-form";

/**
 * 被试填写问卷。
 *
 * 与实验详情页分开：详情页是「看」，这里是「填」，表单状态不需要塞进 Server Component。
 * 已经填过的人进来先看到自己的答案（只读），点「重新填写」才进入编辑态 ——
 * 否则一次误触就会把已提交的答案清空。
 */
export default async function QuestionnairePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePage("SUBJECT");
  const { id } = await params;
  const user = await currentUser();

  const experiment = await loadExperimentBrief(id);
  if (!experiment) notFound();

  const { questionnaire, mine, round, repeatCount } = user
    ? await loadQuestionnaireForSubject(id, user.id)
    : { questionnaire: null, mine: null, round: 1 as number | null, repeatCount: 1 };

  // 连续多天：窗口外（还没开始 / 已经结束）不该让人填
  const outsideWindow = round === null;

  return (
    <main className="shell">
      <PageHeader title="填写问卷" back={`/experiments/${id}`} profile={{ role: "SUBJECT" }} />

      {outsideWindow ? (
        <section className="px-4 py-10 text-center">
          <p className="text-[14px] font-medium text-ink">现在还不能填写</p>
          <p className="mt-2 text-[12px] leading-6 text-ink-soft">
            这个实验要在规定的几天里每天填一次，现在不在填写时间内。
          </p>
          <Link
            href={`/experiments/${id}`}
            className="mt-6 inline-block rounded-full border border-line px-5 py-2 text-[13px] text-ink"
          >
            返回实验
          </Link>
        </section>
      ) : !questionnaire || questionnaire.status !== "PUBLISHED" ? (
        <section className="px-4 py-10 text-center">
          <p className="text-[14px] font-medium text-ink">问卷还没准备好</p>
          <p className="mt-2 text-[12px] leading-6 text-ink-soft">
            主试还在编辑，稍后再来看看。实验本身已经发布，不需要重新报名。
          </p>
          <Link
            href={`/experiments/${id}`}
            className="mt-6 inline-block rounded-full border border-line px-5 py-2 text-[13px] text-ink"
          >
            返回实验
          </Link>
        </section>
      ) : (
        <QuestionnaireForm
          experimentId={experiment.id}
          experimentTitle={experiment.title}
          mode={experiment.mode === "ONLINE" ? "ONLINE" : "OFFLINE"}
          title={questionnaire.title}
          intro={questionnaire.intro}
          questions={questionnaire.questions.map((q) => ({
            id: q.id,
            type: q.type,
            title: q.title,
            required: q.required,
            options: q.options,
            scaleMin: q.scaleMin,
            scaleMax: q.scaleMax,
          }))}
          initialAnswers={mine?.answers ?? null}
          submittedAt={mine?.submittedAt ? mine.submittedAt.toISOString() : null}
          round={repeatCount > 1 ? round : null}
          repeatCount={repeatCount}
        />
      )}
    </main>
  );
}
