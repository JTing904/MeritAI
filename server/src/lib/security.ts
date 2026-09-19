// HTTP hardening shared by every route (security audit 2026-09-19, hardening A3/A4/A10).
import type { MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import { fail } from "./http";

/** Largest request body outside the upload routes: JSON requests are a few KB. */
export const MAX_JSON_BODY_BYTES = 1024 * 1024;

/** Routes with their own, larger body limit (multipart uploads; the typed brief shares the brief route). */
const UPLOAD_ROUTES = [/^\/api\/projects\/[^/]+\/brief$/, /^\/api\/projects\/[^/]+\/tasks\/[^/]+\/evidence\/file$/];
/** Signed file links: served with their own headers (signedFileResponse). */
const isFilePath = (path: string) => path.startsWith("/api/files/");

const jsonLimit = bodyLimit({
  maxSize: MAX_JSON_BODY_BYTES,
  onError: (c) => fail(c, 413, "BODY_TOO_LARGE", "The request is too large"),
});

/** A3: refuses bodies over 1 MB before anything reads them, except on the upload routes. */
export const requestBodyLimit: MiddlewareHandler = async (c, next) => {
  if (UPLOAD_ROUTES.some((re) => re.test(c.req.path))) return next();
  return jsonLimit(c, next);
};

const apiHeaders = secureHeaders({
  // JSON is never a page: nothing may render, embed or frame it.
  contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
  xFrameOptions: "DENY",
});

/**
 * A4: security headers on every API response, and `Cache-Control: no-store` on JSON (it carries one
 * user's data; nothing in between may keep it). The signed file links set their own headers.
 */
export const apiSecurityHeaders: MiddlewareHandler = async (c, next) => {
  if (isFilePath(c.req.path)) return next();
  await apiHeaders(c, async () => {
    await next();
    if (!c.res.headers.has("Cache-Control") && c.res.headers.get("Content-Type")?.startsWith("application/json")) {
      c.res.headers.set("Cache-Control", "no-store");
    }
  });
};

/** What an unexpected error may put in the log: no message (it can quote SQL, emails or brief text). */
export function errorSummary(err: unknown): { name: string; code?: string } {
  const e = err as { name?: unknown; code?: unknown } | null;
  const name = typeof e?.name === "string" ? e.name : typeof err;
  const code = typeof e?.code === "string" || typeof e?.code === "number" ? String(e.code) : undefined;
  return code === undefined ? { name } : { name, code };
}
