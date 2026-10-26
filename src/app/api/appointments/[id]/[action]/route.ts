import { ok, handle, ApiError } from "@/lib/http";
import { requireUser, requireRole } from "@/lib/auth";
import {
  cancelBySubject,
  checkIn,
  confirmAsResearcher,
  confirmAsSubject,
  markNoShow,
  submitAppeal,
  verifyAttendance,
} from "@/server/appointments";

type Params = { params: Promise<{ id: string; action: string }> };

const ACTIONS = [
  "confirm",
  "confirm-subject",
  "checkin",
  "verify",
  "no-show",
  "cancel",
  "appeal",
] as const;

/**
 * 预约生命周期动作统一入口：
 * POST /api/appointments/:id/{confirm|confirm-subject|checkin|verify|no-show|cancel|appeal}
 */
export const POST = handle(async (req: Request, { params }: Params) => {
  const { id, action } = await params;
  if (!ACTIONS.includes(action as (typeof ACTIONS)[number])) {
    throw new ApiError(404, "未知操作");
  }
  const body = (await req.json().catch(() => ({}))) as {
    code?: string;
    note?: string;
  };

  switch (action) {
    case "confirm": {
      const researcher = await requireRole("RESEARCHER");
      const updated = await confirmAsResearcher(id, researcher.id);
      return ok({ id: updated.id, status: updated.status }, "已确认预约");
    }
    case "confirm-subject": {
      const user = await requireUser();
      const updated = await confirmAsSubject(id, user.id);
      return ok({ id: updated.id, status: updated.status }, "已确认，等待主试确认");
    }
    case "checkin": {
      const user = await requireUser();
      const updated = await checkIn(id, user.id);
      return ok({ id: updated.id, status: updated.status }, "签到成功，等待主试确认到场");
    }
    case "verify": {
      const researcher = await requireRole("RESEARCHER");
      const updated = await verifyAttendance(id, researcher.id);
      return ok({ id: updated.id, status: updated.status }, "已确认到场，信誉分 +1");
    }
    case "no-show": {
      const researcher = await requireRole("RESEARCHER");
      const updated = await markNoShow(id, researcher.id);
      return ok({ id: updated.id, status: updated.status }, "已标记未到场，被试信誉分 -2");
    }
    case "cancel": {
      const user = await requireUser();
      const updated = await cancelBySubject(id, user.id);
      return ok({ id: updated.id, status: updated.status }, "已取消预约，不影响信誉分");
    }
    case "appeal": {
      const user = await requireUser();
      const updated = await submitAppeal(id, user.id, String(body.note ?? "主试未到场"));
      return ok({ id: updated.id, appealStatus: updated.appealStatus }, "申诉已提交，主试需在 48 小时内处理");
    }
    default:
      throw new ApiError(404, "未知操作");
  }
});
