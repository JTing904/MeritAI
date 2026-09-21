import { Hono } from "hono";
import type { HomeData } from "../../../shared/types";
import type { AppEnv } from "../app";
import { requireUser } from "../lib/auth";
import { conditional } from "../lib/etag";
import { homeToken } from "../services/cache-tokens";
import { homeData } from "../services/home";
import { clock } from "../lib/clock";

export const homeRoutes = new Hono<AppEnv>();

/** Conditional (B2): 304 when If-None-Match holds the current token (services/cache-tokens.ts). */
homeRoutes.get("/", async (c) => {
  const user = await requireUser(c);
  const now = clock.now();
  return conditional<HomeData>(c, await homeToken(c.var.db, user, now), () => homeData(c.var.db, user, now));
});
