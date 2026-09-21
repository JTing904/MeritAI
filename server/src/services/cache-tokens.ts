// Tokens for the conditional GETs (hardening B2, lib/etag.ts): one small query each, computed before the
// full load. A token must change whenever anything in that response could change for that viewer:
//
// - Project.version moves on every write to a project or any row under it (database triggers, migration
//   cache_versions), and when a member's name changes.
// - Which projects a person sees: the (id, version) list of every project they have a member row in
//   (joining, leaving and purging change the list itself).
// - Server-computed fields that depend on `now` (overdue flags, 这周要交, the undo-start window, swaps
//   that ran out): counts of the dues already passed, so the token moves the moment another one passes.
// - Lazy work (expiring swaps, purging deleted projects) that the full load would do: when it is due it
//   runs first and the token is read after it, so a 304 never hides it.
// - The viewer's id and locale, the query options, and (in cacheToken) the API version and deployment.
import type { User } from "../generated/prisma/client";
import { canSee } from "../lib/access";
import { cacheToken } from "../lib/etag";
import type { Db } from "../lib/db";
import { UNDO_START_MS } from "../lib/grading";
import { DUE_SOON_MS } from "./home";
import { invitesFor } from "./join";
import { expireDueSwaps } from "./notifications";
import { purgeDeletedProjects } from "./project-delete";
import type { NotificationQuery } from "./schemas";

const viewer = (user: User) => [user.id, user.locale];

/** Lower-cased email / GitHub username the way invites store them (services/join.ts invitesFor). */
function inviteAddress(user: User): { email: string | null; github: string | null } {
  let email: string | null = null;
  let github: string | null = null;
  for (const w of invitesFor(user)) {
    if (typeof w.email === "string") email = w.email;
    if (typeof w.githubUsername === "string") github = w.githubUsername;
  }
  return { email, github };
}

type ScopeRow = { projects: string; invited: string; passed: number; purgeDue: boolean };

/**
 * The person's projects and invites with their versions, and how many of their tasks are due at or
 * before `dueBy` (strict: before it). One query.
 */
async function personScope(db: Db, user: User, dueBy: Date, strict: boolean, now: Date): Promise<ScopeRow> {
  const { email, github } = inviteAddress(user);
  const [row] = await db.$queryRaw<ScopeRow[]>`
    WITH mine AS (
      SELECT p."id", p."version", p."deletedAt", p."purgeAfter"
      FROM "Member" m JOIN "Project" p ON p."id" = m."projectId"
      WHERE m."userId" = ${user.id}
    ), invited AS (
      SELECT DISTINCT p."id", p."version"
      FROM "Invite" i JOIN "Project" p ON p."id" = i."projectId"
      WHERE i."status" = 'PENDING' AND (i."email" = ${email} OR i."githubUsername" = ${github})
    )
    SELECT
      (SELECT coalesce(string_agg("id" || ':' || "version", ',' ORDER BY "id"), '') FROM mine) AS "projects",
      (SELECT coalesce(string_agg("id" || ':' || "version", ',' ORDER BY "id"), '') FROM invited) AS "invited",
      (SELECT count(*)::int FROM "Task" t
         JOIN "Member" m ON m."id" = t."ownerId"
         JOIN "Project" p ON p."id" = t."projectId"
         WHERE m."userId" = ${user.id}
           AND (CASE WHEN ${strict} THEN coalesce(t."dueAt", p."deadline") < ${dueBy}
                     ELSE coalesce(t."dueAt", p."deadline") <= ${dueBy} END)) AS "passed",
      EXISTS (SELECT 1 FROM mine WHERE "deletedAt" IS NOT NULL AND "purgeAfter" <= ${now}) AS "purgeDue"`;
  return row!;
}

/** GET /api/home: projects (and their cards' members), invites, dueSoon (8-day horizon), restorable deletes. */
export async function homeToken(db: Db, user: User, now: Date): Promise<string> {
  const horizon = new Date(now.getTime() + DUE_SOON_MS);
  let scope = await personScope(db, user, horizon, false, now);
  if (scope.purgeDue) {
    // homeData would purge these first; do it now so the token describes what it will show.
    await purgeDeletedProjects(db, now, { userId: user.id });
    scope = await personScope(db, user, horizon, false, now);
  }
  return cacheToken("home", [...viewer(user), scope.projects, scope.invited, scope.passed]);
}

/** GET /api/tasks/mine: my projects' versions and how many of my tasks are already overdue-by-time. */
export async function myTasksToken(db: Db, user: User, now: Date): Promise<string> {
  const scope = await personScope(db, user, now, true, now);
  return cacheToken("mine", [...viewer(user), scope.projects, scope.passed]);
}

type ProjectRow = {
  version: number;
  status: "DRAFT" | "ACTIVE" | "AWAITING_CONFIRM" | "ENDED";
  deletedAt: Date | null;
  role: "LEADER" | "MEMBER";
  leftAt: Date | null;
  removed: boolean;
  overdue: number;
  swapDue: boolean;
  taskFound: boolean;
  undoWindow: boolean | null;
};

/** The project's version and time-dependent counts, with the viewer's membership; undefined when not a member. */
async function projectRow(db: Db, projectId: string, userId: string, taskId: string | null, now: Date) {
  const undoFloor = new Date(now.getTime() - UNDO_START_MS);
  const [row] = await db.$queryRaw<ProjectRow[]>`
    SELECT p."version", p."status"::text AS "status", p."deletedAt", m."role"::text AS "role", m."leftAt", m."removed",
      (SELECT count(*)::int FROM "Task" t
         WHERE t."projectId" = p."id" AND coalesce(t."dueAt", p."deadline") < ${now}) AS "overdue",
      EXISTS (SELECT 1 FROM "SwapRequest" s
         WHERE s."projectId" = p."id" AND s."status" = 'PENDING' AND s."expiresAt" <= ${now}) AS "swapDue",
      EXISTS (SELECT 1 FROM "Task" t WHERE t."id" = ${taskId} AND t."projectId" = p."id") AS "taskFound",
      (SELECT t."startedAt" >= ${undoFloor} FROM "Task" t WHERE t."id" = ${taskId} AND t."projectId" = p."id") AS "undoWindow"
    FROM "Project" p JOIN "Member" m ON m."projectId" = p."id" AND m."userId" = ${userId}
    WHERE p."id" = ${projectId}`;
  return row;
}

/**
 * GET /api/projects/:id. Null when the viewer can't see the project (the load answers 404, uncached).
 * Swaps past their time are expired first, as the load would.
 */
export async function projectToken(db: Db, projectId: string, user: User, now: Date): Promise<string | null> {
  let row = await projectRow(db, projectId, user.id, null, now);
  if (!row || !canSee(row, row)) return null;
  if (row.swapDue) {
    await expireDueSwaps(db, { projectId }, now);
    row = await projectRow(db, projectId, user.id, null, now);
    if (!row || !canSee(row, row)) return null;
  }
  return cacheToken("project", [...viewer(user), projectId, row.version, row.overdue]);
}

/**
 * GET /api/projects/:id/tasks/:taskId. Null when the viewer can't see it or there is no such task. The
 * task page doesn't show swaps; it depends on `now` through overdue and the 24-hour undo-start window.
 */
export async function taskToken(db: Db, projectId: string, taskId: string, user: User, now: Date): Promise<string | null> {
  const row = await projectRow(db, projectId, user.id, taskId, now);
  if (!row || !canSee(row, row) || !row.taskFound) return null;
  return cacheToken("task", [...viewer(user), projectId, taskId, row.version, row.overdue, row.undoWindow]);
}

type InboxRow = { total: number; unread: number; sig: number; projects: string; swapDue: boolean };

async function inboxRow(db: Db, userId: string, now: Date): Promise<InboxRow> {
  const [row] = await db.$queryRaw<InboxRow[]>`
    WITH n AS (
      SELECT count(*)::int AS "total",
        (count(*) FILTER (WHERE "readAt" IS NULL))::int AS "unread",
        coalesce(bit_xor(hashtext("id" || ':' || coalesce("readAt"::text, ''))), 0) AS "sig"
      FROM "Notification" WHERE "userId" = ${userId}
    )
    SELECT n."total", n."unread", n."sig",
      (SELECT coalesce(string_agg(p."id" || ':' || p."version", ',' ORDER BY p."id"), '') FROM "Project" p
         WHERE p."id" IN (SELECT "projectId" FROM "Notification" WHERE "userId" = ${userId})) AS "projects",
      EXISTS (SELECT 1 FROM "SwapRequest" s JOIN "Member" m ON m."id" IN (s."requesterId", s."targetId")
         WHERE m."userId" = ${userId} AND s."status" = 'PENDING' AND s."expiresAt" <= ${now}) AS "swapDue"
    FROM n`;
  return row!;
}

/**
 * GET /api/notifications (first page only). The rows themselves are only ever inserted, deleted or
 * marked read, so their count, unread count and an XOR of (id, readAt) hashes pin them down; the
 * projects they point at (tag, colour, whether I can still open it, the swaps' states) by version.
 */
export async function notificationsToken(db: Db, user: User, query: NotificationQuery, now: Date): Promise<string> {
  let row = await inboxRow(db, user.id, now);
  if (row.swapDue) {
    await expireDueSwaps(db, { OR: [{ requester: { userId: user.id } }, { target: { userId: user.id } }] }, now);
    row = await inboxRow(db, user.id, now);
  }
  return cacheToken("inbox", [...viewer(user), query.mine, query.limit, row.total, row.unread, row.sig, row.projects]);
}

/** GET /api/me: the answer is the signed-in user row the auth lookup already loaded, so no query at all. */
export function meToken(me: unknown): string {
  return cacheToken("me", [me]);
}
