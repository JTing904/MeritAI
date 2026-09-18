import type { Context } from "hono";
import type { z } from "zod";
import { AppError } from "./errors";

/** Parses and validates a JSON body. Bad JSON → 400 BAD_REQUEST; schema mismatch → 400 VALIDATION (via onError). */
export async function readBody<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new AppError(400, "BAD_REQUEST", "Request body must be JSON");
  }
  return schema.parse(raw);
}
