import { requirePage } from "@/lib/page-auth";
import { currentUser } from "@/lib/auth";
import { banDaysLeft } from "@/domain/experiment-rules";
import { ResearcherExperiments } from "./researcher-experiments";

export default async function ResearcherExperimentsPage() {
  await requirePage("RESEARCHER");
  const user = await currentUser();
  const now = new Date();

  // 禁期在服务端算好：列表页的「发布」因此能在跳转前弹出警告，
  // 剩余天数也不会因为服务端/客户端时间差造成水合不一致
  const activeBan =
    user?.bannedUntil && user.bannedUntil.getTime() > now.getTime() ? user.bannedUntil : null;

  return (
    <ResearcherExperiments
      bannedUntil={activeBan?.toISOString() ?? null}
      bannedDays={activeBan ? banDaysLeft(activeBan, now) : 0}
    />
  );
}
