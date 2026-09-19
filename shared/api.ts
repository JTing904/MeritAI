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
  | 'INTERNAL'
  // Joining with an invite code
  | 'INVITE_CODE_INVALID'
  | 'INVITE_CODE_EXPIRED'
  | 'REMOVED_FROM_PROJECT'
  | 'PROJECT_ENDED'
  // Drafts and plans
  | 'NOT_A_DRAFT'
  | 'PLAN_EMPTY'
  | 'DEADLINE_IN_PAST'
  | 'DUE_AFTER_DEADLINE'
  | 'TASK_LOCKED'
  // Packages, swaps and members (M3)
  | 'PACKAGE_TAKEN'
  | 'PACKAGE_STARTED'
  | 'TARGET_STARTED'
  | 'NEEDS_OWN_PACKAGE'
  | 'SWAP_LIMIT'
  | 'SWAP_NOT_PENDING'
  | 'ALREADY_HAS_PACKAGE'
  | 'LEADER_ONLY_MANAGES'
  | 'LEADER_MUST_TRANSFER'
  | 'TASK_FINISHED'
  | 'STALE_PREVIEW'
  | 'TEAM_FULL';

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
