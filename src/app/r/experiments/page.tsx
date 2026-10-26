import { requirePage } from "@/lib/page-auth";
import { ResearcherExperiments } from "./researcher-experiments";

export default async function ResearcherExperimentsPage() {
  await requirePage("RESEARCHER");
  return <ResearcherExperiments />;
}
