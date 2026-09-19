// The owner's side of an attempt (M4 spec §2): undo 开始做, submit, withdraw, and 我开完了 for meetings.
// Also the small helpers evidence.ts and grading-service.ts share (all run under the project lock).
import type { Attempt, Member, Prisma, Task } from "../generated/prisma/client";
import { isActiveMember } from "../lib/access";
import type { Db } from "../lib/db";
import { AppError, conflict, forbidden, notFound } from "../lib/errors";
import { countingAttempt, effectiveDue, finishedEffects, isLate, recomputeTask, UNDO_START_MS } from "../lib/grading";
import { bumpPackages, notify, recordEvent } from "./notify";
import { personRef, startUnderLock, WITH_NAME } from "./packages";
import type { MeetingDoneBody } from "./schemas";
import { lockAsMember, TX_OPTIONS, type Tx } from "./tx";

export const alreadyReviewing = () =>
  new AppError(409, "ALREADY_REVIEWING", "Already submitted and waiting for review. Withdraw it to make changes");
export const notReviewing = () => new AppError(409, "NOT_REVIEWING", "This task isn't waiting for review right now");
export const taskDone = () => new AppError(409, "TASK_DONE", "This task already has full points");

const TASK_WITH_OWNER = { owner: { include: WITH_NAME } } satisfies Prisma.TaskInclude;
export type TaskWithOwner = Prisma.TaskGetPayload<{ include: typeof TASK_WITH_OWNER }>;

/** The task (with its owner's name) of this project, re-read under the lock; 404 otherwise. */
export async function taskUnderLock(tx: Tx, projectId: string, taskId: string): Promise<TaskWithOwner> {
  const task = await tx.task.findFirst({ where: { id: taskId, projectId }, include: TASK_WITH_OWNER });
  if (!task) throw notFound("Task");
  return task;
}

/** Only the task's owner (a task nobody owns answers 403 too). */
export function assertOwner(task: Pick<Task, "ownerId">, member: Pick<Member, "id">, message: string): void {
  if (task.ownerId === null || task.ownerId !== member.id) throw forbidden(message);
}

/** The task's attempt that isn't GRADED yet (DRAFT or PENDING; at most one, kept so by the lock). */
export function openAttempt(tx: Tx, taskId: string): Promise<Attempt | null> {
  return tx.attempt.findFirst({ where: { taskId, status: { in: ["DRAFT", "PENDING"] } }, orderBy: { no: "desc" } });
}

/** 第 N 次 for a new attempt. */
export async function nextAttemptNo(tx: Tx, taskId: string): Promise<number> {
  const last = await tx.attempt.findFirst({ where: { taskId }, orderBy: { no: "desc" }, select: { no: true } });
  return (last?.no ?? 0) + 1;
}

/** Whether `attemptId` is the attempt the task earns its grade from, after the write. */
export async function isCountingAttempt(tx: Tx, taskId: string, attemptId: string): Promise<boolean> {
  const attempts = await tx.attempt.findMany({ where: { taskId }, select: { id: true, no: true, status: true, grade: true } });
  return countingAttempt(attempts)?.id === attemptId;
}

/** The owner to tell about a grade-type write: an active member other than the actor; null otherwise. */
export function ownerToTell(task: TaskWithOwner, actor: Pick<Member, "id">): TaskWithOwner["owner"] {
  const owner = task.owner;
  return owner && isActiveMember(owner) && owner.id !== actor.id ? owner : null;
}

/**
 * 撤销「开始做」: only the owner who started it, while DOING, within 24 h of the start (UNDO_START_EXPIRED)
 * and before the task has any attempt row (HAS_EVIDENCE: even a deleted file leaves its attempt). The start
 * is cleared entirely; swaps it voided stay void.
 */
export async function undoStart(db: Db, projectId: string, taskId: string, userId: string, now = new Date()): Promise<void> {
  await db.$transaction(async (tx) => {
    const { member } = await lockAsMember(tx, projectId, userId);
    const task = await taskUnderLock(tx, projectId, taskId);
    assertOwner(task, member, "Only the task's owner can undo its start");
    if (task.startedAt === null || task.startedById !== member.id || task.status !== "DOING") {
      throw conflict("This task isn't started by you");
    }
    if ((await tx.attempt.count({ where: { taskId: task.id } })) > 0) {
      throw new AppError(409, "HAS_EVIDENCE", "Evidence was added, so the start can't be undone");
    }
    if (now.getTime() - task.startedAt.getTime() > UNDO_START_MS) {
      throw new AppError(409, "UNDO_START_EXPIRED", "More than 24 hours have passed, so the start can't be undone");
    }
    const { count } = await tx.task.updateMany({
      where: { id: task.id, status: "DOING", startedById: member.id },
      data: { status: "TODO", startedAt: null, startedById: null },
    });
    if (count !== 1) throw conflict("This task isn't started by you");
    await recordEvent(tx, { projectId, actorId: member.id, type: "START_UNDONE", payload: { taskId: task.id, title: task.title }, now });
    await bumpPackages(tx, projectId);
  }, TX_OPTIONS);
}

/**
 * 我做完了，请组长看: the owner's DRAFT attempt (≥ 1 evidence) is handed in. Another member's goes PENDING
 * (the leader hears SUBMITTED); the leader's own task is graded PASS at once (合格（组长自评）).
 */
export async function submitAttempt(db: Db, projectId: string, taskId: string, userId: string, now = new Date()): Promise<void> {
  await db.$transaction(async (tx) => {
    const { project, member } = await lockAsMember(tx, projectId, userId);
    const task = await taskUnderLock(tx, projectId, taskId);
    assertOwner(task, member, "Only the task's owner can hand it in");
    if (task.status === "DONE") throw taskDone();
    const open = await openAttempt(tx, task.id);
    if (open?.status === "PENDING") throw alreadyReviewing();
    const evidence = open ? await tx.evidence.findMany({ where: { attemptId: open.id }, select: { kind: true } }) : [];
    if (!open || evidence.length === 0) throw new AppError(409, "NO_EVIDENCE", "Add at least one piece of evidence first");

    await startUnderLock(tx, task, member, now);
    const due = effectiveDue(task, project);
    const late = isLate(now, due);
    const selfGraded = member.role === "LEADER";
    const { count } = await tx.attempt.updateMany({
      where: { id: open.id, status: "DRAFT" },
      data: {
        submittedAt: now,
        submittedById: member.id,
        late,
        ...(selfGraded
          ? { status: "GRADED", grade: "PASS", selfGraded: true, gradedById: member.id, gradedAt: now }
          : { status: "PENDING" }),
      },
    });
    if (count !== 1) throw alreadyReviewing();
    const { after, becameFinished } = await recomputeTask(tx, task.id, now);
    if (becameFinished) await finishedEffects(tx, after, userId, now);

    if (selfGraded) {
      await recordEvent(tx, {
        projectId,
        actorId: member.id,
        type: "GRADED",
        payload: {
          taskId: task.id,
          title: task.title,
          owner: task.owner ? personRef(task.owner) : null,
          grade: "PASS",
          attemptNo: open.no,
          selfGraded: true,
          outsideApp: false,
        },
        now,
      });
    } else {
      const leader = await tx.member.findFirst({ where: { projectId, role: "LEADER" } });
      if (leader && isActiveMember(leader) && leader.id !== member.id) {
        await notify(tx, {
          userIds: [leader.userId],
          projectId,
          type: "SUBMITTED",
          audience: "ONLY_LEADER",
          payload: {
            taskId: task.id,
            title: task.title,
            submitter: personRef(task.owner!),
            attemptNo: open.no,
            evidenceCount: evidence.length,
            allFiles: evidence.every((e) => e.kind === "FILE"),
            dueAt: due.toISOString(),
            late,
          },
          now,
        });
      }
      await recordEvent(tx, { projectId, actorId: member.id, type: "SUBMITTED", payload: { taskId: task.id, title: task.title, attemptNo: open.no }, now });
    }
    await bumpPackages(tx, projectId);
  }, TX_OPTIONS);
}

/**
 * 撤回修改: the owner takes the PENDING attempt back to DRAFT (its evidence stays) to change it. The
 * status goes back to DOING, or HALF / FAIL when an earlier attempt was graded so.
 */
export async function withdrawAttempt(db: Db, projectId: string, taskId: string, userId: string, now = new Date()): Promise<void> {
  await db.$transaction(async (tx) => {
    const { member } = await lockAsMember(tx, projectId, userId);
    const task = await taskUnderLock(tx, projectId, taskId);
    assertOwner(task, member, "Only the task's owner can withdraw it");
    const pending = await tx.attempt.findFirst({ where: { taskId: task.id, status: "PENDING" } });
    if (!pending) throw notReviewing();
    const { count } = await tx.attempt.updateMany({
      where: { id: pending.id, status: "PENDING" },
      data: { status: "DRAFT", submittedAt: null, submittedById: null, late: false },
    });
    if (count !== 1) throw notReviewing();
    await recomputeTask(tx, task.id, now);
    await recordEvent(tx, { projectId, actorId: member.id, type: "WITHDRAWN", payload: { taskId: task.id, title: task.title, attemptNo: pending.no }, now });
    await bumpPackages(tx, projectId);
  }, TX_OPTIONS);
}

/**
 * 我开完了，标记完成: the owner of a MEETING task marks it done (grade SELF, full points). The owner is always
 * among the attendees; the absentees are the members active now who weren't ticked (a snapshot).
 */
export async function meetingDone(
  db: Db,
  projectId: string,
  taskId: string,
  userId: string,
  input: MeetingDoneBody,
  now = new Date(),
): Promise<void> {
  await db.$transaction(async (tx) => {
    const { project, member } = await lockAsMember(tx, projectId, userId);
    const task = await taskUnderLock(tx, projectId, taskId);
    assertOwner(task, member, "Only the task's owner can mark it done");
    if (task.kind !== "MEETING") throw new AppError(409, "NOT_A_MEETING", "Only meeting tasks can be marked done this way");
    if (task.status === "DONE") throw taskDone();
    const open = await openAttempt(tx, task.id);
    if (open?.status === "PENDING") throw alreadyReviewing();
    const summary = input.summary.trim();
    if (!summary) throw new AppError(400, "SUMMARY_REQUIRED", "Write a line about what was discussed and decided");

    const active = await tx.member.findMany({
      where: { projectId, leftAt: null, removed: false },
      orderBy: [{ joinedAt: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    const activeIds = new Set(active.map((m) => m.id));
    const attendeeIds = [...new Set(input.attendeeMemberIds)];
    if (attendeeIds.some((id) => !activeIds.has(id))) {
      throw new AppError(400, "VALIDATION", "Attendees must be active members of this project");
    }
    if (!attendeeIds.includes(member.id)) attendeeIds.push(member.id);
    const absentIds = active.map((m) => m.id).filter((id) => !attendeeIds.includes(id));

    await startUnderLock(tx, task, member, now);
    const data = {
      status: "GRADED" as const,
      grade: "SELF" as const,
      meetingSummary: summary,
      attendeeIds,
      absentIds,
      submittedById: member.id,
      submittedAt: now,
      late: isLate(now, effectiveDue(task, project)),
      gradedById: null,
      gradedAt: now,
    };
    if (open) {
      const { count } = await tx.attempt.updateMany({ where: { id: open.id, status: "DRAFT" }, data });
      if (count !== 1) throw alreadyReviewing();
    } else {
      await tx.attempt.create({ data: { taskId: task.id, no: await nextAttemptNo(tx, task.id), ...data } });
    }
    const { after, becameFinished } = await recomputeTask(tx, task.id, now);
    if (becameFinished) await finishedEffects(tx, after, userId, now);
    await recordEvent(tx, {
      projectId,
      actorId: member.id,
      type: "MEETING_DONE",
      payload: { taskId: task.id, title: task.title, attendeeCount: attendeeIds.length },
      now,
    });
    await bumpPackages(tx, projectId);
  }, TX_OPTIONS);
}
