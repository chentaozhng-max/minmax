import { ok, handle } from "@/lib/http";
import { createExperimentSchema } from "@/lib/domain";
import { currentUser, requireRole } from "@/lib/auth";
import { listExperimentCards } from "@/server/experiments";
import { publishExperiment } from "@/application/publish-experiment";
import { makeDefaultPublishRepository } from "@/adapters/db/prisma/experiment-publish-repo";

export const GET = handle(async (req: Request) => {
  const url = new URL(req.url);
  const viewer = await currentUser();
  const cards = await listExperimentCards({
    viewer: viewer
      ? {
          id: viewer.id,
          creditScore: viewer.creditScore,
          studentVerified: viewer.studentVerified,
          bannedUntil: viewer.bannedUntil,
        }
      : null,
    keyword: url.searchParams.get("keyword") ?? undefined,
    duration: url.searchParams.get("duration") ?? undefined,
    reward: url.searchParams.get("reward") ?? undefined,
    date: url.searchParams.get("date") ?? undefined,
    onlyEligible: url.searchParams.get("onlyEligible") === "true",
  });
  return ok(cards);
});

/** 发布实验（主试）—— 薄壳：鉴权 → 校验 → 调 application → ok() */
export const POST = handle(async (req: Request) => {
  const user = await requireRole("RESEARCHER");
  const input = createExperimentSchema.parse(await req.json());

  const result = await publishExperiment(
    { ...input, userId: user.id },
    {
      repo: makeDefaultPublishRepository(),
      loadPublisher: async (id) => ({ id, bannedUntil: user.bannedUntil }),
    },
  );

  return ok({ id: result.id, status: result.status }, result.message);
});
