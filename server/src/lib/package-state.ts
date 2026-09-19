// The package and task rules in one place (M3 spec §2, amended by M4 §2), as pure functions over database rows.
import type { Grade, Member, Package, Prisma, Project, Task, TaskStatus } from "../generated/prisma/client";
import { isActiveMember } from "./access";

/** Statuses that are finished on their own (a DONE or HALF task). M4 also counts the task's `grade`: see isFinished. */
export const FINISHED_STATUSES: readonly TaskStatus[] = ["DONE", "HALF"];

/** Grades that earn the task's points (SELF: a meeting its owner marked done). */
export const FULL_GRADES: readonly Grade[] = ["EXCELLENT", "PASS", "SELF"];
/** Grades that make a task finished: full, or half (拿一半算完成; it may be resubmitted for full points). */
const FINISHED_GRADES: Grade[] = ["EXCELLENT", "PASS", "SELF", "HALF"];

export const isFullGrade = (grade: Grade | null): boolean => grade !== null && FULL_GRADES.includes(grade);

/** Tenths a task earns with this grade: full → all, HALF → half (rounded), FAIL or none → 0. */
export function earnedFor(points: number, grade: Grade | null): number {
  if (isFullGrade(grade)) return points;
  if (grade === "HALF") return Math.round(points / 2);
  return 0;
}

/**
 * Finished work: its points are earned and it never changes hands. Grade-based since M4: a HALF task
 * that was resubmitted shows REVIEWING but keeps its HALF grade, so it stays finished.
 */
export const isFinished = (task: Pick<Task, "status" | "grade">): boolean =>
  FINISHED_STATUSES.includes(task.status) || (task.grade !== null && task.grade !== "FAIL");

/** Prisma filter for finished tasks (isFinished). Combine with other conditions through AND. */
export const FINISHED_WHERE = {
  OR: [{ status: { in: [...FINISHED_STATUSES] } }, { grade: { in: FINISHED_GRADES } }],
} satisfies Prisma.TaskWhereInput;

/** Prisma filter for unfinished tasks (not isFinished). Combine with other conditions through AND. */
export const UNFINISHED_WHERE = {
  status: { notIn: [...FINISHED_STATUSES] },
  OR: [{ grade: null }, { grade: "FAIL" }],
} satisfies Prisma.TaskWhereInput;

/** Started or past TODO: can't be deleted, re-pointed by hand, or moved by a re-split. */
export const isLocked = (task: Pick<Task, "status" | "startedAt">): boolean =>
  task.status !== "TODO" || task.startedAt !== null;

/**
 * A package is started (开工, REQUIREMENTS §13) when its owner started one of its tasks, or holds a
 * finished one: finishing counts as starting, whoever pressed 「开始做」. Holding an unfinished task
 * someone else started (moved in, or left in a free package) doesn't count.
 */
export function packageStarted(
  pkg: Pick<Package, "id" | "ownerId">,
  tasks: Pick<Task, "packageId" | "ownerId" | "status" | "grade" | "startedAt" | "startedById">[],
): boolean {
  if (pkg.ownerId === null) return false;
  return tasks.some((t) => {
    if (t.packageId !== pkg.id) return false;
    return (t.startedById === pkg.ownerId && isLocked(t)) || (t.ownerId === pkg.ownerId && isFinished(t));
  });
}

/** An active member with no package, except a leader who only manages. */
export function needsPackage(
  member: Pick<Member, "role" | "leftAt" | "removed">,
  project: Pick<Project, "leaderManages">,
  ownsPackage: boolean,
): boolean {
  if (!isActiveMember(member) || ownsPackage) return false;
  return !(member.role === "LEADER" && project.leaderManages);
}

/** Tenths earned, from the task's (counting) grade. */
export function earnedPoints(task: Pick<Task, "points" | "grade">): number {
  return earnedFor(task.points, task.grade);
}

/** The package with the smallest total points (lowest index on a tie); null without packages. */
export function lightestPackage<P extends Pick<Package, "id" | "index">>(
  packages: P[],
  tasks: Pick<Task, "packageId" | "points">[],
): P | null {
  const totals = new Map<string, number>();
  for (const t of tasks) {
    if (t.packageId !== null) totals.set(t.packageId, (totals.get(t.packageId) ?? 0) + t.points);
  }
  let best: P | null = null;
  for (const pkg of packages) {
    if (best === null) {
      best = pkg;
      continue;
    }
    const diff = (totals.get(pkg.id) ?? 0) - (totals.get(best.id) ?? 0);
    if (diff < 0 || (diff === 0 && pkg.index < best.index)) best = pkg;
  }
  return best;
}

/** When the task is due: its own date, else the project deadline. */
export function effectiveDue(task: Pick<Task, "dueAt">, project: Pick<Project, "deadline">): Date {
  return task.dueAt ?? project.deadline;
}

/**
 * Not finished, not waiting for the leader's review (「等组长审核」 isn't on the 过期名单), and past its
 * effective due.
 */
export function isOverdue(
  task: Pick<Task, "status" | "grade" | "dueAt">,
  project: Pick<Project, "deadline">,
  now: Date,
): boolean {
  return !isFinished(task) && task.status !== "REVIEWING" && effectiveDue(task, project) < now;
}

/** What resplitRange needs; the re-split planner's state has at least this. */
export type ResplitRangeState = {
  project: Pick<Project, "leaderManages">;
  /** Every member row of the project (inactive ones are skipped). */
  members: Pick<Member, "role" | "leftAt" | "removed">[];
  packages: Pick<Package, "id" | "ownerId">[];
  tasks: Pick<Task, "packageId" | "status" | "startedAt">[];
};

/**
 * Package counts a re-split accepts: at least one per member who should hold a package (all active
 * members, minus the leader when they only manage) and every package that must stay (it has an owner
 * or holds a locked task); at most 8 (7 when the leader only manages).
 */
export function resplitRange(state: ResplitRangeState): { min: number; max: number } {
  const { leaderManages } = state.project;
  const holders = state.members.filter((m) => isActiveMember(m) && !(leaderManages && m.role === "LEADER")).length;
  const mustKeep = state.packages.filter(
    (p) => p.ownerId !== null || state.tasks.some((t) => t.packageId === p.id && isLocked(t)),
  ).length;
  return { min: Math.max(1, holders, mustKeep), max: leaderManages ? 7 : 8 };
}

/**
 * Update data that releases a task: nobody owns it and it is no longer started. DOING goes back to
 * TODO; REVIEWING and FAIL keep their status. Works with update and updateMany, so a bulk release runs
 * one updateMany per status.
 */
export function releaseTaskData(task: Pick<Task, "status">) {
  return {
    ownerId: null,
    startedAt: null,
    startedById: null,
    ...(task.status === "DOING" ? { status: "TODO" as const } : {}),
  } satisfies Prisma.TaskUncheckedUpdateManyInput;
}
