import { Hono } from "hono";
import { z } from "zod";
import { profileColor } from "../../../shared/constants";
import type { DevPerson, LoginResult } from "../../../shared/types";
import type { AppEnv } from "../app";
import { createSession, devLoginEnabled, toMe } from "../lib/auth";
import { readBody } from "../lib/body";
import { notFound } from "../lib/errors";
import { ok } from "../lib/http";

// Developer one-tap login. Every route answers 404 unless dev login is enabled,
// so production never reveals that it exists. Only the seeded test people can be used.
export const DEV_EMAIL_DOMAIN = "@dev.meritai.test";
export const devRoutes = new Hono<AppEnv>();

devRoutes.use("*", async (_c, next) => {
  if (!devLoginEnabled()) throw notFound("Route");
  await next();
});

devRoutes.get("/people", async (c) => {
  const users = await c.var.db.user.findMany({
    where: { email: { endsWith: DEV_EMAIL_DOMAIN } },
    orderBy: { createdAt: "asc" },
    take: 20,
  });
  return ok<DevPerson[]>(
    c,
    users.map((u) => ({ id: u.id, name: u.name, email: u.email, color: profileColor(u.id) })),
  );
});

devRoutes.post("/login", async (c) => {
  const { userId } = await readBody(c, z.object({ userId: z.string().min(1) }));
  const user = await c.var.db.user.findUnique({ where: { id: userId } });
  if (!user || !user.email?.endsWith(DEV_EMAIL_DOMAIN)) throw notFound("User");
  const token = await createSession(c.var.db, user.id);
  return ok<LoginResult>(c, { token, user: toMe(user) });
});
