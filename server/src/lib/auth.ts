import { createHash, randomBytes } from "node:crypto";
import type { Context } from "hono";
import { profileColor } from "../../../shared/constants";
import type { MeData } from "../../../shared/types";
import type { AppEnv } from "../app";
import type { User } from "../generated/prisma/client";
import type { Db } from "./db";
import { AppError } from "./errors";

const SESSION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const newToken = () => randomBytes(32).toString("base64url");

/** Creates a session and returns the raw bearer token (only its hash is stored). */
export async function createSession(db: Db, userId: string, now = new Date()): Promise<string> {
  const token = newToken();
  await db.session.create({
    data: { userId, tokenHash: hashToken(token), expiresAt: new Date(now.getTime() + SESSION_DAYS * DAY_MS) },
  });
  return token;
}

function bearer(c: Context): string | null {
  const header = c.req.header("Authorization");
  const match = header?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

/** The signed-in user, or null. Looked up once per request. */
export async function currentUser(c: Context<AppEnv>): Promise<User | null> {
  if (c.var.user !== undefined) return c.var.user;
  const token = bearer(c);
  let user: User | null = null;
  if (token) {
    const session = await c.var.db.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
    const now = new Date();
    if (session && session.expiresAt > now) {
      user = session.user;
      // Record activity at most once a day to avoid a write on every request.
      if (now.getTime() - session.lastUsedAt.getTime() > DAY_MS) {
        await c.var.db.session.update({ where: { id: session.id }, data: { lastUsedAt: now } });
      }
    }
  }
  c.set("user", user);
  return user;
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

/** One-tap developer login. Never available in production, whatever DEV_LOGIN says. */
export function devLoginEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.DEV_LOGIN === "true";
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
