// A18: create requests sent with an Idempotency-Key header (a UUID the app makes per user action) run at
// most once. A retry with the same key from the same user within 24 hours gets the first answer back
// instead of creating the thing again (a second draft, task, invite or piece of evidence).
import type { Context, Next } from "hono";
import type { AppEnv } from "../app";
import { Prisma } from "../generated/prisma/client";
import { requireUser } from "./auth";
import type { Db } from "./db";
import { AppError } from "./errors";
import { IDEMPOTENCY_TTL_MS } from "./housekeeping";

export const IDEMPOTENCY_HEADER = "Idempotency-Key";
/** A first request that hasn't finished after this long died (a crash, a serverless timeout): run it again. */
const ABANDONED_MS = 3 * 60 * 1000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Middleware for a create route. Without the header the request runs as usual. With it:
 * - the first request claims the key (user, key), runs, and keeps its answer if it succeeded (2xx);
 *   a refused or failed request frees the key, so trying again really tries again;
 * - a later request with the key gets that answer (same status and body, plus Idempotent-Replayed: true)
 *   without running, and without its body being read (an upload isn't stored twice);
 * - while the first one still runs: 409 RETRY; the same key on another route: 400 BAD_REQUEST.
 * Keys are per user, so the auth check runs first (401 without a session).
 */
export async function idempotent(c: Context<AppEnv>, next: Next): Promise<Response | void> {
  const key = c.req.header(IDEMPOTENCY_HEADER)?.trim();
  if (!key) return next();
  if (!UUID.test(key)) throw new AppError(400, "BAD_REQUEST", `${IDEMPOTENCY_HEADER} must be a UUID`);
  const user = await requireUser(c);
  const db = c.var.db;
  const route = `${c.req.method} ${c.req.path}`.slice(0, 300);
  const now = new Date();

  const replay = await claim(db, user.id, key.toLowerCase(), route, now);
  if (replay) {
    return c.json(replay.body as object, replay.status as 200, { "Idempotent-Replayed": "true" });
  }

  const id = { userId: user.id, key: key.toLowerCase() };
  try {
    await next();
  } catch (err) {
    await release(db, id);
    throw err;
  }
  const res = c.res;
  const json = res.headers.get("Content-Type")?.includes("application/json");
  if (res.status >= 200 && res.status < 300 && json) {
    try {
      const body = (await res.clone().json()) as Prisma.InputJsonValue;
      await db.idempotencyKey.update({ where: { userId_key: id }, data: { status: res.status, body } });
      return;
    } catch (err) {
      console.error("idempotency: could not store the answer", err);
    }
  }
  await release(db, id);
}

type Stored = { status: number; body: unknown };

/** Claims the key for this request (null), or returns the answer to replay. */
async function claim(db: Db, userId: string, key: string, route: string, now: Date): Promise<Stored | null> {
  const created = await db.idempotencyKey.createMany({ data: [{ userId, key, route, createdAt: now }], skipDuplicates: true });
  if (created.count === 1) return null;

  const row = await db.idempotencyKey.findUnique({ where: { userId_key: { userId, key } } });
  // Freed between the two statements (the first request failed): claim it again.
  if (!row) return claim(db, userId, key, route, now);
  const age = now.getTime() - row.createdAt.getTime();
  const stale = age > IDEMPOTENCY_TTL_MS || (row.status === null && age > ABANDONED_MS);
  if (stale) {
    // Take it over only if nobody else did meanwhile (the row is still the one we read).
    const taken = await db.idempotencyKey.updateMany({
      where: { userId, key, createdAt: row.createdAt },
      data: { route, status: null, body: Prisma.DbNull, createdAt: now },
    });
    if (taken.count === 1) return null;
    throw retryLater();
  }
  if (row.route !== route) throw new AppError(400, "BAD_REQUEST", `This ${IDEMPOTENCY_HEADER} was used for another request`);
  if (row.status === null || row.body === null) throw retryLater();
  return { status: row.status, body: row.body };
}

const retryLater = () => new AppError(409, "RETRY", "The same request is still running. Try again in a moment");

async function release(db: Db, id: { userId: string; key: string }) {
  await db.idempotencyKey
    .deleteMany({ where: { ...id, status: null } })
    .catch((err) => console.error("idempotency: could not free a key", err));
}
