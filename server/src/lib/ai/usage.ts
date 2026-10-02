// Quota and pacing per key (= per leader account), M6 spec §2 and the owner's decision of 2026-09-23
// (REQUIREMENTS §13: 审核作业的模型按聪明程度依次用).
//
// - Usage day: Google resets the free Gemini quota at midnight Pacific time (「每天下午 3 点左右」 in
//   Malaysia), so Gemini counts by the Pacific date; Claude and OpenAI by the UTC date.
// - Models: light work (reading the brief, 怎么做) uses the provider's light model. Grading walks the GOOD
//   CHAIN, smartest first: for Gemini gemini-3.8-flash → 3.7 → 3.6 → 3.5 (GEMINI_GOOD_CHAIN, each with its
//   own free quota), then the light model. Claude and OpenAI have a single good model.
// - Daily counters (AiUsage) per key and MODEL. Gemini defaults: every good-chain model 20 a day and 5 a
//   minute (GEMINI_GOOD_RPD / GEMINI_GOOD_RPM), the light model 500 / 15 (GEMINI_LIGHT_RPD / _RPM);
//   GEMINI_MODEL_LIMITS="gemini-3.8-flash=20/5,…" overrides single models. A model at its daily limit is
//   skipped without a call; a 429 from it marks it used up for the rest of its day. Claude / OpenAI: no known
//   daily limit, AI_RPM (30) a minute.
// - Per-minute pacing (RateLimitBucket "ai:<model>:<userId>", a fixed 60 s window). A job whose model has
//   no slot left this minute waits (AiJob.runAfter) rather than spending a less capable model's quota.
import type { AiProviderName } from "../../../../shared/constants";
import type { AiUsageToday } from "../../../../shared/types";
import type { AiKeyStatus, User } from "../../generated/prisma/client";
import type { Db } from "../db";
import { localDate, zonedTime } from "../plan/dates";
import type { AiTier } from "./types";

type Reader = Pick<Db, "aiUsage" | "rateLimitBucket" | "$queryRaw" | "$executeRaw">;

const PACIFIC = "America/Los_Angeles";
const zoneOf = (provider: AiProviderName) => (provider === "GEMINI" ? PACIFIC : "UTC");

const envInt = (name: string, fallback: number): number => {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};
const envModel = (name: string, fallback: string) => process.env[name]?.trim() || fallback;

export const GEMINI_DEFAULT_CHAIN = ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash"];

/** The model light work uses. */
export function lightModel(provider: AiProviderName): string {
  if (provider === "GEMINI") return envModel("GEMINI_MODEL_LIGHT", "gemini-flash-lite-latest");
  if (provider === "CLAUDE") return envModel("CLAUDE_MODEL_LIGHT", "claude-haiku-4-5");
  return envModel("OPENAI_MODEL_LIGHT", "gpt-5-mini");
}

/** Grading's models, smartest first (the light model is the last resort after these). */
export function goodChain(provider: AiProviderName): string[] {
  if (provider === "GEMINI") {
    const list = (process.env.GEMINI_GOOD_CHAIN ?? "").split(",").map((m) => m.trim()).filter(Boolean);
    return list.length ? [...new Set(list)] : GEMINI_DEFAULT_CHAIN;
  }
  if (provider === "CLAUDE") return [envModel("CLAUDE_MODEL_GOOD", "claude-sonnet-5")];
  return [envModel("OPENAI_MODEL_GOOD", "gpt-5.6")];
}

export const tierOf = (provider: AiProviderName, model: string): AiTier => (model === lightModel(provider) ? "light" : "good");

/** GEMINI_MODEL_LIMITS="model=RPD/RPM,…" for single models. */
function override(model: string): { rpd?: number; rpm?: number } {
  for (const part of (process.env.GEMINI_MODEL_LIMITS ?? "").split(",")) {
    const m = /^\s*([^=\s]+)\s*=\s*(\d+)?\s*(?:\/\s*(\d+))?\s*$/.exec(part);
    if (m && m[1] === model) return { rpd: m[2] ? Number(m[2]) : undefined, rpm: m[3] ? Number(m[3]) : undefined };
  }
  return {};
}

/** "YYYY-MM-DD" of the key's usage day at `now`. */
export const usageDay = (provider: AiProviderName, now: Date): string => localDate(now, zoneOf(provider));

/** When the usage day of `now` started. */
export function usageDayStart(provider: AiProviderName, now: Date): Date {
  const [y, m, d] = usageDay(provider, now).split("-").map(Number) as [number, number, number];
  return zonedTime(y, m, d, 0, 0, zoneOf(provider));
}

/** When the next usage day starts (the counters go back to 0). */
export function usageResetAt(provider: AiProviderName, now: Date): Date {
  const [y, m, d] = usageDay(provider, now).split("-").map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return zonedTime(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, 0, zoneOf(provider));
}

/** Calls a day for this model; null: no known limit. */
export function dailyLimit(provider: AiProviderName, model: string): number | null {
  if (provider !== "GEMINI") return null;
  const own = override(model).rpd;
  if (own) return own;
  return model === lightModel(provider) ? envInt("GEMINI_LIGHT_RPD", 500) : envInt("GEMINI_GOOD_RPD", 20);
}

/** Calls a minute for this model. */
export function perMinute(provider: AiProviderName, model: string): number {
  if (provider !== "GEMINI") return envInt("AI_RPM", 30);
  const own = override(model).rpm;
  if (own) return own;
  return model === lightModel(provider) ? envInt("GEMINI_LIGHT_RPM", 15) : envInt("GEMINI_GOOD_RPM", 5);
}

/** Today's calls per model. */
export async function usedToday(db: Reader, userId: string, provider: AiProviderName, now: Date): Promise<Map<string, number>> {
  const rows = await db.aiUsage.findMany({ where: { userId, day: usageDay(provider, now) } });
  return new Map(rows.map((r) => [r.model, r.count]));
}

/** GET /api/me → ai.usageToday: the good chain summed, the light model, and each model. */
export async function usageToday(db: Reader, userId: string, provider: AiProviderName, now: Date): Promise<AiUsageToday> {
  const used = await usedToday(db, userId, provider, now);
  const light = lightModel(provider);
  const models = [
    ...goodChain(provider).map((model) => ({ model, tier: "good" as const })),
    { model: light, tier: "light" as const },
  ].map((m) => ({ ...m, used: used.get(m.model) ?? 0, limit: dailyLimit(provider, m.model) }));
  const good = models.filter((m) => m.tier === "good");
  const sumLimit = good.some((m) => m.limit === null) ? null : good.reduce((s, m) => s + m.limit!, 0);
  return {
    good: { used: good.reduce((s, m) => s + m.used, 0), limit: sumLimit },
    light: { used: used.get(light) ?? 0, limit: dailyLimit(provider, light) },
    models,
    resetsAt: usageResetAt(provider, now).toISOString(),
  };
}

/** Counts one call. */
export async function recordCall(db: Reader, userId: string, provider: AiProviderName, model: string, now: Date): Promise<void> {
  const day = usageDay(provider, now);
  await db.$executeRaw`
    INSERT INTO "AiUsage" ("userId", "day", "tier", "count") VALUES (${userId}, ${day}, ${model}, 1)
    ON CONFLICT ("userId", "day", "tier") DO UPDATE SET "count" = "AiUsage"."count" + 1`;
}

/** The provider said this model's quota is gone: count it as used up for the rest of its day. */
export async function markExhausted(db: Reader, userId: string, provider: AiProviderName, model: string, now: Date): Promise<void> {
  const limit = dailyLimit(provider, model);
  if (limit === null) return;
  const day = usageDay(provider, now);
  await db.$executeRaw`
    INSERT INTO "AiUsage" ("userId", "day", "tier", "count") VALUES (${userId}, ${day}, ${model}, ${limit})
    ON CONFLICT ("userId", "day", "tier") DO UPDATE SET "count" = GREATEST("AiUsage"."count", ${limit})`;
}

/**
 * Takes one of this minute's calls for the key and model. Atomic: the row only changes while there is room
 * (or the window is over), so two workers can't both take the last slot. `retryAt`: when a slot frees up.
 */
export async function takeSlot(
  db: Reader,
  userId: string,
  provider: AiProviderName,
  model: string,
  now: Date,
): Promise<{ ok: true } | { ok: false; retryAt: Date }> {
  const key = `ai:${model}:${userId}`;
  const max = perMinute(provider, model);
  const floor = new Date(now.getTime() - 60_000);
  const rows = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimitBucket" ("key", "count", "windowStart", "blockedUntil") VALUES (${key}, 1, ${now}, NULL)
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimitBucket"."windowStart" <= ${floor} THEN 1 ELSE "RateLimitBucket"."count" + 1 END,
      "windowStart" = CASE WHEN "RateLimitBucket"."windowStart" <= ${floor} THEN ${now} ELSE "RateLimitBucket"."windowStart" END
    WHERE "RateLimitBucket"."windowStart" <= ${floor} OR "RateLimitBucket"."count" < ${max}
    RETURNING "count"`;
  if (rows.length > 0) return { ok: true };
  const bucket = await db.rateLimitBucket.findUnique({ where: { key } });
  const retryAt = bucket ? new Date(bucket.windowStart.getTime() + 60_000) : new Date(now.getTime() + 60_000);
  return { ok: false, retryAt: retryAt > now ? retryAt : new Date(now.getTime() + 1000) };
}

/** The key's status as it counts now: a QUOTA from an earlier usage day is over (the quota came back). */
export function effectiveStatus(user: Pick<User, "aiProvider" | "aiKeyStatus" | "aiKeyCheckedAt">, now: Date): AiKeyStatus | null {
  if (!user.aiProvider || !user.aiKeyStatus) return null;
  if (user.aiKeyStatus === "QUOTA" && user.aiKeyCheckedAt && usageDay(user.aiProvider, user.aiKeyCheckedAt) !== usageDay(user.aiProvider, now)) {
    return "OK";
  }
  return user.aiKeyStatus;
}
