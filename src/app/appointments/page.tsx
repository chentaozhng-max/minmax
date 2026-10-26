import { requirePage } from "@/lib/page-auth";
import { AppointmentsView } from "./appointments-view";

export default async function AppointmentsPage() {
  await requirePage("SUBJECT");
  return <AppointmentsView />;
}
