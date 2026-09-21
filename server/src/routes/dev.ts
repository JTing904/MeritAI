import { Hono } from "hono";
import { z } from "zod";
import { profileColor } from "../../../shared/constants";
import type { DevPerson, LoginResult } from "../../../shared/types";
import type { AppEnv } from "../app";
import { createSession, requireUser, toMe } from "../lib/auth";
import { readBody } from "../lib/body";
import { devLoginEnabled } from "../lib/dev-gate";
import { notFound } from "../lib/errors";
import { ok } from "../lib/http";
import { setDevTaskStatus } from "../services/dev-tasks";
import { DevStatusSchema, TimeMachineSchema } from "../services/schemas";
import { runTick } from "../services/tick";
import { clock, MAX_OFFSET_MS } from "../lib/clock";
import { AppError } from "../lib/errors";
import type { TickResult, TimeMachineState } from "../../../shared/types";

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

// How testers mark a task started, done or half done without going through evidence and grading: signed in, and only
// in a project they are an active member of (dev login alone must not reach other people's projects).
devRoutes.post("/tasks/:taskId/status", async (c) => {
  const user = await requireUser(c);
  const { status } = await readBody(c, DevStatusSchema);
  await setDevTaskStatus(c.var.db, c.req.param("taskId"), user.id, status);
  return ok(c, null);
});

// The time machine (M5): shifts the server clock (lib/clock.ts) and runs one tick at the new time, so
// reminders, overdue flags, the lifecycle and swap expiry can be tried without waiting. Only behind the dev
// gate above; the offset lives in this process (a restart resets it) and affects everyone using it.
const machineState = (tick: TickResult | null): TimeMachineState => ({
  offsetMs: clock.offsetMs(),
  now: clock.now().toISOString(),
  realNow: new Date().toISOString(),
  tick,
});

devRoutes.get("/time-machine", (c) => ok<TimeMachineState>(c, machineState(null)));

devRoutes.post("/time-machine", async (c) => {
  const input = await readBody(c, TimeMachineSchema);
  const next = "reset" in input ? 0 : "offsetMs" in input ? input.offsetMs : clock.offsetMs() + input.advanceMs;
  if (Math.abs(next) > MAX_OFFSET_MS) throw new AppError(400, "VALIDATION", "The time machine goes at most 400 days either way");
  clock.setOffset(next);
  const tick = await runTick(c.var.db, clock.now());
  return ok<TimeMachineState>(c, machineState(tick));
});
