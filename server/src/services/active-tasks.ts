// Tasks of an ACTIVE project: the leader adds one (M3 spec §2: into the lightest package, everything else
// rescaled) or edits one (M4 spec §2; the owner may change the description only).
import { apportion } from "../../../shared/planning";
import type { Db } from "../lib/db";
import { AppError, forbidden, notFound } from "../lib/errors";
import { isLocked, lightestPackage } from "../lib/package-state";
import { bumpPackages, notify, recordEvent } from "./notify";
import { MAX_TASKS, type ActiveTaskPatchBody, type TaskBody } from "./schemas";
import { resolveDueAt } from "./tasks";
import { assertPointsTotal, lockAsMember, TOTAL_POINTS, touchProject, TX_OPTIONS, type Tx } from "./tx";
import { clock } from "../lib/clock";
import { kickAiJobs } from "./ai-job-store";
import { maybeEnqueueHowto } from "./ai-howto";

/** Feature and milestone ids must belong to this project. */
async function assertRefs(tx: Tx, projectId: string, input: Pick<TaskBody, "featureId" | "milestoneId">) {
  if (input.featureId && !(await tx.feature.count({ where: { projectId, id: input.featureId } }))) {
    throw new AppError(400, "VALIDATION", "Unknown feature");
  }
  if (input.milestoneId && !(await tx.milestone.count({ where: { projectId, id: input.milestoneId } }))) {
    throw new AppError(400, "VALIDATION", "Unknown milestone");
  }
}

/** Rescales `tasks` to `total` tenths in proportion (one updateMany per new value); returns the new points. */
async function rescale(tx: Tx, tasks: { id: string; points: number }[], total: number): Promise<number[]> {
  const scaled = apportion(
    tasks.map((t) => t.points),
    total,
  );
  const byPoints = new Map<number, string[]>();
  tasks.forEach((t, i) => {
    if (scaled[i] === t.points) return;
    byPoints.set(scaled[i]!, [...(byPoints.get(scaled[i]!) ?? []), t.id]);
  });
  for (const [points, ids] of byPoints) {
    await tx.task.updateMany({ where: { id: { in: ids } }, data: { points } });
  }
  return scaled;
}

/**
 * The new task goes into the lightest package with exactly `input.points` (1–999 tenths) and that
 * package's owner; every other task (finished ones and those of people who left too) is rescaled so
 * the total stays exactly 1000.
 */
export async function addActiveTask(db: Db, projectId: string, userId: string, input: TaskBody, now = clock.now()): Promise<void> {
  const howto = await db.$transaction(async (tx) => {
    const { project, member: leader } = await lockAsMember(tx, projectId, userId, { leader: true });
    if (!Number.isInteger(input.points) || input.points < 1 || input.points > 999) {
      throw new AppError(400, "VALIDATION", "Points must be between 0.1 and 99.9");
    }
    await assertRefs(tx, projectId, input);
    // The leader typed this date, so a later deadline change gives it back (leaderDueAt).
    const dueAt = input.dueAt ? resolveDueAt(input.dueAt, project) : null;

    const tasks = await tx.task.findMany({ where: { projectId }, orderBy: [{ order: "asc" }, { number: "asc" }] });
    if (tasks.length >= MAX_TASKS) throw new AppError(400, "VALIDATION", `A project can have at most ${MAX_TASKS} tasks`);
    const packages = await tx.package.findMany({
      where: { projectId },
      orderBy: { index: "asc" },
      include: { owner: { select: { id: true, userId: true } } },
    });
    const target = lightestPackage(packages, tasks);
    if (!target) throw new AppError(409, "CONFLICT", "The project has no packages");

    const scaled = await rescale(tx, tasks, TOTAL_POINTS - input.points);

    const created = await tx.task.create({
      data: {
        projectId,
        number: Math.max(0, ...tasks.map((t) => t.number)) + 1,
        order: Math.max(-1, ...tasks.map((t) => t.order)) + 1,
        title: input.title,
        kind: input.kind,
        points: input.points,
        dueAt,
        leaderDueAt: dueAt,
        description: input.description ?? null,
        featureId: input.featureId ?? null,
        milestoneId: input.milestoneId ?? null,
        packageId: target.id,
        ownerId: target.ownerId,
      },
    });

    if (target.owner && target.owner.id !== leader.id) {
      const packagePoints = input.points + tasks.reduce((s, t, i) => (t.packageId === target.id ? s + scaled[i]! : s), 0);
      await notify(tx, {
        userIds: [target.owner.userId],
        projectId,
        type: "TASK_ADDED",
        audience: "ONLY_YOU",
        payload: { taskId: created.id, title: created.title, packageIndex: target.index, packagePoints },
        now,
      });
    }
    await recordEvent(tx, {
      projectId,
      actorId: leader.id,
      type: "TASK_ADDED",
      payload: { taskId: created.id, title: created.title, packageIndex: target.index },
      now,
    });
    await bumpPackages(tx, projectId);
    await assertPointsTotal(tx, projectId);
    // M6: with the leader's key, the AI writes its 怎么做 and checklist (light model).
    return maybeEnqueueHowto(tx, projectId, created.id, now);
  }, TX_OPTIONS);
  if (howto) kickAiJobs(db);
}

/**
 * PATCH /api/projects/:id/tasks/:taskId of an ACTIVE project (M4 spec §2). The leader may change title,
 * kind (TASK_LOCKED once an attempt is graded or holds evidence; an empty draft attempt is deleted
 * instead), description, featureId, milestoneId, dueAt (sets leaderDueAt; null clears both) and points
 * (unlocked tasks only; every other task rescales so the total stays 1000). The owner may change
 * `description` only (any other key → 403).
 */
export async function updateActiveTask(
  db: Db,
  projectId: string,
  taskId: string,
  userId: string,
  input: ActiveTaskPatchBody,
  _now = clock.now(),
): Promise<void> {
  await db.$transaction(async (tx) => {
    const { project, member } = await lockAsMember(tx, projectId, userId);
    const task = await tx.task.findFirst({ where: { id: taskId, projectId } });
    if (!task) throw notFound("Task");
    const keys = Object.entries(input)
      .filter(([, v]) => v !== undefined)
      .map(([k]) => k);
    if (member.role !== "LEADER") {
      if (task.ownerId !== member.id) throw forbidden("Only the leader or the task's owner can edit it");
      if (keys.some((k) => k !== "description")) throw forbidden("The owner can only change the description");
    }
    if (keys.length === 0) return;

    if (input.kind !== undefined && input.kind !== task.kind) {
      const attempts = await tx.attempt.findMany({
        where: { taskId },
        select: { id: true, status: true, _count: { select: { evidence: true } } },
      });
      if (attempts.some((a) => a.status !== "DRAFT" || a._count.evidence > 0)) {
        throw new AppError(409, "TASK_LOCKED", "Evidence was handed in for this task, so its kind can't change");
      }
      // An empty draft attempt holds nothing; it would otherwise outlive the kind it was opened for.
      if (attempts.length > 0) await tx.attempt.deleteMany({ where: { id: { in: attempts.map((a) => a.id) } } });
    }

    const points = input.points !== undefined && input.points !== task.points ? input.points : null;
    if (points !== null && isLocked(task)) throw new AppError(409, "TASK_LOCKED", "This task has already started");
    await assertRefs(tx, projectId, input);
    // Setting a date makes it the leader's; clearing it clears both.
    const dueAt = input.dueAt === undefined ? undefined : input.dueAt === null ? null : resolveDueAt(input.dueAt, project);

    if (points !== null) {
      const others = await tx.task.findMany({
        where: { projectId, id: { not: task.id } },
        orderBy: [{ order: "asc" }, { number: "asc" }],
        select: { id: true, points: true },
      });
      // Nothing else could take up the difference: the only task is always worth all 100 分.
      if (others.length === 0) {
        throw new AppError(409, "ONLY_TASK_POINTS", "The project's only task is worth all 100 points");
      }
      await rescale(tx, others, TOTAL_POINTS - points);
    }
    await tx.task.update({
      where: { id: task.id },
      data: {
        title: input.title,
        kind: input.kind,
        points: input.points,
        dueAt,
        leaderDueAt: dueAt,
        description: input.description,
        featureId: input.featureId,
        milestoneId: input.milestoneId,
      },
    });
    await touchProject(tx, projectId);
    // Points and due dates change the package rows (totals, overdue).
    if (points !== null || dueAt !== undefined) await bumpPackages(tx, projectId);
    if (points !== null) await assertPointsTotal(tx, projectId);
  }, TX_OPTIONS);
}
