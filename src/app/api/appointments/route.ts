import { ok, handle, ApiError } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { bookSlotSchema } from "@/lib/domain";
import { bookSlot } from "@/server/appointments";

/** 直接锁定时段。供非 LLM 降级表单、时段格子点击、Agent 之外入口使用 */
export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  const body = await req.json();
  const { slotId } = bookSlotSchema.parse(body);
  if (user.role === "RESEARCHER") throw new ApiError(403, "主试账号不能报名实验");
  const appointment = await bookSlot({ userId: user.id, slotId, source: "DIRECT" });
  return ok(
    { id: appointment.id, status: appointment.status },
    "已锁定该时段，请在「我的预约」里确认",
  );
});
