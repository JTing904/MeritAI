import { Hono } from "hono";
import { z } from "zod";
import type { MeData } from "../../../shared/types";
import type { AppEnv } from "../app";
import { destroyAllSessions, destroySession, requireUser, toMe } from "../lib/auth";
import { readBody } from "../lib/body";
import { conditional } from "../lib/etag";
import { ok } from "../lib/http";
import { meToken } from "../services/cache-tokens";

export const meRoutes = new Hono<AppEnv>();

/** Conditional (B2): the token hashes the answer itself, which the auth lookup already loaded. */
meRoutes.get("/", async (c) => {
  const me = toMe(await requireUser(c));
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
  return ok<MeData>(c, toMe(updated));
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
