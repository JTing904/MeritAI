import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ApiEnvelope, ErrorCode } from "../../../shared/api";

export function ok<T>(c: Context, data: T, status: ContentfulStatusCode = 200) {
  return c.json({ success: true, data, error: null } satisfies ApiEnvelope<T>, status);
}

export function fail(c: Context, status: ContentfulStatusCode, code: ErrorCode, message: string, details?: unknown) {
  const error = details === undefined ? { code, message } : { code, message, details };
  return c.json({ success: false, data: null, error } satisfies ApiEnvelope<never>, status);
}
