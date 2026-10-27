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
      <PageHeader title="主试认证" back="auto" profile={{ role: "RESEARCHER" }} />
      <div className="px-4 pt-4">
        <p className="mb-4 text-[13px] leading-6 text-ink-soft">
          用学校、学号 / 工号和教育邮箱证明你是本校的实验主试。认证徽章会出现在你发布的每个实验卡片和报名者列表旁边。
        </p>
        <VerifyForm
          role="RESEARCHER"
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
