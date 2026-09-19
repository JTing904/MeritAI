import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { requestId, type RequestIdVariables } from "hono/request-id";
import { ZodError } from "zod";
import type { HealthData } from "../../shared/api";
import type { User } from "./generated/prisma/client";
import type { Db } from "./lib/db";
import { isTooOld, minAppVersion } from "./lib/app-version";
import { isTransientDbError } from "./lib/db-errors";
import { assertNoDevLoginInProduction } from "./lib/dev-gate";
import { AppError } from "./lib/errors";
import { fail, ok } from "./lib/http";
import { RateLimitedError } from "./lib/rate-limit";
import { apiSecurityHeaders, errorSummary, requestBodyLimit } from "./lib/security";
import { devRoutes } from "./routes/dev";
import { evidenceLinkRoutes, evidenceRoutes, fileRoutes } from "./routes/evidence";
import { homeRoutes } from "./routes/home";
import { inviteRoutes } from "./routes/invites";
import { joinRoutes } from "./routes/join";
import { allSessionRoutes, meRoutes, sessionRoutes } from "./routes/me";
import { memberRoutes } from "./routes/members";
import { notificationRoutes } from "./routes/notifications";
import { packageRoutes } from "./routes/packages";
import { projectRoutes } from "./routes/projects";
import { swapRoutes } from "./routes/swaps";
import { myTaskRoutes, taskRoutes } from "./routes/tasks";
import { APP_VERSION } from "./version";

export type AppEnv = {
  Variables: RequestIdVariables & {
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
  /** Oldest app version served (X-App-Version); default MIN_APP_VERSION from the environment, else 0.0.0. */
  minAppVersion?: string;
};

export function createApp(deps: AppDeps) {
  // Every entry point (dev server, Vercel, tests) builds the app here: refuse to run with dev login in production.
  assertNoDevLoginInProduction();
  const app = new Hono<AppEnv>().basePath("/api");
  const origins = new Set(deps.webOrigins ?? []);
  const minVersion = minAppVersion(deps.minAppVersion ?? process.env.MIN_APP_VERSION);

  app.use(
    "*",
    cors({
      origin: (origin) => (origins.has(origin) ? origin : null),
      allowHeaders: ["Authorization", "Content-Type", "X-App-Version", "Idempotency-Key"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      exposeHeaders: ["Retry-After", "X-Request-Id"],
      maxAge: 7200,
    }),
  );
  // X-Request-Id on every response: what an error report quotes to find the log line.
  app.use("*", requestId());
  app.use("*", apiSecurityHeaders);
  app.use("*", requestBodyLimit);

  // A17: builds older than MIN_APP_VERSION must update first. Not the health check, and not the signed
  // file links a browser opens (they carry no app headers).
  app.use("*", async (c, next) => {
    const exempt = c.req.path === "/api/health" || c.req.path.startsWith("/api/files/");
    if (!exempt && isTooOld(c.req.header("X-App-Version"), minVersion)) {
      return fail(c, 426, "UPDATE_REQUIRED", "This app version is too old. Update the app", { minVersion: minVersion.join(".") });
    }
    await next();
  });

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
      console.error("health: database check failed", errorSummary(err));
    }
    return ok<HealthData>(c, { ok: db, db, time: new Date().toISOString(), version: APP_VERSION });
  });

  app.route("/dev", devRoutes);
  app.route("/me", meRoutes);
  app.route("/auth/session", sessionRoutes);
  app.route("/auth/sessions", allSessionRoutes);
  app.route("/home", homeRoutes);
  app.route("/projects", projectRoutes);
  app.route("/projects", packageRoutes);
  app.route("/projects", memberRoutes);
  app.route("/projects", taskRoutes);
  app.route("/projects", evidenceRoutes);
  app.route("/tasks", myTaskRoutes);
  app.route("/evidence", evidenceLinkRoutes);
  app.route("/files", fileRoutes);
  app.route("/swaps", swapRoutes);
  app.route("/notifications", notificationRoutes);
  app.route("/join", joinRoutes);
  app.route("/invites", inviteRoutes);

  app.notFound((c) => fail(c, 404, "NOT_FOUND", "Route not found"));

  app.onError((err, c) => {
    if (err instanceof RateLimitedError) c.header("Retry-After", String(err.retryAfterSec));
    if (err instanceof AppError) return fail(c, err.status, err.code, err.message, err.details);
    if (err instanceof ZodError) {
      return fail(c, 400, "VALIDATION", "Invalid input", err.issues.map((i) => ({ path: i.path, message: i.message })));
    }
    if (err instanceof HTTPException) {
      return fail(c, err.status as 400, err.status === 401 ? "UNAUTHENTICATED" : "BAD_REQUEST", err.message || "Bad request");
    }
    // A15: a lock or transaction timeout, write conflict or lost connection rolled everything back.
    if (isTransientDbError(err)) {
      console.warn("transient database error", (err as { code?: unknown }).code ?? (err as Error).name);
      c.header("Retry-After", "1");
      return fail(c, 503, "RETRY", "The server is busy. Try again");
    }
    // Never leak internals (SQL, stack traces) to clients, nor user text (messages can quote it) to the log.
    console.error("unhandled error", { ...errorSummary(err), method: c.req.method, route: c.req.routePath, requestId: c.var.requestId });
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
