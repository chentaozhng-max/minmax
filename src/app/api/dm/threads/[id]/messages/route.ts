import { z } from "zod";
import { ok, handle } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { loadThread, sendDirectMessage } from "@/server/dm";

const schema = z.object({ content: z.string().min(1).max(500) });

export const POST = handle(
  async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
    const user = await requireUser();
    const { id } = await params;
    const body = schema.parse(await req.json());

    await sendDirectMessage({ userId: user.id, threadId: id, content: body.content });
    const data = await loadThread(user.id, id);
    return ok(data, "已发送");
  },
);
