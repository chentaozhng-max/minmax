import { ok, handle } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { chatMessageSchema } from "@/lib/domain";
import { sendTurn } from "@/server/agent";

type Params = { params: Promise<{ experimentId: string }> };

export const POST = handle(async (req: Request, { params }: Params) => {
  const { experimentId } = await params;
  const user = await requireUser();
  const body = await req.json();
  const { content } = chatMessageSchema.parse(body);
  const result = await sendTurn({ experimentId, subjectId: user.id, text: content });
  return ok(result);
});
