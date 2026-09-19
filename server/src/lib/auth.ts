import { createHash, randomBytes } from "node:crypto";
import type { Context } from "hono";
import { profileColor } from "../../../shared/constants";
import type { MeData } from "../../../shared/types";
import type { AppEnv } from "../app";
import type { User } from "../generated/prisma/client";
import type { Db } from "./db";
import { AppError } from "./errors";
import { dailyPrune } from "./housekeeping";

/** A session lasts this long after it was last used (sliding, A16): a device used every few months stays signed in. */
export const SESSION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const newToken = () => randomBytes(32).toString("base64url");

const expiryFrom = (now: Date) => new Date(now.getTime() + SESSION_DAYS * DAY_MS);

/** Creates a session and returns the raw bearer token (only its hash is stored). Clears the user's expired ones. */
export async function createSession(db: Db, userId: string, now = new Date()): Promise<string> {
  const token = newToken();
  await db.session.create({ data: { userId, tokenHash: hashToken(token), expiresAt: expiryFrom(now) } });
  await db.session.deleteMany({ where: { userId, expiresAt: { lte: now } } });
  return token;
}

function bearer(c: Context): string | null {
  const header = c.req.header("Authorization");
  const match = header?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

type SessionRow = User & { sessionId: string; sessionLastUsedAt: Date; sessionExpiresAt: Date };

/**
 * The signed-in user, or null. Looked up once per request, in one query (the session joined with its
 * user, A14). At most once a day per session the lookup also records the use and slides the expiry to
 * 90 days from now (A16), and clears a few expired rows (lib/housekeeping.ts).
 */
export async function currentUser(c: Context<AppEnv>): Promise<User | null> {
  if (c.var.user !== undefined) return c.var.user;
  const token = bearer(c);
  let user: User | null = null;
  if (token) {
    const db = c.var.db;
    const [row] = await db.$queryRaw<SessionRow[]>`
      SELECT u.*, s."id" AS "sessionId", s."lastUsedAt" AS "sessionLastUsedAt", s."expiresAt" AS "sessionExpiresAt"
      FROM "Session" s JOIN "User" u ON u."id" = s."userId"
      WHERE s."tokenHash" = ${hashToken(token)}`;
    const now = new Date();
    if (row && row.sessionExpiresAt > now) {
      const { sessionId, sessionLastUsedAt, sessionExpiresAt: _expiresAt, ...rest } = row;
      user = rest;
      if (now.getTime() - sessionLastUsedAt.getTime() > DAY_MS) {
        await db.session.update({ where: { id: sessionId }, data: { lastUsedAt: now, expiresAt: expiryFrom(now) } });
        await dailyPrune(db, now);
      }
    } else if (row) {
      await db.session.deleteMany({ where: { id: row.sessionId } });
    }
  }
  c.set("user", user);
  return user;
}

/** Signs the user out on every device (DELETE /api/auth/sessions). Returns how many sessions ended. */
export async function destroyAllSessions(db: Db, userId: string): Promise<number> {
  return (await db.session.deleteMany({ where: { userId } })).count;
}

export async function requireUser(c: Context<AppEnv>): Promise<User> {
  const user = await currentUser(c);
  if (!user) throw new AppError(401, "UNAUTHENTICATED", "Sign in required");
  return user;
}

/** Deletes the session behind the request's bearer token (sign out on this device). */
export async function destroySession(c: Context<AppEnv>): Promise<void> {
  const token = bearer(c);
  if (token) await c.var.db.session.deleteMany({ where: { tokenHash: hashToken(token) } });
}

export function toMe(user: User): MeData {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    githubUsername: user.githubUsername,
    color: profileColor(user.id),
    locale: user.locale,
    pushEnabled: user.pushEnabled,
    weeklyEnabled: user.weeklyEnabled,
  };
}
