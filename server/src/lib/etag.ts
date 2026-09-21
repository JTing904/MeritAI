// Conditional GETs (hardening B2, REQUIREMENTS §13 「数据没变就不重传」). The busiest screens answer with
// `ETag: W/"<token>"` and `Cache-Control: private, no-cache`; a request whose If-None-Match holds the
// current token gets 304 with no body. The token is computed first, from one or two tiny queries
// (services/cache-tokens.ts), so a 304 skips both the full load and its egress.
//
// Order matters: the token is read BEFORE the data. A write landing in between gives a response with
// newer data and an older token, which only costs one extra 200 later; never the reverse (fresh token,
// stale data), which would pin the client to stale data.
import { createHash } from "node:crypto";
import type { Context } from "hono";
import { APP_VERSION } from "../version";
import { ok } from "./http";

/** Bump when what a token covers changes, so old tokens stop matching. */
const TOKEN_SCHEMA = 1;

/** What these GETs send instead of no-store: the client may keep the body but must revalidate it. */
export const REVALIDATE = "private, no-cache";

/**
 * A deploy invalidates every token: the API version, and on Vercel the deployment itself (a deploy that
 * changes a response's shape without a version bump must not 304 old bodies).
 */
const BUILD = [APP_VERSION, process.env.VERCEL_DEPLOYMENT_ID ?? process.env.VERCEL_GIT_COMMIT_SHA ?? ""];

/** Hashes the parts (JSON) with the schema and build into a short opaque token. */
export function cacheToken(kind: string, parts: unknown[]): string {
  const json = JSON.stringify([TOKEN_SCHEMA, BUILD, kind, ...parts]);
  return createHash("sha256").update(json).digest("base64url").slice(0, 27);
}

/** True when If-None-Match (a list, weak or strong, or *) names this entity tag (weak comparison). */
export function matchesIfNoneMatch(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  const want = etag.replace(/^W\//, "");
  return header.split(",").some((raw) => {
    const tag = raw.trim();
    return tag === "*" || tag.replace(/^W\//, "") === want;
  });
}

/**
 * Answers a GET conditionally. `token` null: no caching for this request (e.g. the viewer can't see the
 * thing, so `load` will throw its 404) — a plain 200 with the default no-store. Otherwise 304 when the
 * request already holds the token, else `load()` with the ETag. Errors from `load` carry no ETag.
 */
export async function conditional<T>(c: Context, token: string | null, load: () => Promise<T>): Promise<Response> {
  if (token === null) return ok<T>(c, await load());
  const etag = `W/"${token}"`;
  if (matchesIfNoneMatch(c.req.header("If-None-Match"), etag)) {
    c.header("ETag", etag);
    c.header("Cache-Control", REVALIDATE);
    return c.body(null, 304);
  }
  const data = await load();
  c.header("ETag", etag);
  c.header("Cache-Control", REVALIDATE);
  return ok<T>(c, data);
}
