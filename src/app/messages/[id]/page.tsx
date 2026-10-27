import { notFound } from "next/navigation";
import { requirePage } from "@/lib/page-auth";
import { initThreadView } from "@/server/dm-page";
import { DmChat } from "./dm-chat";

export default async function ThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePage();
  const { id } = await params;

  const initial = await initThreadView(session.sub, id).catch(() => null);
  if (!initial) notFound();

  const role = session.role === "RESEARCHER" ? "RESEARCHER" : "SUBJECT";
  return <DmChat threadId={id} initial={initial} role={role} />;
}
