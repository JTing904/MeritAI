// Leader adds a task to an ACTIVE project (spec §2): into the lightest package, everything else rescaled.
import { apportion } from "../../../shared/planning";
import type { Db } from "../lib/db";
import { AppError } from "../lib/errors";
import { lightestPackage } from "../lib/package-state";
import { bumpPackages, notify, recordEvent } from "./notify";
import { MAX_TASKS, type TaskBody } from "./schemas";
import { resolveDueAt } from "./tasks";
import { lockAsMember, TX_OPTIONS, type Tx } from "./tx";

/** Feature and milestone ids must belong to this project. */
async function assertRefs(tx: Tx, projectId: string, input: Pick<TaskBody, "featureId" | "milestoneId">) {
  if (input.featureId && !(await tx.feature.count({ where: { projectId, id: input.featureId } }))) {
    throw new AppError(400, "VALIDATION", "Unknown feature");
  }
  if (input.milestoneId && !(await tx.milestone.count({ where: { projectId, id: input.milestoneId } }))) {
    throw new AppError(400, "VALIDATION", "Unknown milestone");
  }
}

/**
 * The new task goes into the lightest package with exactly `input.points` (1–999 tenths) and that
 * package's owner; every other task (finished ones and those of people who left too) is rescaled so
 * the total stays exactly 1000.
 */
export async function addActiveTask(db: Db, projectId: string, userId: string, input: TaskBody, now = new Date()): Promise<void> {
  await db.$transaction(async (tx) => {
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

    const scaled = apportion(
      tasks.map((t) => t.points),
      1000 - input.points,
    );
    const byPoints = new Map<number, string[]>();
    tasks.forEach((t, i) => {
      if (scaled[i] === t.points) return;
      byPoints.set(scaled[i]!, [...(byPoints.get(scaled[i]!) ?? []), t.id]);
    });
    for (const [points, ids] of byPoints) {
      await tx.task.updateMany({ where: { id: { in: ids } }, data: { points } });
    }

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
  }, TX_OPTIONS);
}
