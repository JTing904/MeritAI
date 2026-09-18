// Types shared by the server and the app. Pure TypeScript: no runtime imports,
// so both the server (tsx / Vercel) and the app (Metro) can load it without extra deps.

/** Error codes the API can return. The app maps each code to localized text. */
export type ErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'INTERNAL';

export type ApiError = { code: ErrorCode; message: string; details?: unknown };

/** Every JSON response uses this envelope. */
export type ApiEnvelope<T> =
  | { success: true; data: T; error: null }
  | { success: false; data: null; error: ApiError };

export type HealthData = {
  ok: boolean;
  db: boolean;
  /** Server time, ISO 8601. */
  time: string;
  version: string;
};
