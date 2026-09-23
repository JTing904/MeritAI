import { createHash, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import type { TickResult } from "../../../shared/types";
import type { AppEnv } from "../app";
import { clock } from "../lib/clock";
import { AppError, notFound } from "../lib/errors";
import { ok } from "../lib/http";
import { runTick } from "../services/tick";

// Machine-to-machine routes. POST /api/internal/tick runs the reminders tick (services/tick.ts); the
// GitHub Actions schedule (.github/workflows/tick.yml) calls it every 10 minutes with
// `Authorization: Bearer <CRON_SECRET>`. Without CRON_SECRET the route doesn't exist (404).
export const internalRoutes = new Hono<AppEnv>();

/** Constant-time comparison of the bearer token with the secret (hashed first, so lengths don't leak). */
function secretMatches(header: string | undefined, secret: string): boolean {
  const token = header?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
  const a = createHash("sha256").update(token).digest();
  const b = createHash("sha256").update(secret).digest();
  return token !== "" && timingSafeEqual(a, b);
}

internalRoutes.post("/tick", async (c) => {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) throw notFound("Route");
  if (!secretMatches(c.req.header("Authorization"), secret)) throw new AppError(401, "UNAUTHENTICATED", "Wrong or missing tick secret");
  return ok<TickResult>(c, await runTick(c.var.db, clock.now()));
});
