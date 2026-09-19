// Attempt / evidence / grade-change rows written straight through Prisma, for the srv-tasks tests (task
// views, prerequisites, my tasks): they check what the reads make of these rows, not how the evidence
// and grading services write them.
import type { AttemptStatus, Grade } from "../src/generated/prisma/client";
import { finishedEffects, recomputeTask, type Recomputed } from "../src/lib/grading";
import { newFileId } from "../src/lib/storage";
import { TX_OPTIONS } from "../src/services/tx";
import { testDb } from "./helpers";

export type AttemptRow = {
  no: number;
  status: AttemptStatus;
  grade?: Grade | null;
  gradeNote?: string | null;
  late?: boolean;
  submittedAt?: Date | null;
  submittedById?: string | null;
  gradedAt?: Date | null;
  gradedById?: string | null;
  selfGraded?: boolean;
  outsideApp?: boolean;
  outsideNote?: string | null;
  meetingSummary?: string | null;
  attendeeIds?: string[];
  absentIds?: string[];
  /** Link evidence rows to add (count). */
  links?: number;
  /** File evidence rows to add, one per size in bytes. */
  files?: number[];
  createdAt?: Date;
};

/** Creates one attempt of `taskId` (with its evidence rows). Does not recompute the task. */
export async function addAttempt(taskId: string, row: AttemptRow) {
  const task = await testDb.task.findUniqueOrThrow({ where: { id: taskId } });
  const { links = 0, files = [], ...data } = row;
  const graded = data.status === "GRADED";
  const attempt = await testDb.attempt.create({
    data: {
      taskId,
      submittedAt: data.status === "DRAFT" ? null : new Date(),
      submittedById: data.status === "DRAFT" ? null : task.ownerId,
      gradedAt: graded ? new Date() : null,
      ...data,
    },
  });
  for (let i = 0; i < links; i++) {
    await testDb.evidence.create({
      data: {
        attemptId: attempt.id,
        taskId,
        kind: "LINK",
        name: `example.com/${attempt.no}/${i}`,
        url: `https://example.com/${attempt.no}/${i}`,
        addedById: task.ownerId,
      },
    });
  }
  for (const [i, sizeBytes] of files.entries()) {
    await testDb.evidence.create({
      data: {
        attemptId: attempt.id,
        taskId,
        kind: "FILE",
        name: `报告-${attempt.no}-${i}.pdf`,
        storageKey: `${task.projectId.toLowerCase()}/${taskId.toLowerCase()}/${newFileId()}.pdf`,
        sizeBytes,
        mimeType: "application/pdf",
        addedById: task.ownerId,
      },
    });
  }
  return attempt;
}

/**
 * Re-derives the task from its attempt rows (recomputeTask), then the finished-now effects when it just
 * became finished and `actorUserId` is given (void swaps, PREREQ_DONE), as a grade-type write would.
 */
export async function recompute(taskId: string, actorUserId?: string, now = new Date()): Promise<Recomputed> {
  return testDb.$transaction(async (tx) => {
    const result = await recomputeTask(tx, taskId, now);
    if (result.becameFinished && actorUserId) await finishedEffects(tx, result.after, actorUserId, now);
    return result;
  }, TX_OPTIONS);
}

/** A graded attempt `no` of the task (grade by `gradedById`), then recompute (+ finished effects for `actorUserId`). */
export async function gradedAttempt(
  taskId: string,
  no: number,
  grade: Grade,
  opts: Partial<AttemptRow> & { actorUserId?: string; now?: Date } = {},
) {
  const { actorUserId, now, ...row } = opts;
  const attempt = await addAttempt(taskId, { no, status: "GRADED", grade, links: 1, ...row });
  const result = await recompute(taskId, actorUserId, now);
  return { attempt, ...result };
}
