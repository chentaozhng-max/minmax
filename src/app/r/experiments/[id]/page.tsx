import { requirePage } from "@/lib/page-auth";
import { todayInShanghai } from "@/lib/time";
import { ResearcherExperimentDetail } from "./detail-view";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requirePage("RESEARCHER");
  const { id } = await params;
  // today 由服务端算：课程表要标「今天」那一列，客户端自己算会和 SSR 打架
  return <ResearcherExperimentDetail experimentId={id} today={todayInShanghai()} />;
}
