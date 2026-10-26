import { requirePage } from "@/lib/page-auth";
import { NewExperimentForm } from "./new-experiment-form";

export default async function NewExperimentPage() {
  await requirePage("RESEARCHER");
  return <NewExperimentForm />;
}
