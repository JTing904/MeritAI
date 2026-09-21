// Development only (POST /api/dev/tasks/:taskId/status): set a task's status by hand to test starting and
// scoring. It goes through the real services (M4 spec §12), so the task gets the same attempts, grades,
// feed events and notifications as when people use the app: grading is done as the project's leader.
import type { Grade } from "../generated/prisma/client";
import type { Db } from "../lib/db";
import { AppError, notFound } from "../lib/errors";
import { countingAttempt, recomputeTask } from "../lib/grading";
import { getStorage } from "../lib/storage";
import { gradeAttempt, gradeOutside, overrideGrade } from "./grading-service";
import { bumpPackages } from "./notify";
import { startUnderLock } from "./packages";
import type { DevTaskStatus } from "./schemas";
import { lockAsMember, TX_OPTIONS } from "./tx";
import { clock } from "../lib/clock";

/** What the tool writes as the leader's 理由 / 评语. */
const DEV_NOTE = "开发测试";

const conflict = (message: string) => new AppError(409, "CONFLICT", message);

/**
 * An active member of the task's project (404 otherwise) sets a status on a task that has an owner and
 * a package. Each call bumps the packages version exactly once.
 * - TODO: removes every attempt (with its evidence; files after commit), the grade and the start.
 * - DOING: starts the task as its OWNER (never re-attributing someone else's start); refused once the
 *   task has attempts (TODO first).
 * - DONE / HALF (grade PASS / HALF), as the leader: grades the waiting submission; else overrides the
 *   counting grade (nothing but the bump when it already is that grade); else 组长代为完成.
 */
export async function setDevTaskStatus(
  db: Db,
  taskId: string,
  userId: string,
  status: DevTaskStatus,
  now = clock.now(),
): Promise<void> {
  const found = await db.task.findUnique({ where: { id: taskId }, select: { projectId: true } });
  if (!found) throw notFound("Task");
  const projectId = found.projectId;

  // Who may use it, and on which task (read only: the writes below take the lock again).
  const leaderUserId = await db.$transaction(async (tx) => {
    await lockAsMember(tx, projectId, userId);
    const task = await tx.task.findUnique({ where: { id: taskId } });
    if (!task) throw notFound("Task");
    if (task.ownerId === null || task.packageId === null) {
      throw conflict("Only a task with an owner and a package can change status here");
    }
    const leader = await tx.member.findFirst({ where: { projectId, role: "LEADER" }, select: { userId: true } });
    if (!leader) throw conflict("The project has no leader");
    return leader.userId;
  }, TX_OPTIONS);

  if (status === "TODO") {
    const storageKeys = await db.$transaction(async (tx) => {
      await lockAsMember(tx, projectId, userId);
      const files = await tx.evidence.findMany({ where: { taskId, storageKey: { not: null } }, select: { storageKey: true } });
      await tx.attempt.deleteMany({ where: { taskId } });
      await tx.task.update({
        where: { id: taskId },
        data: { status: "TODO", grade: null, finishedAt: null, startedAt: null, startedById: null },
      });
      await bumpPackages(tx, projectId);
      return files.map((f) => f.storageKey!);
    }, TX_OPTIONS);
    // Best effort: an orphaned file is swept later (M5).
    for (const key of storageKeys) {
      await getStorage()
        .delete(key)
        .catch((err) => console.error("dev status: could not delete an evidence file", err));
    }
    return;
  }

  if (status === "DOING") {
    await db.$transaction(async (tx) => {
      await lockAsMember(tx, projectId, userId);
      const task = await tx.task.findUniqueOrThrow({ where: { id: taskId }, include: { owner: true } });
      if ((await tx.attempt.count({ where: { taskId } })) > 0) {
        throw conflict("This task has attempts; set it to TODO first");
      }
      if (task.owner === null) throw conflict("Only a task with an owner can change status here");
      await startUnderLock(tx, task, task.owner, now, { allowReattribute: false });
      // No attempts: the derived status is DOING (and a grade written by hand, in tests, goes away).
      await recomputeTask(tx, taskId, now);
      await bumpPackages(tx, projectId);
    }, TX_OPTIONS);
    return;
  }

  const grade: Exclude<Grade, "SELF"> = status === "DONE" ? "PASS" : "HALF";
  const attempts = await db.attempt.findMany({ where: { taskId }, select: { id: true, no: true, status: true, grade: true } });
  if (attempts.some((a) => a.status === "PENDING")) {
    await gradeAttempt(db, projectId, taskId, leaderUserId, { grade, note: DEV_NOTE, devTool: true }, now);
    return;
  }
  const counting = countingAttempt(attempts);
  if (counting === null) {
    await gradeOutside(db, projectId, taskId, leaderUserId, { grade, note: DEV_NOTE, outsideNote: null, devTool: true }, now);
  } else if (counting.grade !== grade) {
    await overrideGrade(db, projectId, taskId, leaderUserId, { grade, reason: DEV_NOTE, devTool: true }, now);
  } else {
    await db.$transaction(async (tx) => {
      await lockAsMember(tx, projectId, userId);
      await bumpPackages(tx, projectId);
    }, TX_OPTIONS);
  }
}
