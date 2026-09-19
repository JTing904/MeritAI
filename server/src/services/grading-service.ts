// The leader's side of grading (M4 spec §2): grade, grade outside the app, override, undo an override.
// Every one ends the same way (afterGrade): the task's grade and status re-derived, the finished-now
// effects, the owner told (never the leader, never someone who left), the feed, the inactive-owner
// release and one packages bump.
import type { Grade, Member } from "../generated/prisma/client";
import type { Db } from "../lib/db";
import { AppError, conflict, notFound } from "../lib/errors";
import { countingAttempt, earnedFor, effectiveDue, finishedEffects, isLate, recomputeTask, releaseIfOwnerInactive } from "../lib/grading";
import {
  alreadyReviewing,
  isCountingAttempt,
  nextAttemptNo,
  notReviewing,
  openAttempt,
  ownerToTell,
  taskDone,
  taskUnderLock,
  type TaskWithOwner,
} from "./attempts";
import { bumpPackages, notify, recordEvent } from "./notify";
import { personRef, startUnderLock } from "./packages";
import type { GradeBody, GradeOutsideBody, OverrideBody } from "./schemas";
import { lockAsMember, TX_OPTIONS, type Tx } from "./tx";

type LeaderGrade = GradeBody["grade"];

/** The 理由 / 评语, trimmed (null when empty); required for HALF and FAIL. */
function gradeNote(grade: LeaderGrade, note: string | null | undefined): string | null {
  const text = note?.trim() || null;
  if (text === null && (grade === "HALF" || grade === "FAIL")) {
    throw new AppError(400, "GRADE_REASON_REQUIRED", 'A reason is required for "Half" or "Fail"');
  }
  return text;
}

/**
 * The shared tail of every grade-type write, after the attempt row changed: re-derives the task, runs
 * the finished-now effects, and releases a leaver's unfinished task. Returns what the task earns now
 * and whether `attemptId` is the counting attempt.
 */
async function afterGrade(
  tx: Tx,
  task: TaskWithOwner,
  attemptId: string,
  actorUserId: string,
  now: Date,
): Promise<{ earned: number; counting: boolean }> {
  const { after, becameFinished } = await recomputeTask(tx, task.id, now);
  if (becameFinished) await finishedEffects(tx, after, actorUserId, now);
  const counting = await isCountingAttempt(tx, task.id, attemptId);
  await releaseIfOwnerInactive(tx, task);
  return { earned: earnedFor(after.points, after.grade), counting };
}

/**
 * The leader's own tasks are only ever 「合格（组长自评）」 (REQUIREMENTS §13, 2026-09-19): no grading,
 * grading outside the app, overriding or undoing on them.
 */
function assertNotOwnTask(task: TaskWithOwner, leader: Member): void {
  if (task.ownerId === leader.id) {
    throw new AppError(403, "SELF_GRADE_NOT_ALLOWED", "The leader's own tasks count as Pass (leader self-graded) and can't be graded otherwise");
  }
}

/** Set only by the development status tool (dev-tasks.ts), which also marks the leader's own tasks; request bodies never carry it (zod drops unknown keys). */
type DevToolFlag = { devTool?: true };

async function assertNothingPending(tx: Tx, taskId: string): Promise<void> {
  if ((await tx.attempt.count({ where: { taskId, status: "PENDING" } })) > 0) throw alreadyReviewing();
}

/** 评级: the task's PENDING attempt (NOT_REVIEWING otherwise); a reason is required for HALF / FAIL. */
export async function gradeAttempt(
  db: Db,
  projectId: string,
  taskId: string,
  userId: string,
  input: GradeBody & DevToolFlag,
  now = new Date(),
): Promise<void> {
  await db.$transaction(async (tx) => {
    const { member: leader } = await lockAsMember(tx, projectId, userId, { leader: true });
    const task = await taskUnderLock(tx, projectId, taskId);
    if (!input.devTool) assertNotOwnTask(task, leader);
    const pending = await tx.attempt.findFirst({ where: { taskId: task.id, status: "PENDING" } });
    if (!pending) throw notReviewing();
    const note = gradeNote(input.grade, input.note);
    const { count } = await tx.attempt.updateMany({
      where: { id: pending.id, status: "PENDING" },
      data: { status: "GRADED", grade: input.grade, gradeNote: note, gradedById: leader.id, gradedAt: now },
    });
    if (count !== 1) throw notReviewing();

    const { earned, counting } = await afterGrade(tx, task, pending.id, userId, now);
    const owner = ownerToTell(task, leader);
    if (owner) {
      await notify(tx, {
        userIds: [owner.userId],
        projectId,
        type: "GRADED",
        audience: "ONLY_YOU",
        payload: { taskId: task.id, title: task.title, attemptNo: pending.no, grade: input.grade, points: task.points, earned, counting },
        now,
      });
    }
    await recordEvent(tx, {
      projectId,
      actorId: leader.id,
      type: "GRADED",
      payload: {
        taskId: task.id,
        title: task.title,
        owner: task.owner ? personRef(task.owner) : null,
        grade: input.grade,
        attemptNo: pending.no,
        selfGraded: false,
        outsideApp: false,
      },
      now,
    });
    await bumpPackages(tx, projectId);
  }, TX_OPTIONS);
}

/**
 * 证据在 App 外交给我了（组长代为完成）: grades the DRAFT attempt (its evidence stays) or a new one as
 * handed in outside the app. Starts a never-started task as its owner, but never takes over someone
 * else's start.
 */
export async function gradeOutside(
  db: Db,
  projectId: string,
  taskId: string,
  userId: string,
  input: GradeOutsideBody & DevToolFlag,
  now = new Date(),
): Promise<void> {
  await db.$transaction(async (tx) => {
    const { project, member: leader } = await lockAsMember(tx, projectId, userId, { leader: true });
    const task = await taskUnderLock(tx, projectId, taskId);
    if (!input.devTool) assertNotOwnTask(task, leader);
    if (task.ownerId === null || task.owner === null) throw new AppError(409, "TASK_NO_OWNER", "Nobody is responsible for this task yet");
    const open = await openAttempt(tx, task.id);
    if (open?.status === "PENDING") throw alreadyReviewing();
    if (task.status === "DONE") throw taskDone();
    const note = gradeNote(input.grade, input.note);

    await startUnderLock(tx, task, task.owner, now, { allowReattribute: false });
    const data = {
      status: "GRADED" as const,
      outsideApp: true,
      outsideNote: input.outsideNote?.trim() || null,
      submittedById: null,
      submittedAt: now,
      late: isLate(now, effectiveDue(task, project)),
      grade: input.grade,
      gradeNote: note,
      gradedById: leader.id,
      gradedAt: now,
    };
    let attempt: { id: string; no: number };
    if (open) {
      const { count } = await tx.attempt.updateMany({ where: { id: open.id, status: "DRAFT" }, data });
      if (count !== 1) throw alreadyReviewing();
      attempt = open;
    } else {
      attempt = await tx.attempt.create({ data: { taskId: task.id, no: await nextAttemptNo(tx, task.id), ...data }, select: { id: true, no: true } });
    }

    const { earned, counting } = await afterGrade(tx, task, attempt.id, userId, now);
    const owner = ownerToTell(task, leader);
    if (owner) {
      await notify(tx, {
        userIds: [owner.userId],
        projectId,
        type: "GRADED_OUTSIDE",
        audience: "ONLY_YOU",
        payload: {
          taskId: task.id,
          title: task.title,
          grade: input.grade,
          points: task.points,
          earned,
          counting,
          outsideNote: data.outsideNote,
        },
        now,
      });
    }
    await recordEvent(tx, {
      projectId,
      actorId: leader.id,
      type: "GRADED",
      payload: {
        taskId: task.id,
        title: task.title,
        owner: personRef(task.owner),
        grade: input.grade,
        attemptNo: attempt.no,
        selfGraded: false,
        outsideApp: true,
      },
      now,
    });
    await bumpPackages(tx, projectId);
  }, TX_OPTIONS);
}

/** OVERRIDDEN to the owner and in the feed (an override or its undo). */
async function tellOverride(
  tx: Tx,
  task: TaskWithOwner,
  leader: Member,
  change: { attemptNo: number; fromGrade: Grade; toGrade: Grade; undone: boolean },
  result: { earned: number; counting: boolean },
  now: Date,
): Promise<void> {
  const owner = ownerToTell(task, leader);
  if (owner) {
    await notify(tx, {
      userIds: [owner.userId],
      projectId: task.projectId,
      type: "OVERRIDDEN",
      audience: "ONLY_YOU",
      payload: { taskId: task.id, title: task.title, ...change, points: task.points, ...result },
      now,
    });
  }
  await recordEvent(tx, {
    projectId: task.projectId,
    actorId: leader.id,
    type: "OVERRIDDEN",
    payload: { taskId: task.id, title: task.title, owner: task.owner ? personRef(task.owner) : null, ...change },
    now,
  });
}

/**
 * 推翻评级: changes a GRADED attempt's grade (default the counting one; `attemptId` picks another) with a
 * reason. Any of the four levels, down too; points follow at once. Not while a submission waits.
 */
export async function overrideGrade(
  db: Db,
  projectId: string,
  taskId: string,
  userId: string,
  input: OverrideBody & DevToolFlag,
  now = new Date(),
): Promise<void> {
  await db.$transaction(async (tx) => {
    const { member: leader } = await lockAsMember(tx, projectId, userId, { leader: true });
    const task = await taskUnderLock(tx, projectId, taskId);
    if (!input.devTool) assertNotOwnTask(task, leader);
    await assertNothingPending(tx, task.id);
    const attempts = await tx.attempt.findMany({ where: { taskId: task.id } });
    let target;
    if (input.attemptId !== undefined) {
      target = attempts.find((a) => a.id === input.attemptId);
      if (!target) throw notFound("Attempt");
      if (target.status !== "GRADED" || target.grade === null) throw new AppError(400, "VALIDATION", "Only a graded attempt can be overridden");
    } else {
      target = countingAttempt(attempts);
      if (!target) throw new AppError(409, "NOT_GRADED", "Not graded yet, so there's nothing to override");
    }
    const fromGrade = target.grade!;
    if (fromGrade === input.grade) throw new AppError(400, "VALIDATION", "The attempt already has this grade");
    const reason = input.reason.trim();
    if (!reason) throw new AppError(400, "REASON_REQUIRED", "A reason is required");

    const { count } = await tx.attempt.updateMany({
      where: { id: target.id, status: "GRADED", grade: fromGrade },
      data: { grade: input.grade },
    });
    if (count !== 1) throw conflict("The grade just changed; reload and try again");
    await tx.gradeChange.create({
      data: { attemptId: target.id, fromGrade, toGrade: input.grade, reason, byId: leader.id, createdAt: now },
    });

    const result = await afterGrade(tx, task, target.id, userId, now);
    await tellOverride(tx, task, leader, { attemptNo: target.no, fromGrade, toGrade: input.grade, undone: false }, result, now);
    await bumpPackages(tx, projectId);
  }, TX_OPTIONS);
}

/**
 * 撤销上次推翻: undoes the task's most recent live GradeChange, across all its attempts (NOTHING_TO_UNDO
 * without one); the attempt gets its earlier grade back. Repeating walks back one change at a time.
 */
export async function undoOverride(db: Db, projectId: string, taskId: string, userId: string, now = new Date()): Promise<void> {
  await db.$transaction(async (tx) => {
    const { member: leader } = await lockAsMember(tx, projectId, userId, { leader: true });
    const task = await taskUnderLock(tx, projectId, taskId);
    assertNotOwnTask(task, leader);
    await assertNothingPending(tx, task.id);
    const change = await tx.gradeChange.findFirst({
      where: { attempt: { taskId: task.id }, undoneAt: null },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: { attempt: { select: { id: true, no: true } } },
    });
    if (!change) throw new AppError(409, "NOTHING_TO_UNDO", "There's no override to undo");

    const { count } = await tx.attempt.updateMany({
      where: { id: change.attemptId, status: "GRADED", grade: change.toGrade },
      data: { grade: change.fromGrade },
    });
    if (count !== 1) throw conflict("The grade just changed; reload and try again");
    await tx.gradeChange.update({ where: { id: change.id }, data: { undoneAt: now, undoneById: leader.id } });

    const result = await afterGrade(tx, task, change.attemptId, userId, now);
    await tellOverride(
      tx,
      task,
      leader,
      { attemptNo: change.attempt.no, fromGrade: change.toGrade, toGrade: change.fromGrade, undone: true },
      result,
      now,
    );
    await bumpPackages(tx, projectId);
  }, TX_OPTIONS);
}
