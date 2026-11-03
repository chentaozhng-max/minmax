import { requirePage } from "@/lib/page-auth";
import { prisma } from "@/lib/prisma";
import { makeAccountPageQuery } from "@/adapters/db/prisma/page-query-experiment";
import { OnboardingForm } from "./onboarding-form";

export default async function OnboardingPage() {
  const session = await requirePage();
  const user = await makeAccountPageQuery(prisma).findOnboardingUser(session.sub);
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
