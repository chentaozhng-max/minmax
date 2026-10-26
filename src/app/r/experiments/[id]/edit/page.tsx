import { requirePage } from "@/lib/page-auth";
import { EditExperimentForm } from "./edit-form";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requirePage("RESEARCHER");
  const { id } = await params;
  return <EditExperimentForm experimentId={id} />;
}
