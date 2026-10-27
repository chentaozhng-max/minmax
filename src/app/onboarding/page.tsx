import { requirePage } from "@/lib/page-auth";
import { prisma } from "@/lib/prisma";
import { OnboardingForm } from "./onboarding-form";

export default async function OnboardingPage() {
  const session = await requirePage();
  const user = await prisma.user.findUnique({ where: { id: session.sub } });
  if (!user) return null;

  return (
    <OnboardingForm
      role={user.role === "RESEARCHER" ? "RESEARCHER" : "SUBJECT"}
      initial={{
        school: user.school ?? "",
        department: user.department ?? "",
        grade: user.grade ?? "",
        interests: user.interests ? user.interests.split(",").filter(Boolean) : [],
        timePreference: user.timePreference
          ? user.timePreference.split(",").filter(Boolean)
          : [],
      }}
    />
  );
}
