// The project lifecycle's writes (M5 spec §3, §4): 结束项目, 重新打开, and 一键延后. The tick
// (services/tick.ts) moves projects to AWAITING_CONFIRM and ends them automatically through endUnderLock.
import type { AdjustedTask, PersonRef } from "../../../shared/types";
import type { Member, Project } from "../generated/prisma/client";
import { isRunning, projectEnded } from "../lib/access";
import { clock } from "../lib/clock";
import type { Db } from "../lib/db";
import { AppError, conflict, notFound } from "../lib/errors";
import { endedPurgeAt } from "../lib/lifecycle";
import { effectiveDue, isFinished } from "../lib/package-state";
import { toInstant } from "../lib/plan/dates";
import { bumpPackages, notify, recordEvent, voidSwaps } from "./notify";
import { rescheduleTasks } from "./projects";
import { resolveDueAt } from "./tasks";
import { lockAsMember, lockProject, memberUnderLock, touchProject, TX_OPTIONS, type Tx } from "./tx";

async function personOf(tx: Tx, member: Member): Promise<PersonRef> {
  const user = await tx.user.findUniqueOrThrow({ where: { id: member.userId }, select: { name: true } });
  return { memberId: member.id, name: user.name };
}

/** User ids of the active members, except `exceptMemberId`. */
async function activeUserIds(tx: Tx, projectId: string, exceptMemberId: string | null): Promise<string[]> {
  const members = await tx.member.findMany({
    where: { projectId, leftAt: null, removed: false, ...(exceptMemberId ? { id: { not: exceptMemberId } } : {}) },
    select: { userId: true },
  });
  return members.map((m) => m.userId);
}

/**
 * Ends a running project the caller locked (never one deleted for everyone: both callers exclude those):
 * ENDED, endedAt = now, purgeAfter = now + 14 days. Pending swaps end as VOID (PROJECT_ENDED; nobody gets
 * SWAP_VOID). `leader` null: the tick ended it (endedAuto) and everyone hears it; else everyone but the
 * leader. One feed entry, one packages bump.
 */
export async function endUnderLock(tx: Tx, project: Project, leader: Member | null, now: Date): Promise<void> {
  const keep = endedPurgeAt(now);
  await tx.project.update({
    where: { id: project.id },
    data: { status: "ENDED", endedAt: now, endedById: leader?.id ?? null, endedAuto: leader === null, awaitingSince: null, purgeAfter: keep },
  });
  await voidSwaps(tx, { projectId: project.id, all: true, reason: "PROJECT_ENDED", voidedById: leader?.id ?? null, now, notify: false });
  await notify(tx, {
    userIds: await activeUserIds(tx, project.id, leader?.id ?? null),
    projectId: project.id,
    type: "PROJECT_ENDED",
    audience: "GROUP",
    payload: { auto: leader === null, leader: leader ? await personOf(tx, leader) : null, purgeAfter: keep.toISOString() },
    now,
  });
  await recordEvent(tx, { projectId: project.id, actorId: leader?.id ?? null, type: "PROJECT_ENDED", payload: { auto: leader === null }, now });
  await bumpPackages(tx, project.id);
}

/** 结束项目 (the leader; ACTIVE or AWAITING_CONFIRM). An ENDED project → 409 PROJECT_ENDED; a draft → 409 CONFLICT. */
export async function endProject(db: Db, projectId: string, userId: string, now = clock.now()): Promise<void> {
  await db.$transaction(async (tx) => {
    const { project, member } = await lockAsMember(tx, projectId, userId, { leader: true });
    await endUnderLock(tx, project, member, now);
  }, TX_OPTIONS);
}

/**
 * 重新打开 (the leader; ENDED, before purgeAfter). When the deadline has passed a new one is required
 * (DEADLINE_REQUIRED) and must be after now (DEADLINE_IN_PAST); otherwise it is optional. A new
 * deadline re-spreads the task dates as a deadline edit does. The project is ACTIVE again with the end
 * fields cleared, so the reminders and the 7-day auto-end apply as before.
 */
export async function reopenProject(
  db: Db,
  projectId: string,
  userId: string,
  input: { deadline?: string },
  now = clock.now(),
): Promise<{ adjustedTasks?: AdjustedTask[] }> {
  return db.$transaction(async (tx) => {
    const project = await lockProject(tx, projectId);
    const leader = await memberUnderLock(tx, project, userId, { leader: true });
    if (project.status !== "ENDED") throw conflict("The project hasn't ended");
    if (project.purgeAfter !== null && project.purgeAfter <= now) throw conflict("The project can no longer be reopened");

    let deadline: Date | null = null;
    if (input.deadline !== undefined) {
      const next = toInstant(input.deadline, project.timezone);
      if (next <= now) throw new AppError(400, "DEADLINE_IN_PAST", "The deadline must be in the future");
      if (next.getTime() !== project.deadline.getTime()) deadline = next;
    } else if (project.deadline <= now) {
      throw new AppError(400, "DEADLINE_REQUIRED", "The deadline has passed: choose a new one to reopen the project");
    }

    await tx.project.update({
      where: { id: projectId },
      data: {
        status: "ACTIVE",
        endedAt: null,
        endedById: null,
        endedAuto: false,
        awaitingSince: null,
        purgeAfter: null,
        ...(deadline ? { deadline } : {}),
      },
    });
    const adjustedTasks = deadline ? await rescheduleTasks(tx, project, deadline, project.timezone, now) : undefined;
    const finalDeadline = (deadline ?? project.deadline).toISOString();
    await notify(tx, {
      userIds: await activeUserIds(tx, projectId, leader.id),
      projectId,
      type: "PROJECT_REOPENED",
      audience: "GROUP",
      payload: { leader: await personOf(tx, leader), deadline: finalDeadline },
      now,
    });
    await recordEvent(tx, { projectId, actorId: leader.id, type: "PROJECT_REOPENED", payload: { deadline: finalDeadline }, now });
    await bumpPackages(tx, projectId);
    return adjustedTasks ? { adjustedTasks } : {};
  }, TX_OPTIONS);
}

/**
 * 一键延后 (the leader; M5 spec §4): moves an unfinished task's due date later. It becomes the leader's
 * date (leaderDueAt, as a due-date edit), never after the project deadline (DUE_AFTER_DEADLINE), and must
 * be later than the current effective due (DELAY_NOT_LATER). The owner (unless it is the leader) hears
 * TASK_DELAYED, with the prerequisite it waits for when that is unfinished.
 */
export async function delayTask(
  db: Db,
  projectId: string,
  taskId: string,
  userId: string,
  input: { dueAt: string },
  now = clock.now(),
): Promise<void> {
  await db.$transaction(async (tx) => {
    const { project, member: leader } = await lockAsMember(tx, projectId, userId, { leader: true });
    if (!isRunning(project)) throw projectEnded();
    const task = await tx.task.findFirst({
      where: { id: taskId, projectId },
      include: { owner: true, prereqTask: { select: { id: true, title: true, status: true, grade: true } } },
    });
    if (!task) throw notFound("Task");
    if (isFinished(task)) throw new AppError(409, "TASK_FINISHED", "This task is finished already");

    const from = effectiveDue(task, project);
    const dueAt = resolveDueAt(input.dueAt, project);
    if (dueAt <= from) throw new AppError(400, "DELAY_NOT_LATER", "Pick a date later than the current due date");
    if (dueAt <= now) throw new AppError(400, "DELAY_IN_PAST", "Pick a date after now");

    await tx.task.update({ where: { id: task.id }, data: { dueAt, leaderDueAt: dueAt } });
    await touchProject(tx, projectId);
    const prereq = task.prereqTask && !isFinished(task.prereqTask) ? { taskId: task.prereqTask.id, title: task.prereqTask.title } : null;
    const owner = task.owner;
    if (owner && owner.id !== leader.id && owner.leftAt === null && !owner.removed) {
      await notify(tx, {
        userIds: [owner.userId],
        projectId,
        type: "TASK_DELAYED",
        audience: "ONLY_YOU",
        payload: { taskId: task.id, title: task.title, dueAt: dueAt.toISOString(), fromDueAt: from.toISOString(), prereq },
        now,
      });
    }
    await recordEvent(tx, {
      projectId,
      actorId: leader.id,
      type: "TASK_DELAYED",
      payload: { taskId: task.id, title: task.title, dueAt: dueAt.toISOString(), fromDueAt: from.toISOString() },
      now,
    });
    // Due dates change the package rows (overdue).
    await bumpPackages(tx, projectId);
  }, TX_OPTIONS);
}
