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
  /** 503 (or 409 while the first request with the same Idempotency-Key still runs): try once more. */
  | 'RETRY'
  /** 426: X-App-Version is below the server's MIN_APP_VERSION. */
  | 'UPDATE_REQUIRED'
  /** 507: the whole site's file storage is nearly full; no uploads until space is freed. */
  | 'STORAGE_FULL'
  /** 413: a JSON request body over 1 MB. */
  | 'BODY_TOO_LARGE'
  /** 409: 20 unfinished drafts already; delete one first. */
  | 'DRAFT_LIMIT'
  /** 409: 30 invites already waiting for an answer in this project. */
  | 'INVITE_LIMIT'
  /** 403: the leader's own tasks only get 「合格（组长自评）」; no grading, overriding or grading outside. */
  | 'SELF_GRADE_NOT_ALLOWED'
  /** 400: a link with a username or password in it (https://user:pass@host). */
  | 'LINK_CREDENTIALS'
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
  /** A project's only task is worth all 100 points; its points can't change. */
  | 'ONLY_TASK_POINTS'
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
  | 'TEAM_FULL'
  // Leader leaves / deletes the project
  | 'NO_ONE_TO_TRANSFER'
  | 'DELETE_CONFIRM_MISMATCH'
  // Tasks and evidence (M4)
  | 'EVIDENCE_LIMIT'
  | 'FILE_TOO_LARGE'
  | 'FILE_TYPE_UNSUPPORTED'
  | 'PROJECT_STORAGE_FULL'
  | 'INVALID_LINK'
  | 'NO_EVIDENCE'
  | 'ALREADY_REVIEWING'
  | 'NOT_REVIEWING'
  | 'TASK_DONE'
  | 'GRADE_REASON_REQUIRED'
  | 'REASON_REQUIRED'
  | 'NOT_GRADED'
  | 'NOTHING_TO_UNDO'
  | 'UNDO_START_EXPIRED'
  | 'HAS_EVIDENCE'
  | 'NOT_A_MEETING'
  | 'SUMMARY_REQUIRED'
  | 'TASK_NO_OWNER'
  | 'PREREQ_FINISHED'
  | 'PREREQ_SELF'
  | 'PREREQ_CYCLE'
  | 'NO_BRIEF'
  | 'TASK_UNDER_REVIEW'
  // Lifecycle and reminders (M5). An ENDED project answers every write with PROJECT_ENDED (409), except
  // grading a PENDING attempt, leaving, reopening and 为所有人删除项目.
  /** 400: reopening a project whose deadline has passed needs a new deadline (after now). */
  | 'DEADLINE_REQUIRED'
  /** 400: 一键延后 must move the task's due date later than its current effective due. */
  | 'DELAY_NOT_LATER'
  /** 400: 一键延后 must land after now (a past date would be overdue again at once). */
  | 'DELAY_IN_PAST'
  /** 409: invites and joins while the project waits for the leader to confirm it was handed in. */
  | 'DEADLINE_PASSED';

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
