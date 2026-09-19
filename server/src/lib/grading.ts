// Grades, attempts and what they make of a task (M4 spec §2): shared by every grade-type write.
import type { Attempt, Grade, GradeChange, Task, TaskStatus } from "../generated/prisma/client";
import { MAX_EVIDENCE_FILE_BYTES, MAX_EVIDENCE_ITEMS, MAX_PROJECT_STORAGE_BYTES } from "../../../shared/constants";
import { voidSwaps } from "../services/notify";
import { notifyPrereqDone } from "../services/prereq";
import type { Tx } from "../services/tx";
import { isActiveMember } from "./access";
import { earnedFor, effectiveDue, FULL_GRADES, isFinished, isFullGrade, releaseTaskData } from "./package-state";

// The pure grade rules live in package-state.ts (isFinished needs them); grading code imports them from here.
export { earnedFor, effectiveDue, FULL_GRADES, isFullGrade };

export const GRADES: readonly Grade[] = ["EXCELLENT", "PASS", "HALF", "FAIL", "SELF"];

/** 「开始做」 can be undone this long after it was pressed (and only while the task has no attempt). */
export const UNDO_START_MS = 24 * 60 * 60 * 1000;
export { MAX_EVIDENCE_FILE_BYTES, MAX_EVIDENCE_ITEMS, MAX_PROJECT_STORAGE_BYTES };
/** Longest evidence link (characters). */
export const MAX_LINK_CHARS = 2000;

/** "The better one": full (2) > HALF (1) > FAIL (0). */
export function gradeRank(grade: Grade): number {
  if (isFullGrade(grade)) return 2;
  return grade === "HALF" ? 1 : 0;
}

/** The best of these grades (nulls skipped); on equal rank the later one in the list. Null when there is none. */
export function bestGrade(grades: (Grade | null)[]): Grade | null {
  let best: Grade | null = null;
  for (const g of grades) {
    if (g !== null && (best === null || gradeRank(g) >= gradeRank(best))) best = g;
  }
  return best;
}

/**
 * The attempt whose grade the task earns: among the GRADED attempts, the best current grade (after
 * overrides); on a tie the latest (highest `no`). Null without a graded attempt.
 */
export function countingAttempt<A extends Pick<Attempt, "no" | "status" | "grade">>(attempts: A[]): A | null {
  let best: A | null = null;
  for (const a of attempts) {
    if (a.status !== "GRADED" || a.grade === null) continue;
    if (best === null) {
      best = a;
      continue;
    }
    const diff = gradeRank(a.grade) - gradeRank(best.grade!);
    if (diff > 0 || (diff === 0 && a.no > best.no)) best = a;
  }
  return best;
}

/**
 * The derived task status: a PENDING attempt → REVIEWING; else by the counting grade (full → DONE,
 * HALF → HALF, FAIL → FAIL); else started → DOING; otherwise TODO.
 */
export function statusFor(input: { hasPending: boolean; grade: Grade | null; startedAt: Date | null }): TaskStatus {
  if (input.hasPending) return "REVIEWING";
  if (input.grade !== null) {
    if (isFullGrade(input.grade)) return "DONE";
    return input.grade === "HALF" ? "HALF" : "FAIL";
  }
  return input.startedAt !== null ? "DOING" : "TODO";
}

/** Handed in after the effective due (迟交). */
export const isLate = (submittedAt: Date, due: Date): boolean => submittedAt > due;

/**
 * When the counting grade was earned: the live override that produced it (`liveChange`, the attempt's
 * latest GradeChange that isn't undone) or else the attempt's gradedAt.
 */
export function finishedAtFor(
  attempt: Pick<Attempt, "gradedAt">,
  liveChange: Pick<GradeChange, "createdAt"> | null,
): Date | null {
  return liveChange?.createdAt ?? attempt.gradedAt;
}

export type Recomputed = { before: Task; after: Task; becameFinished: boolean };

/**
 * Re-derives the task's `grade`, `status` and `finishedAt` from its attempts (and their live overrides)
 * after a grade, override, undo, meeting-done or grade-outside. `becameFinished`: it was not finished
 * before and is now (the finished-now effects are the caller's: finishedEffects).
 */
export async function recomputeTask(tx: Tx, taskId: string, _now: Date): Promise<Recomputed> {
  const before = await tx.task.findUniqueOrThrow({ where: { id: taskId } });
  const attempts = await tx.attempt.findMany({
    where: { taskId },
    orderBy: { no: "asc" },
    include: { changes: { where: { undoneAt: null }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1 } },
  });
  const counting = countingAttempt(attempts);
  const grade = counting?.grade ?? null;
  const status = statusFor({ hasPending: attempts.some((a) => a.status === "PENDING"), grade, startedAt: before.startedAt });
  const finished = isFinished({ status, grade });
  const finishedAt = finished && counting ? finishedAtFor(counting, counting.changes[0] ?? null) : null;
  const after = await tx.task.update({ where: { id: taskId }, data: { grade, status, finishedAt } });
  return { before, after, becameFinished: !isFinished(before) && isFinished(after) };
}

/**
 * What finishing a task does besides its points (call it when recomputeTask says `becameFinished`):
 * the owner's package counts as started, so their pending swaps end (reason STARTED, as with 开始做),
 * and every task that waited for this one hears PREREQ_DONE (never the actor).
 */
export async function finishedEffects(
  tx: Tx,
  task: Pick<Task, "id" | "projectId" | "ownerId">,
  actorUserId: string,
  now: Date,
): Promise<void> {
  if (task.ownerId !== null) {
    await voidSwaps(tx, {
      projectId: task.projectId,
      memberIds: [task.ownerId],
      reason: "STARTED",
      voidedById: task.ownerId,
      now,
      notify: true,
    });
  }
  await notifyPrereqDone(tx, task.id, actorUserId, now);
}

/**
 * After a grade-type write: a task whose owner left (or was removed) and that is not finished (FAIL, or
 * no grade) is released, so the leader can move it (REQUIREMENTS §13: 没做完的任务变成没人负责). A
 * finished task stays credited to the leaver. Re-reads the task; returns whether it was released.
 */
export async function releaseIfOwnerInactive(tx: Tx, task: Pick<Task, "id">): Promise<boolean> {
  const row = await tx.task.findUniqueOrThrow({ where: { id: task.id }, include: { owner: true } });
  if (row.owner === null || isActiveMember(row.owner) || isFinished(row)) return false;
  await tx.task.update({ where: { id: row.id }, data: releaseTaskData(row) });
  return true;
}

