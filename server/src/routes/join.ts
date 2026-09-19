import { type Context, Hono } from "hono";
import type { JoinPreview, ProjectView } from "../../../shared/types";
import type { AppEnv } from "../app";
import { requireUser } from "../lib/auth";
import { AppError } from "../lib/errors";
import { ok } from "../lib/http";
import { assertNotLocked, clientIp, RATE_RULES, type RateCheck, recordRateFailure } from "../lib/rate-limit";
import { joinByCode, joinPreview } from "../services/join";
import { loadProjectView } from "../services/views";

// Joining with an invite code: no approval needed. Codes match case-insensitively, spaces ignored.
export const joinRoutes = new Hono<AppEnv>();

/**
 * Runs a code lookup under the guessing limit (A6): about 10 codes that don't exist per hour per person
 * (30 per IP) and that person or IP is locked out for an hour. Right codes never count.
 */
async function guarded<T>(c: Context<AppEnv>, userId: string, run: () => Promise<T>): Promise<T> {
  const checks: RateCheck[] = [
    { rule: RATE_RULES.joinFailUser, subject: userId },
    { rule: RATE_RULES.joinFailIp, subject: clientIp(c) },
  ];
  await assertNotLocked(c.var.db, checks);
  try {
    return await run();
  } catch (err) {
    if (err instanceof AppError && err.code === "INVITE_CODE_INVALID") await recordRateFailure(c.var.db, checks);
    throw err;
  }
}

joinRoutes.get("/:code", async (c) => {
  const user = await requireUser(c);
  return ok<JoinPreview>(c, await guarded(c, user.id, () => joinPreview(c.var.db, c.req.param("code"), user.id)));
});

joinRoutes.post("/:code", async (c) => {
  const user = await requireUser(c);
  const member = await guarded(c, user.id, () => joinByCode(c.var.db, c.req.param("code"), user));
  return ok<ProjectView>(c, await loadProjectView(c.var.db, member.projectId, member));
});
