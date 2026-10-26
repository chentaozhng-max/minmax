import { requirePage } from "@/lib/page-auth";
import { AppealsView } from "./appeals-view";

export default async function AppealsPage() {
  await requirePage("RESEARCHER");
  return <AppealsView />;
}
