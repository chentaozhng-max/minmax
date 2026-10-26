import { ok, handle } from "@/lib/http";
import { requireRole } from "@/lib/auth";
import { listResearcherExperiments } from "@/server/experiments";

export const GET = handle(async () => {
  const researcher = await requireRole("RESEARCHER");
  const list = await listResearcherExperiments(researcher.id);
  return ok(list);
});
