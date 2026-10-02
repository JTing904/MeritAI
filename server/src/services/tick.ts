// The reminders tick (M5 spec §1–§3): one idempotent pass over every live project, run every 10 minutes by
// POST /api/internal/tick (a GitHub Actions schedule in production), every 60 s in the dev server, and by
// the development time machine. Every reminder is in-app only for now (push and group messages: M9).
//
// Each job is its own function taking (db, now) so tests call them directly. A job first finds the
// projects that may have work with a cheap query, then handles each one in its own transaction under the
// project row lock (FOR UPDATE SKIP LOCKED: a project someone is writing to right now waits for the next
// tick), re-reading everything under the lock. A reminder is sent only when its ReminderLog key was new
// (INSERT … ON CONFLICT DO NOTHING in the same transaction), so two ticks at once, or a tick that runs
// again, send each reminder once; the keys hold what makes a reminder new (a later due date, another owner).
//
// Order: expired swaps, the lifecycle (deadline passed → AWAITING_CONFIRM, auto-end warnings, auto-end),
// then the task reminders (ACTIVE projects only, so a task due at the project deadline gets PROJECT_DUE
// for the leader rather than a roast), the weekly summary, the deletion warnings and the purge.
import { AUTO_END_DAYS, AUTO_END_WARN_DAYS, BLOCKED_DAYS, DELETE_WARN_DAYS, DUE_SOON_HOURS, DUE_SOON_MIN_HOURS, ROAST_TEMPLATES, WEEKLY_HOUR } from "../../../shared/constants";
import type { PersonRef, TickResult } from "../../../shared/types";
import { Prisma, type Project } from "../generated/prisma/client";
import type { Db } from "../lib/db";
import { autoEndAt, autoEndWarnAt, DAY_MS } from "../lib/lifecycle";
import { earnedPoints, effectiveDue, isFinished, isOverdue } from "../lib/package-state";
import { localDate, wallClock, zonedTime } from "../lib/plan/dates";
import { drainAiJobs } from "./ai-jobs";
import { endUnderLock } from "./lifecycle";
import { expireSwaps, notify } from "./notify";
import { purgeDeletedProjects } from "./project-delete";
import { TX_OPTIONS, type Tx } from "./tx";

const HOUR_MS = 60 * 60 * 1000;

/** An overdue task is roasted only within this long after its due (a first deploy doesn't dig up old ones). */
export const OVERDUE_LOOKBACK_MS = 7 * DAY_MS;

/** Failures a tick survived (logged); passed along by runTick. */
export type TickStats = { errors: number };

// ─── Plumbing ────────────────────────────────────────────────────────────────

/**
 * Runs `fn` in a transaction holding the project's row lock, or returns null when someone else holds
 * it (SKIP LOCKED) or the project is gone.
 */
async function withProject<T>(db: Db, projectId: string, fn: (tx: Tx, project: Project) => Promise<T>): Promise<T | null> {
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Project" WHERE id = ${projectId} FOR UPDATE SKIP LOCKED`;
    if (rows.length === 0) return null;
    const project = await tx.project.findUniqueOrThrow({ where: { id: projectId } });
    return fn(tx, project);
  }, TX_OPTIONS);
}

/** Runs `fn` for each project (in id order), one transaction each; a failing project is logged and skipped. Sums the counts. */
async function eachProject(
  db: Db,
  ids: Iterable<string>,
  job: string,
  stats: TickStats | undefined,
  fn: (tx: Tx, project: Project) => Promise<number>,
): Promise<number> {
  let total = 0;
  for (const id of [...new Set(ids)].sort()) {
    try {
      total += (await withProject(db, id, fn)) ?? 0;
    } catch (err) {
      if (stats) stats.errors++;
      console.error(`tick: ${job} failed for project ${id}`, err);
    }
  }
  return total;
}

/** Records a reminder as sent; true when it wasn't yet (then the caller sends it, in the same transaction). */
export async function claimReminder(tx: Tx, key: string, projectId: string, now: Date): Promise<boolean> {
  const inserted = await tx.$executeRaw`
    INSERT INTO "ReminderLog" ("key", "projectId", "createdAt") VALUES (${key}, ${projectId}, ${now})
    ON CONFLICT ("key") DO NOTHING`;
  return inserted === 1;
}

/** The keys (of these) already sent. */
async function sentKeys(db: Db, keys: string[]): Promise<Set<string>> {
  if (keys.length === 0) return new Set();
  const rows = await db.reminderLog.findMany({ where: { key: { in: keys } }, select: { key: true } });
  return new Set(rows.map((r) => r.key));
}

/** Projects with at least one planned key that wasn't sent yet. */
async function projectsWithUnsent(db: Db, planned: { projectId: string; key: string }[]): Promise<string[]> {
  const sent = await sentKeys(db, planned.map((p) => p.key));
  return planned.filter((p) => !sent.has(p.key)).map((p) => p.projectId);
}

/** User ids of the project's active members. */
async function activeUserIds(tx: Tx, projectId: string): Promise<string[]> {
  const members = await tx.member.findMany({
    where: { projectId, leftAt: null, removed: false },
    orderBy: { joinedAt: "asc" },
    select: { userId: true },
  });
  return members.map((m) => m.userId);
}

const iso = (d: Date) => d.toISOString();
const daysBefore = (now: Date, days: number) => new Date(now.getTime() - days * DAY_MS);

/** Which roast line a task gets (NotificationPayload TASK_OVERDUE.template): a stable hash of its id. */
export function roastTemplate(taskId: string): number {
  let h = 0;
  for (let i = 0; i < taskId.length; i++) h = (h * 31 + taskId.charCodeAt(i)) >>> 0;
  return h % ROAST_TEMPLATES;
}

// ─── Task rows (due soon, overdue) ───────────────────────────────────────────

/** An unfinished task of an ACTIVE project, with its effective due, owner and the project's active leader. */
type TaskRow = {
  id: string;
  projectId: string;
  title: string;
  status: string;
  ownerId: string | null;
  prereqTaskId: string | null;
  due: Date;
  timezone: string;
  ownerActive: boolean;
  ownerUserId: string | null;
  ownerName: string | null;
  leaderId: string | null;
  leaderUserId: string | null;
};

/** Unfinished tasks of ACTIVE (not deleted) projects whose effective due is in [from, to]; one project only with `projectId`. */
async function taskRows(db: Db | Tx, from: Date, to: Date, projectId?: string): Promise<TaskRow[]> {
  return db.$queryRaw<TaskRow[]>`
    SELECT t."id", t."projectId", t."title", t."status"::text AS "status", t."ownerId", t."prereqTaskId",
      coalesce(t."dueAt", p."deadline") AS "due", p."timezone",
      (o."id" IS NOT NULL AND o."leftAt" IS NULL AND NOT o."removed") AS "ownerActive",
      o."userId" AS "ownerUserId", ou."name" AS "ownerName",
      l."id" AS "leaderId", l."userId" AS "leaderUserId"
    FROM "Task" t
    JOIN "Project" p ON p."id" = t."projectId"
    LEFT JOIN "Member" o ON o."id" = t."ownerId"
    LEFT JOIN "User" ou ON ou."id" = o."userId"
    LEFT JOIN LATERAL (
      SELECT m."id", m."userId" FROM "Member" m
      WHERE m."projectId" = p."id" AND m."role" = 'LEADER' AND m."leftAt" IS NULL AND NOT m."removed"
      LIMIT 1
    ) l ON true
    WHERE p."status" = 'ACTIVE' AND p."deletedAt" IS NULL
      AND t."status" NOT IN ('DONE', 'HALF') AND (t."grade" IS NULL OR t."grade" = 'FAIL')
      AND coalesce(t."dueAt", p."deadline") >= ${from} AND coalesce(t."dueAt", p."deadline") <= ${to}
      ${projectId ? Prisma.sql`AND t."projectId" = ${projectId}` : Prisma.empty}
    ORDER BY t."order", t."number"`;
}

const ownerRef = (row: Pick<TaskRow, "ownerId" | "ownerName">): PersonRef | null =>
  row.ownerId && row.ownerName !== null ? { memberId: row.ownerId, name: row.ownerName } : null;

type DueSoonPlan = { key: string; kind: "owner" | "review" | "ownerless" };

/**
 * Which 24-hour reminder a task gets, if any. Handed in → the leader (TASK_DUE_REVIEW), never for the
 * leader's own task (they grade it themselves); an active owner → TASK_DUE_SOON; nobody → the leader
 * (TASK_OWNERLESS_SOON).
 */
export function dueSoonPlan(row: TaskRow): DueSoonPlan | null {
  const due = iso(row.due);
  if (row.status === "REVIEWING") {
    if (!row.leaderId || row.leaderId === row.ownerId) return null;
    return { key: `due24review:${row.id}:${row.ownerId ?? "none"}:${due}`, kind: "review" };
  }
  if (row.ownerActive) return { key: `due24:${row.id}:${row.ownerId}:${due}`, kind: "owner" };
  if (!row.leaderId) return null;
  return { key: `due24:${row.id}:none:${due}`, kind: "ownerless" };
}

/** The due-soon window at `now`: due − 24 h ≤ now and at least 1 h left. */
const dueSoonWindow = (now: Date) =>
  [new Date(now.getTime() + DUE_SOON_MIN_HOURS * HOUR_MS), new Date(now.getTime() + DUE_SOON_HOURS * HOUR_MS)] as const;

/** TASK_DUE_SOON / TASK_DUE_REVIEW / TASK_OWNERLESS_SOON. Returns the notifications sent. */
export async function remindDueSoon(db: Db, now: Date, stats?: TickStats): Promise<number> {
  const [from, to] = dueSoonWindow(now);
  const planned = (await taskRows(db, from, to)).flatMap((row) => {
    const plan = dueSoonPlan(row);
    return plan ? [{ projectId: row.projectId, key: plan.key }] : [];
  });
  return eachProject(db, await projectsWithUnsent(db, planned), "due soon", stats, async (tx, project) => {
    let sent = 0;
    for (const row of await taskRows(tx, from, to, project.id)) {
      const plan = dueSoonPlan(row);
      if (!plan || !(await claimReminder(tx, plan.key, project.id, now))) continue;
      const base = { taskId: row.id, title: row.title, dueAt: iso(row.due), timezone: row.timezone };
      if (plan.kind === "owner") {
        await notify(tx, { userIds: [row.ownerUserId!], projectId: project.id, type: "TASK_DUE_SOON", audience: "ONLY_YOU", payload: base, now });
      } else if (plan.kind === "review") {
        await notify(tx, {
          userIds: [row.leaderUserId!],
          projectId: project.id,
          type: "TASK_DUE_REVIEW",
          audience: "ONLY_LEADER",
          payload: { ...base, owner: ownerRef(row) },
          now,
        });
      } else {
        await notify(tx, { userIds: [row.leaderUserId!], projectId: project.id, type: "TASK_OWNERLESS_SOON", audience: "ONLY_LEADER", payload: base, now });
      }
      sent++;
    }
    return sent;
  });
}

/** Past due, unfinished and not handed in (「等组长审核」 isn't overdue): one key per task and due date. */
export function overduePlan(row: TaskRow): { key: string; owned: boolean } | null {
  if (row.status === "REVIEWING") return null;
  return { key: `overdue:${row.id}:${iso(row.due)}`, owned: row.ownerActive };
}

/** TASK_OVERDUE (rotating roast, to the whole group) / TASK_OWNERLESS_OVERDUE. Returns the notifications sent. */
export async function remindOverdue(db: Db, now: Date, stats?: TickStats): Promise<number> {
  const from = new Date(now.getTime() - OVERDUE_LOOKBACK_MS);
  const planned = (await taskRows(db, from, now)).flatMap((row) => {
    const plan = overduePlan(row);
    return plan ? [{ projectId: row.projectId, key: plan.key }] : [];
  });
  return eachProject(db, await projectsWithUnsent(db, planned), "overdue", stats, async (tx, project) => {
    const rows = await taskRows(tx, from, now, project.id);
    if (rows.length === 0) return 0;
    const userIds = await activeUserIds(tx, project.id);
    let sent = 0;
    for (const row of rows) {
      const plan = overduePlan(row);
      if (!plan || !(await claimReminder(tx, plan.key, project.id, now))) continue;
      if (plan.owned) {
        const prereq = row.prereqTaskId
          ? await tx.task.findUnique({ where: { id: row.prereqTaskId }, include: { owner: { include: { user: { select: { name: true } } } } } })
          : null;
        const waitingFor =
          prereq && !isFinished(prereq)
            ? { taskId: prereq.id, title: prereq.title, owner: prereq.owner ? { memberId: prereq.owner.id, name: prereq.owner.user.name } : null }
            : null;
        await notify(tx, {
          userIds,
          projectId: project.id,
          type: "TASK_OVERDUE",
          audience: "GROUP",
          mine: (userId) => userId === row.ownerUserId,
          payload: { taskId: row.id, title: row.title, dueAt: iso(row.due), owner: ownerRef(row)!, template: roastTemplate(row.id), waitingFor },
          now,
        });
      } else {
        await notify(tx, {
          userIds,
          projectId: project.id,
          type: "TASK_OWNERLESS_OVERDUE",
          audience: "GROUP",
          mine: (userId) => userId === row.leaderUserId,
          payload: { taskId: row.id, title: row.title, dueAt: iso(row.due) },
          now,
        });
      }
      sent += userIds.length;
    }
    return sent;
  });
}

// ─── Blocked by a prerequisite ───────────────────────────────────────────────

type BlockedRow = {
  projectId: string;
  deadline: Date;
  waitingId: string;
  waitingTitle: string;
  waitingDue: Date;
  waitingOwnerId: string | null;
  waitingOwnerName: string | null;
  prereqId: string;
  prereqTitle: string;
  prereqDue: Date;
  prereqOwnerId: string | null;
  prereqOwnerName: string | null;
  leaderUserId: string | null;
};

/**
 * Unfinished, not handed-in tasks of ACTIVE projects whose unfinished prerequisite was due in (since, dueBy].
 * `prereqReviewing` picks prerequisites handed in and waiting for the leader (not a hold-up by their owner)
 * or the others.
 */
async function blockedRows(
  db: Db | Tx,
  dueBy: Date,
  since: Date,
  prereqReviewing: boolean,
  projectId?: string,
): Promise<BlockedRow[]> {
  return db.$queryRaw<BlockedRow[]>`
    SELECT w."projectId", p."deadline",
      w."id" AS "waitingId", w."title" AS "waitingTitle", coalesce(w."dueAt", p."deadline") AS "waitingDue",
      w."ownerId" AS "waitingOwnerId", wu."name" AS "waitingOwnerName",
      q."id" AS "prereqId", q."title" AS "prereqTitle", coalesce(q."dueAt", p."deadline") AS "prereqDue",
      q."ownerId" AS "prereqOwnerId", qu."name" AS "prereqOwnerName",
      l."userId" AS "leaderUserId"
    FROM "Task" w
    JOIN "Task" q ON q."id" = w."prereqTaskId"
    JOIN "Project" p ON p."id" = w."projectId"
    LEFT JOIN "Member" wo ON wo."id" = w."ownerId"
    LEFT JOIN "User" wu ON wu."id" = wo."userId"
    LEFT JOIN "Member" qo ON qo."id" = q."ownerId"
    LEFT JOIN "User" qu ON qu."id" = qo."userId"
    LEFT JOIN LATERAL (
      SELECT m."userId" FROM "Member" m
      WHERE m."projectId" = p."id" AND m."role" = 'LEADER' AND m."leftAt" IS NULL AND NOT m."removed"
      LIMIT 1
    ) l ON true
    WHERE p."status" = 'ACTIVE' AND p."deletedAt" IS NULL AND l."userId" IS NOT NULL
      AND w."status" NOT IN ('DONE', 'HALF', 'REVIEWING') AND (w."grade" IS NULL OR w."grade" = 'FAIL')
      AND q."status" NOT IN ('DONE', 'HALF') AND (q."grade" IS NULL OR q."grade" = 'FAIL')
      AND ${prereqReviewing ? Prisma.sql`q."status" = 'REVIEWING'` : Prisma.sql`q."status" <> 'REVIEWING'`}
      AND coalesce(q."dueAt", p."deadline") <= ${dueBy}
      AND coalesce(q."dueAt", p."deadline") > ${since}
      ${projectId ? Prisma.sql`AND w."projectId" = ${projectId}` : Prisma.empty}
    ORDER BY w."order", w."number"`;
}

const blockedKey = (row: BlockedRow, reviewing: boolean) =>
  `${reviewing ? "blocked3review" : "blocked3"}:${row.waitingId}:${row.prereqId}:${iso(row.prereqDue)}`;

/** Prerequisites more than this late are not reminded about (a first deploy must not dig up old ones). */
const BLOCKED_LOOKBACK_DAYS = 14;

/** PREREQ_BLOCKED to the leader: the prerequisite is unfinished 3 days past its due. Returns the notifications sent. */
export async function remindBlocked(db: Db, now: Date, stats?: TickStats): Promise<number> {
  const dueBy = new Date(now.getTime() - BLOCKED_DAYS * DAY_MS);
  const since = new Date(now.getTime() - BLOCKED_LOOKBACK_DAYS * DAY_MS);
  const planned = [];
  for (const reviewing of [false, true]) {
    for (const row of await blockedRows(db, dueBy, since, reviewing)) planned.push({ projectId: row.projectId, key: blockedKey(row, reviewing) });
  }
  return eachProject(db, await projectsWithUnsent(db, planned), "blocked", stats, async (tx, project) => {
    let sent = 0;
    for (const reviewing of [false, true]) for (const row of await blockedRows(tx, dueBy, since, reviewing, project.id)) {
      if (!(await claimReminder(tx, blockedKey(row, reviewing), project.id, now))) continue;
      await notify(tx, {
        userIds: [row.leaderUserId!],
        projectId: project.id,
        type: "PREREQ_BLOCKED",
        audience: "ONLY_LEADER",
        payload: {
          waitingTaskId: row.waitingId,
          waitingTitle: row.waitingTitle,
          waitingOwner: row.waitingOwnerId && row.waitingOwnerName !== null ? { memberId: row.waitingOwnerId, name: row.waitingOwnerName } : null,
          waitingDueAt: iso(row.waitingDue),
          prereqTaskId: row.prereqId,
          prereqTitle: row.prereqTitle,
          prereqOwner: row.prereqOwnerId && row.prereqOwnerName !== null ? { memberId: row.prereqOwnerId, name: row.prereqOwnerName } : null,
          prereqDueAt: iso(row.prereqDue),
          blockedDays: Math.floor((now.getTime() - row.prereqDue.getTime()) / DAY_MS),
          projectDeadline: iso(row.deadline),
          awaitingGrade: reviewing,
        },
        now,
      });
      sent++;
    }
    return sent;
  });
}

// ─── Weekly summary ──────────────────────────────────────────────────────────

/**
 * The weekly summary's key when it is due at `now` in `tz`: the local day is a Sunday and it is 20:00 or
 * later (the first tick at or after 20:00 that same Sunday sends it); null otherwise.
 */
export function weeklyKey(projectId: string, now: Date, tz: string): string | null {
  const w = wallClock(now, tz);
  const sunday = new Date(Date.UTC(w.year, w.month - 1, w.day)).getUTCDay() === 0;
  if (!sunday || now < zonedTime(w.year, w.month, w.day, WEEKLY_HOUR, 0, tz)) return null;
  return `weekly:${projectId}:${localDate(now, tz)}`;
}

/** WEEKLY_SUMMARY to each active member who wants it (ACTIVE and AWAITING_CONFIRM projects). Returns the notifications sent. */
export async function sendWeekly(db: Db, now: Date, stats?: TickStats): Promise<number> {
  const running = await db.project.findMany({
    where: { status: { in: ["ACTIVE", "AWAITING_CONFIRM"] }, deletedAt: null },
    select: { id: true, timezone: true },
  });
  const planned = running.flatMap((p) => {
    const key = weeklyKey(p.id, now, p.timezone);
    return key ? [{ projectId: p.id, key }] : [];
  });
  return eachProject(db, await projectsWithUnsent(db, planned), "weekly", stats, async (tx, project) => {
    if ((project.status !== "ACTIVE" && project.status !== "AWAITING_CONFIRM") || project.deletedAt !== null) return 0;
    const key = weeklyKey(project.id, now, project.timezone);
    if (!key || !(await claimReminder(tx, key, project.id, now))) return 0;

    const tasks = await tx.task.findMany({
      where: { projectId: project.id },
      select: { status: true, grade: true, points: true, finishedAt: true, dueAt: true, ownerId: true },
    });
    const members = await tx.member.findMany({ where: { projectId: project.id }, include: { user: { select: { name: true, weeklyEnabled: true } } } });
    const weekStart = now.getTime() - 7 * DAY_MS;
    const nextWeek = now.getTime() + 7 * DAY_MS;
    const finished = tasks.filter((t) => isFinished(t) && t.finishedAt !== null && t.finishedAt.getTime() > weekStart && t.finishedAt <= now);
    const byOwner = new Map<string, number>();
    for (const t of finished) if (t.ownerId) byOwner.set(t.ownerId, (byOwner.get(t.ownerId) ?? 0) + earnedPoints(t));
    let top: { member: PersonRef; points: number } | null = null;
    for (const [memberId, points] of byOwner) {
      const m = members.find((x) => x.id === memberId);
      if (!m || points <= 0) continue;
      const better = !top || points > top.points || (points === top.points && m.user.name.localeCompare(top.member.name) < 0);
      if (better) top = { member: { memberId, name: m.user.name }, points };
    }
    const payload = {
      weekEnding: localDate(now, project.timezone),
      finishedCount: finished.length,
      finishedPoints: finished.reduce((sum, t) => sum + earnedPoints(t), 0),
      totalPoints: tasks.reduce((sum, t) => sum + earnedPoints(t), 0),
      overdueCount: tasks.filter((t) => isOverdue(t, project, now)).length,
      dueNextWeekCount: tasks.filter((t) => {
        if (isFinished(t) || t.status === "REVIEWING") return false;
        const due = effectiveDue(t, project).getTime();
        return due > now.getTime() && due <= nextWeek;
      }).length,
      top,
    };
    const userIds = members.filter((m) => m.leftAt === null && !m.removed && m.user.weeklyEnabled).map((m) => m.userId);
    await notify(tx, { userIds, projectId: project.id, type: "WEEKLY_SUMMARY", audience: "GROUP", mine: false, payload, now });
    return userIds.length;
  });
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

const leaderOf = (tx: Tx, projectId: string) =>
  tx.member.findFirst({ where: { projectId, role: "LEADER", leftAt: null, removed: false }, select: { userId: true } });

/** ACTIVE projects past their deadline become AWAITING_CONFIRM and the leader hears PROJECT_DUE. Returns the projects moved. */
export async function markProjectsDue(db: Db, now: Date, stats?: TickStats): Promise<number> {
  const due = await db.project.findMany({ where: { status: "ACTIVE", deletedAt: null, deadline: { lte: now } }, select: { id: true } });
  return eachProject(db, due.map((p) => p.id), "project due", stats, async (tx, project) => {
    if (project.status !== "ACTIVE" || project.deletedAt !== null || project.deadline > now) return 0;
    await tx.project.update({ where: { id: project.id }, data: { status: "AWAITING_CONFIRM", awaitingSince: project.deadline } });
    const leader = await leaderOf(tx, project.id);
    if (leader && (await claimReminder(tx, `pdue:${project.id}:${iso(project.deadline)}`, project.id, now))) {
      await notify(tx, {
        userIds: [leader.userId],
        projectId: project.id,
        type: "PROJECT_DUE",
        audience: "ONLY_LEADER",
        payload: { deadline: iso(project.deadline), autoEndAt: iso(autoEndAt(project.deadline)) },
        now,
      });
    }
    return 1;
  });
}

/** PROJECT_AUTO_END_SOON to the leader, 6 days after the deadline (the day before the auto-end). Returns the notifications sent. */
export async function warnAutoEnd(db: Db, now: Date, stats?: TickStats): Promise<number> {
  const rows = await db.project.findMany({
    where: {
      status: "AWAITING_CONFIRM",
      deletedAt: null,
      deadline: { lte: daysBefore(now, AUTO_END_WARN_DAYS), gt: daysBefore(now, AUTO_END_DAYS) },
    },
    select: { id: true, deadline: true },
  });
  const keyOf = (p: { id: string; deadline: Date }) => `autoend-soon:${p.id}:${iso(p.deadline)}`;
  const ids = await projectsWithUnsent(db, rows.map((p) => ({ projectId: p.id, key: keyOf(p) })));
  return eachProject(db, ids, "auto-end warning", stats, async (tx, project) => {
    if (project.status !== "AWAITING_CONFIRM" || project.deletedAt !== null) return 0;
    const at = autoEndAt(project.deadline);
    if (now < autoEndWarnAt(project.deadline) || now >= at) return 0;
    const leader = await leaderOf(tx, project.id);
    if (!leader || !(await claimReminder(tx, keyOf(project), project.id, now))) return 0;
    await notify(tx, {
      userIds: [leader.userId],
      projectId: project.id,
      type: "PROJECT_AUTO_END_SOON",
      audience: "ONLY_LEADER",
      payload: { deadline: iso(project.deadline), autoEndAt: iso(at) },
      now,
    });
    return 1;
  });
}

/** AWAITING_CONFIRM 7 days after the deadline: ended automatically (endedAuto), everyone hears it. Returns the projects ended. */
export async function autoEndProjects(db: Db, now: Date, stats?: TickStats): Promise<number> {
  const due = await db.project.findMany({
    where: { status: "AWAITING_CONFIRM", deletedAt: null, deadline: { lte: daysBefore(now, AUTO_END_DAYS) } },
    select: { id: true },
  });
  return eachProject(db, due.map((p) => p.id), "auto-end", stats, async (tx, project) => {
    if (project.status !== "AWAITING_CONFIRM" || project.deletedAt !== null || now < autoEndAt(project.deadline)) return 0;
    await endUnderLock(tx, project, null, now);
    return 1;
  });
}

/** Which deletion warning an ENDED project gets at `now` (1 day before wins over 3), or null. */
export function deleteWarning(purgeAfter: Date, now: Date): number | null {
  if (now >= purgeAfter) return null;
  const days = [...DELETE_WARN_DAYS].sort((a, b) => a - b).find((d) => now.getTime() >= purgeAfter.getTime() - d * DAY_MS);
  return days ?? null;
}

/** PROJECT_DELETE_SOON to every active member, 3 days and 1 day before an ENDED project is deleted. Returns the notifications sent. */
export async function warnDeletion(db: Db, now: Date, stats?: TickStats): Promise<number> {
  const most = Math.max(...DELETE_WARN_DAYS);
  const rows = await db.project.findMany({
    where: { status: "ENDED", deletedAt: null, purgeAfter: { gt: now, lte: new Date(now.getTime() + most * DAY_MS) } },
    select: { id: true, purgeAfter: true },
  });
  const keyOf = (id: string, purgeAfter: Date, days: number) => `del${days}:${id}:${iso(purgeAfter)}`;
  const planned = rows.flatMap((p) => {
    const days = deleteWarning(p.purgeAfter!, now);
    return days ? [{ projectId: p.id, key: keyOf(p.id, p.purgeAfter!, days) }] : [];
  });
  return eachProject(db, await projectsWithUnsent(db, planned), "deletion warning", stats, async (tx, project) => {
    if (project.status !== "ENDED" || project.deletedAt !== null || project.purgeAfter === null) return 0;
    const days = deleteWarning(project.purgeAfter, now);
    if (!days || !(await claimReminder(tx, keyOf(project.id, project.purgeAfter, days), project.id, now))) return 0;
    const userIds = await activeUserIds(tx, project.id);
    await notify(tx, {
      userIds,
      projectId: project.id,
      type: "PROJECT_DELETE_SOON",
      audience: "GROUP",
      payload: { days, purgeAfter: iso(project.purgeAfter) },
      now,
    });
    return userIds.length;
  });
}

/** Pending swaps past their 72 hours become EXPIRED (their requesters told), project by project. Returns the swaps expired. */
export async function expireAllSwaps(db: Db, now: Date, stats?: TickStats): Promise<number> {
  const due = await db.swapRequest.findMany({
    where: { status: "PENDING", expiresAt: { lte: now } },
    select: { projectId: true },
    distinct: ["projectId"],
  });
  return eachProject(db, due.map((d) => d.projectId), "swap expiry", stats, async (tx, project) =>
    (await expireSwaps(tx, { projectId: project.id }, now)).length,
  );
}

/** Ended projects past purgeAfter and projects deleted for everyone past theirs, deleted for good with their files. */
export async function purgeProjects(db: Db, now: Date): Promise<number> {
  return (await purgeDeletedProjects(db, now, { ended: true })).length;
}

// ─── The tick ────────────────────────────────────────────────────────────────

type Job = (db: Db, now: Date, stats: TickStats) => Promise<number>;

const JOBS: [Exclude<keyof TickResult, "now" | "errors">, Job][] = [
  ["swapsExpired", expireAllSwaps],
  ["projectsDue", markProjectsDue],
  ["autoEndWarnings", warnAutoEnd],
  ["autoEnded", autoEndProjects],
  ["dueSoon", remindDueSoon],
  ["overdue", remindOverdue],
  ["blocked", remindBlocked],
  ["weekly", sendWeekly],
  ["deleteWarnings", warnDeletion],
  ["purged", (db, now) => purgeProjects(db, now)],
  // M6: AI jobs that are due (and stale leases); the dev server and the schedule both get here.
  ["aiJobs", (db, now) => drainAiJobs(db, now)],
];

/**
 * One pass of every job at `now`. Safe to run again or at the same time as another tick: each reminder
 * goes out once. A job that fails is logged and counted in `errors`; the others still run.
 */
export async function runTick(db: Db, now: Date): Promise<TickResult> {
  const stats: TickStats = { errors: 0 };
  const result: TickResult = {
    now: iso(now),
    swapsExpired: 0,
    projectsDue: 0,
    autoEndWarnings: 0,
    autoEnded: 0,
    dueSoon: 0,
    overdue: 0,
    blocked: 0,
    weekly: 0,
    deleteWarnings: 0,
    purged: 0,
    aiJobs: 0,
    errors: 0,
  };
  for (const [name, job] of JOBS) {
    try {
      result[name] = await job(db, now, stats);
    } catch (err) {
      stats.errors++;
      console.error(`tick: job ${name} failed`, err);
    }
  }
  result.errors = stats.errors;
  return result;
}
