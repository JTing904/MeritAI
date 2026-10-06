// Request body schemas (zod). Unknown keys are dropped, not rejected, so the app can send a whole form.
import { z } from "zod";
import { canonicalTimeZone } from "../lib/plan/dates";

/** Optional text field: "" and whitespace clear it (null); a missing key leaves it unchanged (undefined). */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v === undefined ? undefined : v || null));

/** "2026-11-06" (end of that day in the project's time zone) or a full ISO date-time with Z or an offset. */
export const DateInput = z.union([z.iso.date(), z.iso.datetime({ offset: true })]);

const BasicsFields = {
  name: z.string().trim().min(1).max(80),
  shortCode: optionalText(20),
  courseName: optionalText(80),
  groupLabel: optionalText(40),
  deadline: DateInput,
  timezone: z.string().transform((tz, ctx) => {
    const zone = canonicalTimeZone(tz);
    if (zone === null) {
      ctx.addIssue({ code: "custom", message: "Use an IANA time zone such as Asia/Kuala_Lumpur" });
      return z.NEVER;
    }
    return zone;
  }),
  teamSize: z.number().int().min(2).max(8),
  leaderManages: z.boolean(),
  repoFullName: z
    .string()
    .trim()
    .max(140)
    .regex(/^([\w.-]+\/[\w.-]+)?$/, "Use owner/name")
    .nullish()
    .transform((v) => (v === undefined ? undefined : v || null)),
};

export const ProjectBasicsSchema = z.object(BasicsFields);
export type ProjectBasicsBody = z.infer<typeof ProjectBasicsSchema>;

export const ProjectPatchSchema = z.object({ ...BasicsFields, draftStep: z.number().int().min(1).max(6) }).partial();
export type ProjectPatchBody = z.infer<typeof ProjectPatchSchema>;

export const TASK_KINDS = ["CODE", "DOC", "RESEARCH", "DESIGN", "MEETING"] as const;
/** A draft can hold at most this many tasks. */
export const MAX_TASKS = 200;

const TaskFields = {
  title: z.string().trim().min(1).max(120),
  kind: z.enum(TASK_KINDS),
  /** Tenths; while drafting any total is fine (confirm rescales to 1000). */
  points: z.number().int().min(0).max(10_000),
  dueAt: DateInput.nullish(),
  description: optionalText(2000),
  featureId: z.string().min(1).nullish(),
  milestoneId: z.string().min(1).nullish(),
};

export const TaskSchema = z.object(TaskFields);
export type TaskBody = z.infer<typeof TaskSchema>;
export const TaskPatchSchema = z.object(TaskFields).partial();
export type TaskPatchBody = z.infer<typeof TaskPatchSchema>;

export const ManualPlanSchema = z.object({ tasks: z.array(TaskSchema).max(MAX_TASKS) });

export const BriefTextSchema = z.object({ text: z.string() });

export const SplitLargeSchema = z.object({ locale: z.enum(["zh", "en"]).optional() });

export const InviteSchema = z.object({ targets: z.string().max(5000) });

// ─── M3: packages, swaps, members, notifications ─────────────────────────────

/** Adding a task to an ACTIVE project: it gets exactly these points (0.1–99.9 分) and the rest rescale. */
export const ActiveTaskSchema = z.object({ ...TaskFields, points: z.number().int().min(1).max(999) });

export const AssignSchema = z.object({ memberId: z.string().min(1) });
export const SwapCreateSchema = z.object({ packageId: z.string().min(1) });
export const MoveTaskSchema = z.object({ packageId: z.string().min(1) });
export const ResplitPreviewSchema = z.object({ count: z.number().int() });
export const ResplitSchema = z.object({ count: z.number().int(), version: z.number().int() });
export const LeaveAsLeaderSchema = z.object({ newLeaderMemberId: z.string().min(1) });
export const DeleteProjectSchema = z.object({ confirm: z.string().max(200) });
export const DevStatusSchema = z.object({ status: z.enum(["TODO", "DOING", "DONE", "HALF"]) });
export type DevTaskStatus = z.infer<typeof DevStatusSchema>["status"];
export const MarkReadSchema = z.object({ upToId: z.string().min(1) });

/** A query parameter sent empty (`?cursor=&limit=`) counts as left out. */
const blankAsMissing = (v: unknown) => (v === "" ? undefined : v);

/** Feed and notification lists: newest first, `cursor` = the last item id seen, `limit` ≤ 50 (default 30). */
export const PageQuerySchema = z.object({
  cursor: z.preprocess(blankAsMissing, z.string().min(1).optional()),
  limit: z
    .preprocess(blankAsMissing, z.coerce.number().int().min(1).default(30))
    .transform((n) => Math.min(n, 50)),
});
export type PageQuery = z.infer<typeof PageQuerySchema>;

// ─── M4: tasks and evidence ───────────────────────────────────────────────────

/** The four levels the leader gives (SELF is only set by 我开完了). */
export const GradeSchema = z.enum(["EXCELLENT", "PASS", "HALF", "FAIL"]);
/** `note`: the 理由 (required for HALF / FAIL: GRADE_REASON_REQUIRED in the service) or 评语. */
export const GradeInputSchema = z.object({ grade: GradeSchema, note: optionalText(1000) });
export type GradeBody = z.infer<typeof GradeInputSchema>;
export const GradeOutsideSchema = z.object({ grade: GradeSchema, note: optionalText(1000), outsideNote: optionalText(300) });
export type GradeOutsideBody = z.infer<typeof GradeOutsideSchema>;
/** An empty reason is REASON_REQUIRED (the service checks it, so the app gets that code, not VALIDATION). */
export const OverrideSchema = z.object({
  grade: GradeSchema,
  reason: z.string().trim().max(1000),
  attemptId: z.string().min(1).optional(),
});
export type OverrideBody = z.infer<typeof OverrideSchema>;
/** An empty summary is SUMMARY_REQUIRED (checked in the service). */
export const MeetingDoneSchema = z.object({
  summary: z.string().trim().max(500),
  attendeeMemberIds: z.array(z.string().min(1)).max(8),
});
export type MeetingDoneBody = z.infer<typeof MeetingDoneSchema>;
/**
 * The scheme, URL and length checks (MAX_LINK_CHARS = 2000) are INVALID_LINK in the service, so a link
 * a little too long gets that code, not VALIDATION; this bound only refuses absurd bodies.
 */
export const LinkSchema = z.object({ url: z.string().trim().max(20_000) });
export const ChecklistSchema = z.object({
  items: z
    .array(z.object({ id: z.string().min(1).nullish(), text: z.string().trim().min(1).max(200) }))
    .max(20),
});
export type ChecklistBody = z.infer<typeof ChecklistSchema>;
export const TickSchema = z.object({ done: z.boolean() });
export const PrereqSchema = z.object({ prereqTaskId: z.string().min(1).nullable() });
/** PATCH of an ACTIVE project's task: any subset; points 1–999 tenths (the rest rescale to 1000). */
export const ActiveTaskPatchSchema = z.object({ ...TaskFields, points: z.number().int().min(1).max(999) }).partial();
export type ActiveTaskPatchBody = z.infer<typeof ActiveTaskPatchSchema>;

/** `mine=1` → only what is flagged 「跟我有关」. */
export const NotificationQuerySchema = PageQuerySchema.extend({
  mine: z
    .string()
    .optional()
    .transform((v) => v === "1" || v === "true"),
});
export type NotificationQuery = z.infer<typeof NotificationQuerySchema>;

// ─── M5: lifecycle, delay, time machine ──────────────────────────────────────

/** POST /projects/:id/reopen: `deadline` required when the old one has passed (checked in the service). */
export const ReopenSchema = z.object({ deadline: DateInput.optional() });
/** POST /projects/:id/tasks/:taskId/delay */
export const DelaySchema = z.object({ dueAt: DateInput });
/** POST /api/dev/time-machine: exactly one of the three. */
export const TimeMachineSchema = z.union([
  z.object({ offsetMs: z.number().finite() }).strict(),
  z.object({ advanceMs: z.number().finite() }).strict(),
  z.object({ reset: z.literal(true) }).strict(),
]);

// ─── M6: AI ───────────────────────────────────────────────────────────────────

/** PUT /projects/:id/choices: option keys per question id (counts are checked in the service: CHOICE_COUNT). */
export const ChoicesSchema = z.object({ answers: z.record(z.string().min(1), z.array(z.string().min(1).max(4)).max(20)) });
/** POST /projects/:id/choices/:questionId(/preview). */
export const RechooseSchema = z.object({ picks: z.array(z.string().min(1).max(4)).max(20), version: z.number().int().optional() });
/** PUT …/tasks/:taskId/howto (lengths are checked in the service, as VALIDATION). */
export const HowtoSchema = z.object({ steps: z.array(z.string().max(1000)).max(20) });

// ─── 让 AI 重新拆 (M6 follow-up) ──────────────────────────────────────────────

/** POST /projects/:id/ai-resplit as JSON: a typed brief, 再试一次 (`again`), or nothing (the saved brief). */
export const AiResplitStartSchema = z.object({ text: z.string().optional(), again: z.boolean().optional() });
const ResplitTaskFields = {
  title: z.string().trim().min(1).max(120),
  kind: z.enum(TASK_KINDS),
  /** Tenths, 0.1–99.9 分 (everything is rescaled to 1000 afterwards). */
  points: z.number().int().min(1).max(999),
  dueAt: DateInput,
};
const ResplitKey = z.string().min(1).max(40);
/** POST /projects/:id/ai-resplit/apply (unknown keys and wrong answers are checked in the service). */
export const AiResplitApplySchema = z.object({
  version: z.number().int(),
  edits: z.record(ResplitKey, z.object(ResplitTaskFields).partial()).optional(),
  deleted: z.array(ResplitKey).max(MAX_TASKS * 2).optional(),
  added: z.array(z.object({ ...ResplitTaskFields, dueAt: DateInput.nullish() })).max(MAX_TASKS).optional(),
  answers: z.record(ResplitKey, z.array(z.string().min(1).max(4)).max(20)).optional(),
});
