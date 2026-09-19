import { Hono } from "hono";
import type { HomeData } from "../../../shared/types";
import type { AppEnv } from "../app";
import { requireUser } from "../lib/auth";
import { ok } from "../lib/http";
import { homeData } from "../services/home";

export const homeRoutes = new Hono<AppEnv>();

homeRoutes.get("/", async (c) => ok<HomeData>(c, await homeData(c.var.db, await requireUser(c))));
