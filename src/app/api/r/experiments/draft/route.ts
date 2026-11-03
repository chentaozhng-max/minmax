import { ok, handle, ApiError } from "@/lib/http";
import { requireRole } from "@/lib/auth";
import { publishDraftRequestSchema } from "@/lib/domain";
import { publisherBanRejection } from "@/domain/experiment-rules";
import type { ExperimentDraft } from "@/domain/experiment-draft";
import { generatePublishDraft } from "@/server/publish-agent";

/**
 * 发布助手：一句话 → 草稿。
 *
 * 薄壳：鉴权 → 校验 → 调编排 → ok()。
 * 这里不建实验、不写库；用户点「填入发布表单」后仍然走 /api/experiments。
 * 禁期在主试打字之前就拦住 —— 后面那一整轮模型调用不必浪费。
 */
export const POST = handle(async (req: Request) => {
  const user = await requireRole("RESEARCHER");
  const body = publishDraftRequestSchema.parse(await req.json());

  const banned = publisherBanRejection(user.bannedUntil, new Date());
  if (banned) throw new ApiError(banned.status, banned.message);

  const previousDraft =
    body.previousDraft && typeof body.previousDraft === "object"
      ? (body.previousDraft as ExperimentDraft)
      : null;

  return ok(
    await generatePublishDraft({
      brief: body.brief,
      previousDraft,
      history: body.history,
    }),
  );
});
