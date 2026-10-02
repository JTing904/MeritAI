import { Hono } from "hono";
import { z } from "zod";
import type { MeData } from "../../../shared/types";
import type { AppEnv } from "../app";
import { destroyAllSessions, destroySession, requireUser } from "../lib/auth";
import { clock } from "../lib/clock";
import { consumeRate, RATE_RULES } from "../lib/rate-limit";
import { deleteKey, loadMe, saveKey } from "../services/ai-key";
import { readBody } from "../lib/body";
import { conditional } from "../lib/etag";
import { ok } from "../lib/http";
import { meToken } from "../services/cache-tokens";

export const meRoutes = new Hono<AppEnv>();

/**
 * Conditional (B2): the token hashes the answer itself (the user row the auth lookup loaded, plus M6's one
 * small query for today's AI usage).
 */
meRoutes.get("/", async (c) => {
  const me = await loadMe(c.var.db, await requireUser(c), clock.now());
  return conditional<MeData>(c, meToken(me), async () => me);
});

const MeUpdate = z
  .object({
    locale: z.enum(["zh", "en"]),
    pushEnabled: z.boolean(),
    weeklyEnabled: z.boolean(),
  })
  .partial()
  .strict();

meRoutes.patch("/", async (c) => {
  const user = await requireUser(c);
  const data = await readBody(c, MeUpdate);
  const updated = await c.var.db.user.update({ where: { id: user.id }, data });
  return ok<MeData>(c, await loadMe(c.var.db, updated, clock.now()));
});

// M6: the account's AI key. The key is checked with one cheap call, stored encrypted, and never sent back.
const AiKeySchema = z.object({
  provider: z.enum(["GEMINI", "CLAUDE", "OPENAI"]),
  key: z.string().trim().min(8).max(300),
  adult: z.boolean().optional().default(false),
});

meRoutes.put("/ai-key", async (c) => {
  const user = await requireUser(c);
  await consumeRate(c.var.db, [{ rule: RATE_RULES.aiKeyUser, subject: user.id }]);
  const input = await readBody(c, AiKeySchema);
  return ok<MeData>(c, await saveKey(c.var.db, user, input, clock.now()));
});

meRoutes.delete("/ai-key", async (c) => {
  const user = await requireUser(c);
  return ok<MeData>(c, await deleteKey(c.var.db, user, clock.now()));
});

export const sessionRoutes = new Hono<AppEnv>();

/** Sign out this device. Succeeds even if the token was already gone. */
sessionRoutes.delete("/", async (c) => {
  await destroySession(c);
  return ok(c, null);
});

export const allSessionRoutes = new Hono<AppEnv>();

/** 「在所有设备上退出」: ends every session of the user, this one included. */
allSessionRoutes.delete("/", async (c) => {
  const user = await requireUser(c);
  return ok<{ signedOut: number }>(c, { signedOut: await destroyAllSessions(c.var.db, user.id) });
});
