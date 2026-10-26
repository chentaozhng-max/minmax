import { ok, handle, ApiError } from "@/lib/http";
import { requireRole } from "@/lib/auth";
import { resolveAppeal } from "@/server/appointments";

type Params = { params: Promise<{ id: string }> };

export const POST = handle(async (req: Request, { params }: Params) => {
  const { id } = await params;
  const researcher = await requireRole("RESEARCHER");
  const body = (await req.json()) as { result?: string };
  if (body.result !== "UPHELD" && body.result !== "REJECTED") {
    throw new ApiError(400, "result 必须是 UPHELD 或 REJECTED");
  }
  const updated = await resolveAppeal(id, researcher.id, body.result);
  return ok(
    { id: updated.id, appealStatus: updated.appealStatus },
    body.result === "UPHELD" ? "申诉已判定成立，你被记一次未到场" : "申诉已驳回",
  );
});
