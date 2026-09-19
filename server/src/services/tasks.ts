// Leader edits of a draft's tasks (wizard steps 2 and 5). Adding to an active project is services/active-tasks.ts.
import type { Locale } from "../../../shared/constants";
import { packageCount } from "../../../shared/planning";
import type { Project, Task } from "../generated/prisma/client";
import type { Db } from "../lib/db";
import { AppError, notFound } from "../lib/errors";
import { isLocked } from "../lib/package-state";
import { DATE_ONLY, localDate, toInstant } from "../lib/plan/dates";
import { planSplit, splitRows } from "../lib/plan/split";
import { MAX_TASKS, type TaskBody, type TaskPatchBody } from "./schemas";
import { lockDraft, touchProject, TX_OPTIONS, type Tx } from "./tx";

/**
 * A task's due date as an instant. Date-only means 23:59 that day in the project's time zone; on the
 * deadline's own date it means the deadline itself (so "due on the last day" is always allowed).
 */
export function resolveDueAt(input: string, project: Pick<Project, "deadline" | "timezone">): Date {
  let due = toInstant(input, project.timezone);
  if (DATE_ONLY.test(input) && due > project.deadline && input === localDate(project.deadline, project.timezone)) {
    due = project.deadline;
  }
  if (due > project.deadline) {
    throw new AppError(400, "DUE_AFTER_DEADLINE", "A task can't be due after the project deadline");
  }
  return due;
}

/** Feature and milestone ids must belong to this project. */
async function assertRefs(tx: Tx, projectId: string, inputs: Pick<TaskPatchBody, "featureId" | "milestoneId">[]) {
  const featureIds = new Set(inputs.map((t) => t.featureId).filter((id): id is string => !!id));
  const milestoneIds = new Set(inputs.map((t) => t.milestoneId).filter((id): id is string => !!id));
  if (featureIds.size > 0) {
    const found = await tx.feature.count({ where: { projectId, id: { in: [...featureIds] } } });
    if (found !== featureIds.size) throw new AppError(400, "VALIDATION", "Unknown feature");
  }
  if (milestoneIds.size > 0) {
    const found = await tx.milestone.count({ where: { projectId, id: { in: [...milestoneIds] } } });
    if (found !== milestoneIds.size) throw new AppError(400, "VALIDATION", "Unknown milestone");
  }
}

/** Started work keeps its points: it can't be deleted or re-pointed (REQUIREMENTS §13). */
function assertUnlocked(task: Task) {
  if (isLocked(task)) {
    throw new AppError(409, "TASK_LOCKED", "This task has already started");
  }
}

/** A due date the leader typed is theirs (leaderDueAt): a later deadline change gives it back. */
function taskData(input: TaskBody, project: Project) {
  const dueAt = input.dueAt ? resolveDueAt(input.dueAt, project) : null;
  return {
    title: input.title,
    kind: input.kind,
    points: input.points,
    dueAt,
    leaderDueAt: dueAt,
    description: input.description ?? null,
    featureId: input.featureId ?? null,
    milestoneId: input.milestoneId ?? null,
  };
}

/** Manual mode: replaces every task of the draft. */
export async function replaceTasks(db: Db, projectId: string, inputs: TaskBody[]): Promise<void> {
  await db.$transaction(async (tx) => {
    const project = await lockDraft(tx, projectId);
    await assertRefs(tx, projectId, inputs);
    const rows = inputs.map((input, i) => ({ ...taskData(input, project), projectId, number: i + 1, order: i }));
    await tx.task.deleteMany({ where: { projectId } });
    if (rows.length > 0) await tx.task.createMany({ data: rows });
    await tx.project.update({
      where: { id: projectId },
      data: { planSource: "MANUAL", draftStep: Math.max(project.draftStep, 5) },
    });
  }, TX_OPTIONS);
}

export async function addTask(db: Db, projectId: string, input: TaskBody): Promise<void> {
  await db.$transaction(async (tx) => {
    const project = await lockDraft(tx, projectId);
    await assertRefs(tx, projectId, [input]);
    const agg = await tx.task.aggregate({ where: { projectId }, _max: { number: true, order: true }, _count: true });
    if (agg._count >= MAX_TASKS) throw new AppError(400, "VALIDATION", `A plan can have at most ${MAX_TASKS} tasks`);
    await tx.task.create({
      data: {
        ...taskData(input, project),
        projectId,
        number: (agg._max.number ?? 0) + 1,
        order: (agg._max.order ?? -1) + 1,
      },
    });
    await tx.project.update({
      where: { id: projectId },
      data: { planSource: project.planSource ?? "MANUAL", updatedAt: new Date() },
    });
  }, TX_OPTIONS);
}

export async function updateTask(db: Db, projectId: string, taskId: string, input: TaskPatchBody): Promise<void> {
  await db.$transaction(async (tx) => {
    const project = await lockDraft(tx, projectId);
    const task = await tx.task.findFirst({ where: { id: taskId, projectId } });
    if (!task) throw notFound("Task");
    if (input.points !== undefined && input.points !== task.points) assertUnlocked(task);
    await assertRefs(tx, projectId, [input]);
    // Setting a date makes it the leader's; clearing it clears both.
    const dueAt = input.dueAt === undefined ? undefined : input.dueAt === null ? null : resolveDueAt(input.dueAt, project);
    await tx.task.update({
      where: { id: taskId },
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
  }, TX_OPTIONS);
}

/**
 * 「把太大的任务拆开」 (step 5, when the packages would come out uneven): splits the biggest tasks into
 * equal parts that take the original's place in the plan and copy its kind, feature, milestone, due
 * dates (the leader's own too), description and brief excerpt (every part is marked briefSplit, for
 * 「这一项拆成了 N 个任务」). Part labels are in `locale`, the language the leader
 * reads now. Does nothing when the packages are already even or nothing can be split further; the app
 * tells these apart by the task count.
 */
export async function splitLargeTasks(db: Db, projectId: string, locale: Locale): Promise<void> {
  await db.$transaction(async (tx) => {
    const project = await lockDraft(tx, projectId);
    // The parts copy the quoted brief lines, which queries leave out unless asked (lib/db.ts OMIT).
    const tasks = await tx.task.findMany({
      where: { projectId },
      orderBy: [{ order: "asc" }, { number: "asc" }],
      omit: { briefExcerpt: false },
    });
    const parts = planSplit(
      tasks.map((t) => ({ points: t.points, group: t.featureId, splittable: !isLocked(t) })),
      packageCount(project.teamSize, project.leaderManages),
    );
    if (parts.every((k) => k === 1)) return;

    const rows = splitRows(tasks, parts, locale);
    // Numbers follow the new plan order; move them out of the way first ((projectId, number) is unique).
    await tx.task.updateMany({ where: { projectId }, data: { number: { increment: 1_000_000 } } });
    const created = [];
    for (const [i, row] of rows.entries()) {
      const source = tasks[row.source]!;
      const estimateHours = source.estimateHours === null ? null : source.estimateHours / row.parts;
      const briefSplit = row.parts > 1 || source.briefSplit;
      if (row.first) {
        await tx.task.update({
          where: { id: source.id },
          data: { title: row.title, points: row.points, number: i + 1, order: i, estimateHours, briefSplit },
        });
        continue;
      }
      created.push({
        projectId,
        number: i + 1,
        order: i,
        title: row.title,
        points: row.points,
        kind: source.kind,
        description: source.description,
        dueAt: source.dueAt,
        suggestedDueAt: source.suggestedDueAt,
        leaderDueAt: source.leaderDueAt,
        estimateHours,
        featureId: source.featureId,
        milestoneId: source.milestoneId,
        briefExcerpt: source.briefExcerpt,
        briefFrom: source.briefFrom,
        briefTo: source.briefTo,
        briefSplit,
      });
    }
    await tx.task.createMany({ data: created });
    await touchProject(tx, projectId);
  }, TX_OPTIONS);
}

export async function deleteTask(db: Db, projectId: string, taskId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    await lockDraft(tx, projectId);
    const task = await tx.task.findFirst({ where: { id: taskId, projectId } });
    if (!task) throw notFound("Task");
    assertUnlocked(task);
    await tx.task.delete({ where: { id: taskId } });
    await touchProject(tx, projectId);
  }, TX_OPTIONS);
}
