import { requirePage } from "@/lib/page-auth";
import { ResearcherExperimentDetail } from "./detail-view";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requirePage("RESEARCHER");
  const { id } = await params;
  return <ResearcherExperimentDetail experimentId={id} />;
}
