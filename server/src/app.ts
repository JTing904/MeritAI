import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";
import type { HealthData } from "../../shared/api";
import type { User } from "./generated/prisma/client";
import type { Db } from "./lib/db";
import { AppError } from "./lib/errors";
import { fail, ok } from "./lib/http";
import { devRoutes } from "./routes/dev";
import { meRoutes, sessionRoutes } from "./routes/me";
import { APP_VERSION } from "./version";

export type AppEnv = {
  Variables: {
    db: Db;
    /** Set by currentUser(): undefined = not looked up yet, null = signed out. */
    user?: User | null;
  };
};

export type AppDeps = {
  /** Returns the Prisma client. A function so tests and serverless can create it lazily. */
  db: () => Db;
  /** Browser origins allowed to call the API (the web app / PWA). Native apps send no Origin. */
  webOrigins?: string[];
};

export function createApp(deps: AppDeps) {
  const app = new Hono<AppEnv>().basePath("/api");
  const origins = new Set(deps.webOrigins ?? []);

  app.use(
    "*",
    cors({
      origin: (origin) => (origins.has(origin) ? origin : null),
      allowHeaders: ["Authorization", "Content-Type"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      maxAge: 600,
    }),
  );

  app.use("*", async (c, next) => {
    try {
      c.set("db", deps.db());
    } catch (err) {
      // The health check reports db:false instead of failing; every other route needs the database.
      if (c.req.path !== "/api/health") throw err;
    }
    await next();
  });

  app.get("/health", async (c) => {
    let db = false;
    try {
      await deps.db().$queryRaw`SELECT 1`;
      db = true;
    } catch (err) {
      console.error("health: database check failed", err);
    }
    return ok<HealthData>(c, { ok: db, db, time: new Date().toISOString(), version: APP_VERSION });
  });

  app.route("/dev", devRoutes);
  app.route("/me", meRoutes);
  app.route("/auth/session", sessionRoutes);

  app.notFound((c) => fail(c, 404, "NOT_FOUND", "Route not found"));

  app.onError((err, c) => {
    if (err instanceof AppError) return fail(c, err.status, err.code, err.message, err.details);
    if (err instanceof ZodError) {
      return fail(c, 400, "VALIDATION", "Invalid input", err.issues.map((i) => ({ path: i.path, message: i.message })));
    }
    if (err instanceof HTTPException) {
      return fail(c, err.status as 400, err.status === 401 ? "UNAUTHENTICATED" : "BAD_REQUEST", err.message || "Bad request");
    }
    // Never leak internals (SQL, stack traces) to clients.
    console.error("unhandled error", err);
    return fail(c, 500, "INTERNAL", "Something went wrong");
  });

  return app;
}

export type App = ReturnType<typeof createApp>;

/** Parses WEB_ORIGINS ("https://a.app,https://b.app") into exact origins. */
export function parseOrigins(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((o) => o.trim().replace(/\/$/, ""))
    .filter(Boolean);
}
