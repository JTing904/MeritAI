// Postgres-backed fixed-window rate limits (security audit 2026-09-19, hardening A6). A table instead of
// memory because serverless instances share nothing; one upsert per counted request.
import type { Context } from "hono";
import type { Db } from "./db";
import { AppError } from "./errors";

export type RateRule = {
  /** Part of the bucket key; keep it short and unique per rule. */
  name: string;
  /** Requests (or failures) allowed per window. */
  max: number;
  windowSec: number;
  /** Lockout once `max` is passed; default: the rest of the window. */
  lockSec?: number;
};

const HOUR = 3600;

/** Every limit the API enforces, per user (u), per client IP (ip) or per project (p). */
export const RATE_RULES = {
  // Guessing invite codes: only lookups of codes that don't exist count.
  joinFailUser: { name: "join-fail:u", max: 10, windowSec: HOUR, lockSec: HOUR },
  joinFailIp: { name: "join-fail:ip", max: 30, windowSec: HOUR, lockSec: HOUR },
  invitesUser: { name: "invites:u", max: 30, windowSec: HOUR },
  invitesProject: { name: "invites:p", max: 30, windowSec: HOUR },
  draftsUser: { name: "drafts:u", max: 30, windowSec: HOUR },
  codeResetUser: { name: "code-reset:u", max: 10, windowSec: HOUR },
  briefUser: { name: "brief:u", max: 30, windowSec: HOUR },
  evidenceUser: { name: "evidence:u", max: 60, windowSec: HOUR },
} satisfies Record<string, RateRule>;

export type RateCheck = { rule: RateRule; subject: string };

/** 429 RATE_LIMITED; the app shows it, and Retry-After says when to try again. */
export class RateLimitedError extends AppError {
  constructor(readonly retryAfterSec: number) {
    super(429, "RATE_LIMITED", "Too many requests. Try again later", { retryAfterSec });
    this.name = "RateLimitedError";
  }
}

const keyOf = (c: RateCheck) => `${c.rule.name}:${c.subject}`;
const secondsUntil = (until: Date, now: Date) => Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 1000));

type Bucket = { count: number; windowStart: Date; blockedUntil: Date | null };

/** Adds one to the bucket (a new window starts once the old one is over); locks it out past `max`. */
async function bump(db: Db, check: RateCheck, now: Date): Promise<{ lockedUntil: Date | null }> {
  const key = keyOf(check);
  const windowFloor = new Date(now.getTime() - check.rule.windowSec * 1000);
  const [bucket] = await db.$queryRaw<Bucket[]>`
    INSERT INTO "RateLimitBucket" ("key", "count", "windowStart", "blockedUntil")
    VALUES (${key}, 1, ${now}, NULL)
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimitBucket"."windowStart" <= ${windowFloor} THEN 1 ELSE "RateLimitBucket"."count" + 1 END,
      "windowStart" = CASE WHEN "RateLimitBucket"."windowStart" <= ${windowFloor} THEN ${now} ELSE "RateLimitBucket"."windowStart" END
    RETURNING "count", "windowStart", "blockedUntil"`;
  if (!bucket) return { lockedUntil: null };
  if (bucket.blockedUntil && bucket.blockedUntil > now) return { lockedUntil: bucket.blockedUntil };
  if (bucket.count <= check.rule.max) return { lockedUntil: null };
  const until = check.rule.lockSec
    ? new Date(now.getTime() + check.rule.lockSec * 1000)
    : new Date(bucket.windowStart.getTime() + check.rule.windowSec * 1000);
  await db.rateLimitBucket.update({ where: { key }, data: { blockedUntil: until } });
  return { lockedUntil: until };
}

/** Counts this request against every check; the first one over its limit (or locked out) → 429. */
export async function consumeRate(db: Db, checks: RateCheck[], now = new Date()): Promise<void> {
  let latest: Date | null = null;
  for (const check of checks) {
    const { lockedUntil } = await bump(db, check, now);
    if (lockedUntil && (!latest || lockedUntil > latest)) latest = lockedUntil;
  }
  await maybePrune(db, now);
  if (latest) throw new RateLimitedError(secondsUntil(latest, now));
}

/** 429 while any of these buckets is locked out; counts nothing (pair with recordRateFailure). */
export async function assertNotLocked(db: Db, checks: RateCheck[], now = new Date()): Promise<void> {
  const rows = await db.rateLimitBucket.findMany({
    where: { key: { in: checks.map(keyOf) }, blockedUntil: { gt: now } },
    select: { blockedUntil: true },
  });
  const latest = rows.reduce<Date | null>((a, r) => (r.blockedUntil && (!a || r.blockedUntil > a) ? r.blockedUntil : a), null);
  if (latest) throw new RateLimitedError(secondsUntil(latest, now));
}

/** Counts a failed attempt (a wrong invite code) against every check; locks a bucket out past its limit. */
export async function recordRateFailure(db: Db, checks: RateCheck[], now = new Date()): Promise<void> {
  for (const check of checks) await bump(db, check, now);
  await maybePrune(db, now);
}

/** Old, unlocked buckets are dead weight; about one request in a hundred clears them. */
async function maybePrune(db: Db, now: Date): Promise<void> {
  if (Math.random() >= 0.01) return;
  const dayAgo = new Date(now.getTime() - 24 * HOUR * 1000);
  await db.rateLimitBucket.deleteMany({
    where: { windowStart: { lt: dayAgo }, OR: [{ blockedUntil: null }, { blockedUntil: { lt: now } }] },
  });
}

/**
 * The caller's IP for per-IP limits. On Vercel its edge sets x-real-ip (clients can't forge it there);
 * the local dev server uses the socket address. "unknown" when neither is available (tests).
 */
export function clientIp(c: Context): string {
  if (process.env.VERCEL) {
    return c.req.header("x-real-ip")?.trim() || c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  }
  const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined;
  return env?.incoming?.socket?.remoteAddress ?? "unknown";
}
