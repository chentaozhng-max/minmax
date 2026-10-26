import { prisma } from "@/lib/prisma";
import { requirePage } from "@/lib/page-auth";
import { PageHeader } from "@/components/page-header";
import { TabBar } from "@/components/tab-bar";
import { VerifyForm } from "@/components/verify-form";

export default async function ResearcherVerifyPage() {
  const session = await requirePage("RESEARCHER");
  const user = await prisma.user.findUnique({ where: { id: session.sub } });
  if (!user) return null;

  return (
    <main className="shell tabbar-space">
      <PageHeader title="学生认证" back="/r/profile" />
      <div className="px-4 pt-4">
        <p className="mb-4 text-[13px] leading-6 text-ink-soft">
          主试同样需要学生认证。认证徽章会出现在你发布的每个实验卡片和报名者列表旁边。
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
      <TabBar role="RESEARCHER" />
    </main>
  );
}
