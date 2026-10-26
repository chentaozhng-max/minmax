import { prisma } from "@/lib/prisma";
import { requirePage } from "@/lib/page-auth";
import { PageHeader } from "@/components/page-header";
import { TabBar } from "@/components/tab-bar";
import { VerifyForm } from "@/components/verify-form";

export default async function VerifyPage() {
  const session = await requirePage("SUBJECT");
  const user = await prisma.user.findUnique({ where: { id: session.sub } });
  if (!user) return null;

  return (
    <main className="shell tabbar-space">
      <PageHeader title="学生认证" back="/me" />
      <div className="px-4 pt-4">
        <p className="mb-4 text-[13px] leading-6 text-ink-soft">
          认证只为确认你是本校在读学生，信息不会公开展示。认证后姓名旁会出现蓝色角标，
          需要认证的实验才允许报名。
        </p>
        <VerifyForm
          done={user.studentVerified}
          initial={{
            school: user.school ?? "",
            studentId: user.studentId ?? "",
            eduEmail: user.eduEmail ?? "",
          }}
        />
      </div>
      <TabBar role="SUBJECT" />
    </main>
  );
}
