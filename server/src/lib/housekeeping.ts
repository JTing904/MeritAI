// Small, bounded clean-ups run on the side of ordinary requests until the M5 scheduler sweeps properly.
import type { Db } from "./db";

/** An Idempotency-Key's stored answer is replayed this long (lib/idempotency.ts). */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

/** Deletes up to `limit` expired sessions, any user's. */
export async function pruneSessions(db: Db, now: Date, limit = 100): Promise<number> {
  return db.$executeRaw`
    DELETE FROM "Session" WHERE "id" IN (SELECT "id" FROM "Session" WHERE "expiresAt" <= ${now} LIMIT ${limit})`;
}

/** Deletes up to `limit` idempotency keys older than 24 hours. */
export async function pruneIdempotencyKeys(db: Db, now: Date, limit = 200): Promise<number> {
  const before = new Date(now.getTime() - IDEMPOTENCY_TTL_MS);
  return db.$executeRaw`
    DELETE FROM "IdempotencyKey" WHERE ("userId", "key") IN (
      SELECT "userId", "key" FROM "IdempotencyKey" WHERE "createdAt" < ${before} LIMIT ${limit})`;
}

/**
 * Runs when a session's daily use is recorded (lib/auth.ts), so it costs two small indexed deletes per
 * active user per day. A failure is logged, never passed on to the request.
 */
export async function dailyPrune(db: Db, now: Date): Promise<void> {
  try {
    await pruneSessions(db, now);
    await pruneIdempotencyKeys(db, now);
  } catch (err) {
    console.error("housekeeping: prune failed", err);
  }
}
