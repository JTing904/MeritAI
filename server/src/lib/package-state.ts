// The M3 package rules in one place (spec §2), as pure functions over database rows.
import type { Member, Package, Prisma, Project, Task, TaskStatus } from "../generated/prisma/client";
import { isActiveMember } from "./access";

/** Finished work: its points are earned (HALF may be resubmitted, but it still counts). */
export const FINISHED_STATUSES: readonly TaskStatus[] = ["DONE", "HALF"];

export const isFinished = (task: Pick<Task, "status">): boolean => FINISHED_STATUSES.includes(task.status);

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
  tasks: Pick<Task, "packageId" | "ownerId" | "status" | "startedAt" | "startedById">[],
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

/** Tenths earned: DONE → all, HALF → half (rounded), anything else → 0. */
export function earnedPoints(task: Pick<Task, "status" | "points">): number {
  if (task.status === "DONE") return task.points;
  if (task.status === "HALF") return Math.round(task.points / 2);
  return 0;
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

/** Not finished and past its due date (the project deadline when it has none). */
export function isOverdue(task: Pick<Task, "status" | "dueAt">, project: Pick<Project, "deadline">, now: Date): boolean {
  return !isFinished(task) && (task.dueAt ?? project.deadline) < now;
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
 * TODO; REVIEWING and FAIL keep their status (M4 decides more). Works with update and updateMany, so
 * a bulk release runs one updateMany per status.
 */
export function releaseTaskData(task: Pick<Task, "status">) {
  return {
    ownerId: null,
    startedAt: null,
    startedById: null,
    ...(task.status === "DOING" ? { status: "TODO" as const } : {}),
  } satisfies Prisma.TaskUncheckedUpdateManyInput;
}
