// Picking, switching, assigning, moving and starting (M3 spec §2; M4 §2 amends starting and moving).
import type { PersonRef } from "../../../shared/types";
import type { Member, Package, Prisma, Task } from "../generated/prisma/client";
import { isActiveMember } from "../lib/access";
import type { Db } from "../lib/db";
import { AppError, forbidden, notFound } from "../lib/errors";
import { FINISHED_WHERE, isFinished, isLocked, packageStarted, releaseTaskData, UNFINISHED_WHERE } from "../lib/package-state";
import { bumpPackages, notify, recordEvent, remindPackageless, voidSwaps } from "./notify";
import { lockAsMember, TX_OPTIONS, type Tx } from "./tx";

export const packageTaken = () => new AppError(409, "PACKAGE_TAKEN", "Someone just took this package");
export const ownPackageStarted = () => new AppError(409, "PACKAGE_STARTED", "You've started, so you can't switch packages");
const leaderOnlyManages = () => new AppError(409, "LEADER_ONLY_MANAGES", "A leader who only manages doesn't pick a package");

/**
 * Tasks with a submission waiting for the leader (交了就不换手, M4 spec §15 #1): they never change hands.
 * When their package does, they stay with the submitter and leave the package (packageId = null), like a
 * leaver's REVIEWING task.
 */
export const UNDER_REVIEW_WHERE = { attempts: { some: { status: "PENDING" } } } satisfies Prisma.TaskWhereInput;
export const NOT_UNDER_REVIEW_WHERE = { attempts: { none: { status: "PENDING" } } } satisfies Prisma.TaskWhereInput;

/** A member as payloads snapshot them. */
export const personRef = (m: { id: string; user: { name: string } }): PersonRef => ({ memberId: m.id, name: m.user.name });

export const WITH_NAME = { user: { select: { name: true } } } as const;

/** A package of this project (404 otherwise). */
export async function findPackage(tx: Tx, projectId: string, packageId: string): Promise<Package> {
  const pkg = await tx.package.findFirst({ where: { id: packageId, projectId } });
  if (!pkg) throw notFound("Package");
  return pkg;
}

/** Its owner started one of its tasks or holds a finished one (see packageStarted). */
export async function isPackageStarted(tx: Tx, pkg: Pick<Package, "id" | "ownerId">): Promise<boolean> {
  if (pkg.ownerId === null) return false;
  const tasks = await tx.task.findMany({
    where: {
      packageId: pkg.id,
      OR: [{ startedById: pkg.ownerId }, { AND: [{ ownerId: pkg.ownerId }, FINISHED_WHERE] }],
    },
    select: { packageId: true, ownerId: true, status: true, grade: true, startedAt: true, startedById: true },
  });
  return packageStarted(pkg, tasks);
}

/** Gives a free package to `memberId`; its unfinished tasks nobody owns (and nobody submitted) become theirs. */
async function claimPackage(tx: Tx, packageId: string, memberId: string): Promise<void> {
  const { count } = await tx.package.updateMany({ where: { id: packageId, ownerId: null }, data: { ownerId: memberId } });
  if (count !== 1) throw packageTaken();
  await tx.task.updateMany({
    where: { packageId, ownerId: null, AND: [UNFINISHED_WHERE, NOT_UNDER_REVIEW_WHERE] },
    data: { ownerId: memberId },
  });
}

/**
 * 选包 / 换包: a member who needs a package takes a free one; someone whose package isn't started
 * switches to a free one. Picking your own package does nothing.
 */
export async function pickPackage(db: Db, projectId: string, packageId: string, userId: string, now = new Date()): Promise<void> {
  await db.$transaction(async (tx) => {
    const { project, member } = await lockAsMember(tx, projectId, userId);
    if (member.role === "LEADER" && project.leaderManages) throw leaderOnlyManages();
    const target = await findPackage(tx, projectId, packageId);
    if (target.ownerId === member.id) return;
    if (target.ownerId !== null) throw packageTaken();

    const current = await tx.package.findUnique({ where: { ownerId: member.id } });
    if (current) {
      if (await isPackageStarted(tx, current)) throw ownPackageStarted();
      // Package.ownerId is unique: free the old one before claiming the new one. Every unfinished task
      // the switcher holds in it goes back to nobody, so whoever picks the package next gets it. A package
      // that isn't started holds no locked task its owner started and nothing its owner finished, so any
      // locked one was started by someone else (or handed back): it keeps its progress and starter, and
      // the next picker doesn't count as started (REQUIREMENTS §13). Finished work never changes hands,
      // and neither does a submission waiting for review: it stays the switcher's, outside the package.
      await tx.package.update({ where: { id: current.id }, data: { ownerId: null } });
      await tx.task.updateMany({
        where: { packageId: current.id, ownerId: member.id, AND: [UNFINISHED_WHERE, UNDER_REVIEW_WHERE] },
        data: { packageId: null },
      });
      await tx.task.updateMany({
        where: { packageId: current.id, ownerId: member.id, AND: [UNFINISHED_WHERE] },
        data: { ownerId: null },
      });
      await voidSwaps(tx, { projectId, memberIds: [member.id], reason: "SWITCHED", voidedById: member.id, now, notify: true });
    }
    await claimPackage(tx, target.id, member.id);

    if (current) {
      await recordEvent(tx, {
        projectId,
        actorId: member.id,
        type: "SWITCHED",
        payload: { fromPackageIndex: current.index, toPackageIndex: target.index },
        now,
      });
    } else {
      await recordEvent(tx, { projectId, actorId: member.id, type: "PICKED", payload: { packageIndex: target.index }, now });
    }
    await bumpPackages(tx, projectId);
    await remindPackageless(tx, projectId, { now });
  }, TX_OPTIONS);
}

/** Leader: gives a free package to `memberId` (a member who needs one). */
export async function assignPackage(
  db: Db,
  projectId: string,
  packageId: string,
  userId: string,
  memberId: string,
  now = new Date(),
): Promise<void> {
  await db.$transaction(async (tx) => {
    const { project, member: leader } = await lockAsMember(tx, projectId, userId, { leader: true });
    const pkg = await findPackage(tx, projectId, packageId);
    const target = await tx.member.findFirst({
      where: { id: memberId, projectId },
      include: { ...WITH_NAME, package: { select: { id: true } } },
    });
    if (!target || !isActiveMember(target)) throw notFound("Member");
    if (target.role === "LEADER" && project.leaderManages) throw leaderOnlyManages();
    if (target.package) throw new AppError(409, "ALREADY_HAS_PACKAGE", "They already have a package");
    if (pkg.ownerId !== null) throw packageTaken();

    await claimPackage(tx, pkg.id, target.id);
    if (target.id !== leader.id) {
      await notify(tx, {
        userIds: [target.userId],
        projectId,
        type: "PACKAGE_ASSIGNED",
        audience: "ONLY_YOU",
        payload: { packageIndex: pkg.index },
        now,
      });
    }
    await recordEvent(tx, {
      projectId,
      actorId: leader.id,
      type: "ASSIGNED",
      payload: { packageIndex: pkg.index, member: personRef(target) },
      now,
    });
    await bumpPackages(tx, projectId);
    await remindPackageless(tx, projectId, { now });
  }, TX_OPTIONS);
}

/**
 * Leader: moves one unfinished task into another package. Into an owned package it changes hands and
 * keeps its progress (and its evidence); into a free package it is released. Both owners hear about it
 * (never the leader). A task waiting for review can't move (TASK_UNDER_REVIEW: grade it first). A task
 * in no package (a leaver's, released after grading, or a failed submission that stayed with its owner
 * when they switched or swapped) may move too: there is no 「from」 package then, and a still-active
 * owner hears about it all the same.
 */
export async function moveTask(
  db: Db,
  projectId: string,
  taskId: string,
  userId: string,
  packageId: string,
  now = new Date(),
): Promise<void> {
  await db.$transaction(async (tx) => {
    const { member: leader } = await lockAsMember(tx, projectId, userId, { leader: true });
    const task = await tx.task.findFirst({ where: { id: taskId, projectId }, include: { owner: { include: WITH_NAME } } });
    if (!task) throw notFound("Task");
    const dest = await tx.package.findFirst({ where: { id: packageId, projectId }, include: { owner: { include: WITH_NAME } } });
    if (!dest) throw notFound("Package");
    if (isFinished(task)) throw new AppError(409, "TASK_FINISHED", "This task is finished, so it can't be moved");
    if (await tx.attempt.count({ where: { taskId: task.id, status: "PENDING" } })) {
      throw new AppError(409, "TASK_UNDER_REVIEW", "They've already submitted this. Grade it first, then move it");
    }
    if (task.packageId === dest.id) throw new AppError(400, "VALIDATION", "The task is already in this package");
    const from = task.packageId === null ? null : await tx.package.findUniqueOrThrow({ where: { id: task.packageId } });
    // 已交的证据跟着任务走: evidence of any attempt stays with the task.
    const hasEvidence = (await tx.evidence.count({ where: { taskId: task.id } })) > 0;

    await tx.task.update({
      where: { id: task.id },
      data: dest.ownerId !== null ? { packageId: dest.id, ownerId: dest.ownerId } : { packageId: dest.id, ...releaseTaskData(task) },
    });
    // Back in the package of the person who started it: that package is started again, so its owner's
    // pending swaps end as if they had just started.
    if (dest.ownerId !== null && task.startedById === dest.ownerId && isLocked(task)) {
      await voidSwaps(tx, { projectId, memberIds: [dest.ownerId], reason: "STARTED", voidedById: dest.ownerId, now, notify: true });
    }

    const oldOwner = task.owner && isActiveMember(task.owner) ? task.owner : null;
    const newOwner = dest.owner;
    if (newOwner && newOwner.id !== leader.id) {
      await notify(tx, {
        userIds: [newOwner.userId],
        projectId,
        type: "TASK_MOVED_IN",
        audience: "ONLY_YOU",
        payload: {
          taskId: task.id,
          title: task.title,
          from: oldOwner ? personRef(oldOwner) : null,
          fromPackageIndex: from?.index ?? null,
          toPackageIndex: dest.index,
          hasEvidence,
        },
        now,
      });
    }
    if (oldOwner && oldOwner.id !== leader.id && oldOwner.id !== newOwner?.id) {
      await notify(tx, {
        userIds: [oldOwner.userId],
        projectId,
        type: "TASK_MOVED_OUT",
        audience: "ONLY_YOU",
        payload: {
          taskId: task.id,
          title: task.title,
          fromPackageIndex: from?.index ?? null,
          to: newOwner ? personRef(newOwner) : null,
          toPackageIndex: dest.index,
        },
        now,
      });
    }
    await recordEvent(tx, {
      projectId,
      actorId: leader.id,
      type: "TASK_MOVED",
      payload: { taskId: task.id, title: task.title, fromPackageIndex: from?.index ?? null, toPackageIndex: dest.index },
      now,
    });
    await bumpPackages(tx, projectId);
  }, TX_OPTIONS);
}

export type StartOptions = {
  /** False: only a never-started task starts (case a); never re-attribute (组长代为完成). Default true. */
  allowReattribute?: boolean;
};

/**
 * Starting (开工, M4 spec §2), under the caller's project lock; the caller bumps. (a) Not started yet:
 * `member` starts it (TODO → DOING). (b) Started by someone else but now owned by `member` (a task moved
 * in half-done): the start becomes theirs (REQUIREMENTS §13: 要你自己开始做才算), keeping the original
 * startedAt. Both end `member`'s pending swaps (reason STARTED) and add TASK_STARTED to the feed.
 * (c) Anything else changes nothing. Returns whether it changed the task.
 */
export async function startUnderLock(
  tx: Tx,
  task: Pick<Task, "id" | "projectId" | "title" | "status" | "ownerId" | "startedAt" | "startedById">,
  member: Pick<Member, "id">,
  now: Date,
  opts: StartOptions = {},
): Promise<boolean> {
  if (task.startedAt === null) {
    await tx.task.update({
      where: { id: task.id },
      data: { startedAt: now, startedById: member.id, ...(task.status === "TODO" ? { status: "DOING" as const } : {}) },
    });
  } else if ((opts.allowReattribute ?? true) && task.startedById !== member.id && task.ownerId === member.id) {
    await tx.task.update({ where: { id: task.id }, data: { startedById: member.id } });
  } else {
    return false;
  }
  await voidSwaps(tx, { projectId: task.projectId, memberIds: [member.id], reason: "STARTED", voidedById: member.id, now, notify: true });
  await recordEvent(tx, { projectId: task.projectId, actorId: member.id, type: "TASK_STARTED", payload: { taskId: task.id, title: task.title }, now });
  return true;
}

/**
 * 开始做: only the task's owner. Starts it, or makes a moved-in task someone else started theirs
 * (startUnderLock); otherwise a no-op. Starting ends the owner's pending swaps.
 */
export async function startTask(db: Db, projectId: string, taskId: string, userId: string, now = new Date()): Promise<void> {
  await db.$transaction(async (tx) => {
    const { member } = await lockAsMember(tx, projectId, userId);
    const task = await tx.task.findFirst({ where: { id: taskId, projectId } });
    if (!task) throw notFound("Task");
    if (task.ownerId !== member.id) throw forbidden("Only the task's owner can start it");
    if (await startUnderLock(tx, task, member, now)) await bumpPackages(tx, projectId);
  }, TX_OPTIONS);
}
