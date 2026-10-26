import { ok, handle } from "@/lib/http";
import { clearAuthCookies } from "@/lib/auth";

export const POST = handle(async () => clearAuthCookies(ok({ loggedOut: true })));
