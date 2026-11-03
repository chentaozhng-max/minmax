import { requirePage } from "@/lib/page-auth";
import { PageHeader } from "@/components/page-header";
import { TabBar } from "@/components/tab-bar";
import { NotificationsView } from "./notifications-view";

export default async function NotificationsPage() {
  await requirePage("SUBJECT");

  return (
    <main className="shell tabbar-space">
      <PageHeader title="提醒" back="/me" profile={{ role: "SUBJECT" }} />
      <NotificationsView />
      <TabBar role="SUBJECT" />
    </main>
  );
}
