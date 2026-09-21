// Constants shared by the server and the app.

/** Highlighter ("荧光笔") colour names, in assignment order. The first six come from the prototype. */
export const HIGHLIGHTERS = ['lemon', 'gum', 'mint', 'sky', 'tang', 'lilac', 'lime', 'aqua'] as const;
export type Highlighter = (typeof HIGHLIGHTERS)[number];

/** A stable colour for a person outside any project (profile avatar), derived from their id. */
export function profileColor(userId: string): Highlighter {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  return HIGHLIGHTERS[h % HIGHLIGHTERS.length]!;
}

export const LOCALES = ['zh', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

/** 为所有人删除项目: the leader can restore it for this many days; then it is deleted for good. */
export const PROJECT_RESTORE_DAYS = 7;

// ─── M5: reminders and the project lifecycle ──────────────────────────────────

/** AWAITING_CONFIRM ends automatically this many days after the deadline (ProjectLifecycle.autoEndAt). */
export const AUTO_END_DAYS = 7;
/** The leader hears PROJECT_AUTO_END_SOON this many days after the deadline (the day before the auto-end). */
export const AUTO_END_WARN_DAYS = 6;
/** An ENDED project is deleted for good this many days after it ended; it can be reopened until then. */
export const ENDED_KEEP_DAYS = 14;
/** PROJECT_DELETE_SOON goes out this many days before an ended project is deleted (3 days, then 1 day). */
export const DELETE_WARN_DAYS = [3, 1] as const;
/** PREREQ_BLOCKED: the prerequisite is this many days past its due and still unfinished. */
export const BLOCKED_DAYS = 3;
/** TASK_DUE_SOON and friends: sent once the due is this close… */
export const DUE_SOON_HOURS = 24;
/** …unless less than this is left (then nothing is sent). */
export const DUE_SOON_MIN_HOURS = 1;
/** WEEKLY_SUMMARY: Sunday at this hour in the project's time zone. */
export const WEEKLY_HOUR = 20;
/** TASK_OVERDUE templates (NotificationPayload TASK_OVERDUE.template is 0 … ROAST_TEMPLATES − 1). */
export const ROAST_TEMPLATES = 5;

/** Largest brief file (wizard step 2 upload). The app checks it before uploading; the server enforces it. */
export const MAX_BRIEF_BYTES = 10 * 1024 * 1024;

/** Largest evidence file (M4). The app checks it before uploading; the server enforces it. */
export const MAX_EVIDENCE_FILE_BYTES = 10 * 1024 * 1024;
/** Files and links per attempt. */
export const MAX_EVIDENCE_ITEMS = 5;
/** All FILE evidence of a project together (every task, every attempt). */
export const MAX_PROJECT_STORAGE_BYTES = 20 * 1024 * 1024;
/** File types evidence accepts (by extension; the server also checks the content). */
export const EVIDENCE_EXTENSIONS = [
  'pdf',
  'doc',
  'docx',
  'ppt',
  'pptx',
  'xls',
  'xlsx',
  'csv',
  'png',
  'jpg',
  'jpeg',
  'webp',
  'heic',
] as const;
export type EvidenceExtension = (typeof EVIDENCE_EXTENSIONS)[number];

/** This app build's version, sent as X-App-Version on every request (the server answers 426 UPDATE_REQUIRED below its minimum). */
export const APP_VERSION = '0.1.0';
