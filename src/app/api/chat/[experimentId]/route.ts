import { ok, handle } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { getChatView } from "@/server/agent";

type Params = { params: Promise<{ experimentId: string }> };

export const GET = handle(async (_req: Request, { params }: Params) => {
  const { experimentId } = await params;
  const user = await requireUser();
  const view = await getChatView(experimentId, user.id);
  return ok(view);
});
