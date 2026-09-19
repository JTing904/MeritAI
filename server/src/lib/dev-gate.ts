// The one-tap developer login and the other /api/dev tools (security audit 2026-09-19, hardening A5).
// They sign anyone in as a seeded test person and forge task states, so they fail closed: every
// condition must hold, and a production process with DEV_LOGIN set refuses to start at all.

type Env = Record<string, string | undefined>;

/** Where this process runs: production when NODE_ENV or APP_ENV says so, or on Vercel (previews too). */
function isProductionLike(env: Env): boolean {
  return env.NODE_ENV === "production" || env.APP_ENV === "production" || !!env.VERCEL;
}

/**
 * Dev login and /api/dev: only with DEV_LOGIN=true AND an explicit APP_ENV=development, never with
 * NODE_ENV=production and never on Vercel. A missing variable means off.
 */
export function devLoginEnabled(env: Env = process.env): boolean {
  return env.DEV_LOGIN === "true" && env.APP_ENV === "development" && env.NODE_ENV !== "production" && !env.VERCEL;
}

/** Throws (the server must not start) when DEV_LOGIN is set to anything but "false" in a production-like environment. */
export function assertNoDevLoginInProduction(env: Env = process.env): void {
  const devLogin = env.DEV_LOGIN?.trim() ?? "";
  if (devLogin !== "" && devLogin !== "false" && isProductionLike(env)) {
    throw new Error("DEV_LOGIN must not be set in production (NODE_ENV/APP_ENV=production or VERCEL). Remove it and redeploy.");
  }
}
