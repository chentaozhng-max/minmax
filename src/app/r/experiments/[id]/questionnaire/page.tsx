import { notFound } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { requirePage } from "@/lib/page-auth";
import { PageHeader } from "@/components/page-header";
import { loadQuestionnaireEditor } from "@/server/questionnaire-service";
import { QuestionnaireEditor } from "./questionnaire-editor";

/**
 * 主试的问卷编辑器。
 *
 * 没有问卷时自动建一份空的 —— 主试点「需要问卷」后应该直接看到编辑器，
 * 而不是一个 404 再去找入口。
 */
export default async function QuestionnaireEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePage("RESEARCHER");
  const { id } = await params;
  const user = await currentUser();

  const view = user ? await loadQuestionnaireEditor(id, user.id) : null;
  if (!view) notFound();

  const { experiment, questionnaire, responseCount } = view;

  return (
    <main className="shell actionbar-space">
      <PageHeader title="实验问卷" back={`/r/experiments/${id}`} profile={{ role: "RESEARCHER" }} />
      <QuestionnaireEditor
        experiment={{
          id: experiment.id,
          title: experiment.title,
          mode: experiment.mode === "ONLINE" ? "ONLINE" : "OFFLINE",
          status: experiment.status,
        }}
        responseCount={responseCount}
        initial={{
          title: questionnaire.title,
          intro: questionnaire.intro,
          status: questionnaire.status,
          scoringRule: questionnaire.scoringRule ?? "",
          passScore: questionnaire.passScore,
          repeatCount: experiment.mode === "ONLINE" ? experiment.repeatCount : 1,
          questions: questionnaire.questions.map((q) => ({
            key: q.id,
            round: q.round,
            type: q.type as "SINGLE" | "MULTI" | "SCALE" | "TEXT",
            title: q.title,
            required: q.required,
            options: q.options,
            scaleMin: q.scaleMin ?? 1,
            scaleMax: q.scaleMax ?? 5,
          })),
        }}
      />
    </main>
  );
}
