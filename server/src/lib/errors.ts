import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ErrorCode } from "../../../shared/api";

/** Throw this from any handler; the app's error handler turns it into the JSON envelope. */
export class AppError extends Error {
  constructor(
    public readonly status: ContentfulStatusCode,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const notFound = (what = "Resource") => new AppError(404, "NOT_FOUND", `${what} not found`);
export const forbidden = (message = "Not allowed") => new AppError(403, "FORBIDDEN", message);
export const conflict = (message: string, details?: unknown) => new AppError(409, "CONFLICT", message, details);
/** Step 0 stubs (M4): the builder that owns the service replaces the body. */
export const notImplemented = () => new AppError(501, "INTERNAL", "Not implemented");
