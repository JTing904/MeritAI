// Leaving, removing and transferring the leader role (spec §2 Members).
import type { PersonRef } from "../../../shared/types";
import type { Member, Prisma, Project, TaskStatus } from "../generated/prisma/client";
import { isActiveMember } from "../lib/access";
import type { Db } from "../lib/db";
import { AppError, notFound } from "../lib/errors";
import { FINISHED_WHERE, releaseTaskData } from "../lib/package-state";
import { bumpPackages, notify, recordEvent, remindPackageless, voidSwaps } from "./notify";
import { lockAsMember, TX_OPTIONS, type Tx } from "./tx";
import { clock } from "../lib/clock";

type Named = Member & { user: { name: string } };

const personRef = (m: Named): PersonRef => ({ memberId: m.id, name: m.user.name });

/** Another member of the project, re-read under the lock: unknown or no longer active → 404. */
async function activeTarget(tx: Tx, projectId: string, memberId: string): Promise<Named> {
  const target = await tx.member.findFirst({ where: { id: memberId, projectId }, include: { user: { select: { name: true } } } });
  if (!target || !isActiveMember(target)) throw notFound("Member");
  return target;
}

const withName = (tx: Tx, member: Member): Promise<Named> =>
  tx.member.findUniqueOrThrow({ where: { id: member.id }, include: { user: { select: { name: true } } } });

/** Kept by whoever did them when they leave (finished, or waiting for review): their points and grades stay theirs. */
const KEPT_WHERE = { OR: [FINISHED_WHERE, { status: "REVIEWING" }] } satisfies Prisma.TaskWhereInput;
/** Released when their owner leaves (see releaseTaskData), one updateMany per status. */
const RELEASED_STATUSES = ["TODO", "DOING", "FAIL"] as const satisfies readonly TaskStatus[];

/**
 * Leaving or removal, inside the caller's transaction: the member becomes inactive and their package
 * free. Finished and in-review tasks keep their owner but leave the package; every other task they own
 * is released and stays in its package (that count is the 「没做完的 N 个任务」). Their pending swaps
 * are void. `leader` is set for a removal.
 */
async function depart(tx: Tx, projectId: string, member: Named, leader: Member | null, now: Date): Promise<void> {
  await tx.member.update({
    where: { id: member.id },
    data: { leftAt: now, removed: leader !== null, packageReminderAt: null },
  });
  await tx.package.updateMany({ where: { projectId, ownerId: member.id }, data: { ownerId: null } });
  await tx.task.updateMany({
    where: { projectId, ownerId: member.id, AND: [KEPT_WHERE] },
    data: { packageId: null },
  });
  let unfinishedCount = 0;
  for (const status of RELEASED_STATUSES) {
    const { count } = await tx.task.updateMany({
      where: { projectId, ownerId: member.id, status, OR: [{ grade: null }, { grade: "FAIL" }] },
      data: releaseTaskData({ status }),
    });
    unfinishedCount += count;
  }
  // They are inactive by now, so voidSwaps sends them nothing; requesters who asked them get SWAP_VOID.
  await voidSwaps(tx, { projectId, memberIds: [member.id], reason: "LEFT", voidedById: member.id, now, notify: true });

  const remaining = await tx.member.findMany({
    where: { projectId, leftAt: null, removed: false },
    select: { id: true, userId: true },
  });
  const payload = { member: personRef(member), unfinishedCount };
  if (leader === null) {
    await notify(tx, {
      userIds: remaining.map((m) => m.userId),
      projectId,
      type: "MEMBER_LEFT",
      audience: "GROUP",
      mine: false,
      payload,
      now,
    });
    await recordEvent(tx, { projectId, actorId: member.id, type: "LEFT", payload: {}, now });
  } else {
    await notify(tx, {
      userIds: remaining.filter((m) => m.id !== leader.id).map((m) => m.userId),
      projectId,
      type: "MEMBER_REMOVED",
      audience: "GROUP",
      mine: false,
      payload,
      now,
    });
    await notify(tx, { userIds: [member.userId], projectId, type: "REMOVED_YOU", audience: "ONLY_YOU", payload: {}, now });
    await recordEvent(tx, { projectId, actorId: leader.id, type: "REMOVED", payload: { member: personRef(member) }, now });
  }
  await bumpPackages(tx, projectId);
  await remindPackageless(tx, projectId, { now });
}

/** Any member except the leader (LEADER_MUST_TRANSFER). They can come back later with the invite code. */
export async function leaveProject(db: Db, projectId: string, userId: string, now = clock.now()): Promise<void> {
  await db.$transaction(async (tx) => {
    // Leaving works in an ENDED project too (M5).
    const { member } = await lockAsMember(tx, projectId, userId, { allowEnded: true });
    if (member.role === "LEADER") {
      throw new AppError(409, "LEADER_MUST_TRANSFER", "Hand the leader role to someone else before you leave");
    }
    await depart(tx, projectId, await withName(tx, member), null, now);
  }, TX_OPTIONS);
}

/** Leader removes `memberId` (not themself): like leaving, plus `removed` (no coming back with the code). */
export async function removeMember(db: Db, projectId: string, userId: string, memberId: string, now = clock.now()): Promise<void> {
  await db.$transaction(async (tx) => {
    const { member: leader } = await lockAsMember(tx, projectId, userId, { leader: true });
    const target = await activeTarget(tx, projectId, memberId);
    if (target.id === leader.id) throw new AppError(400, "VALIDATION", "You can't remove yourself");
    await depart(tx, projectId, target, leader, now);
  }, TX_OPTIONS);
}

/**
 * Inside the caller's transaction: `leader` hands the role to `target` (another active member); the roles
 * swap and 「只管理」 turns off. The new leader hears LEADER_TRANSFERRED (`leftAfter`: the old leader is
 * leaving right after, see leaveAsLeader). Package reminders are reset so the new leader hears about
 * whoever still waits; the caller runs remindPackageless once everything else is done.
 */
async function handOver(tx: Tx, project: Project, leader: Named, target: Named, leftAfter: boolean, now: Date): Promise<void> {
  await tx.member.update({ where: { id: leader.id }, data: { role: "MEMBER" } });
  await tx.member.update({ where: { id: target.id }, data: { role: "LEADER" } });
  if (project.leaderManages) await tx.project.update({ where: { id: project.id }, data: { leaderManages: false } });

  await notify(tx, {
    userIds: [target.userId],
    projectId: project.id,
    type: "LEADER_TRANSFERRED",
    audience: "ONLY_YOU",
    payload: leftAfter ? { from: personRef(leader), leftAfter: true } : { from: personRef(leader) },
    now,
  });
  await recordEvent(tx, { projectId: project.id, actorId: leader.id, type: "LEADER_TRANSFERRED", payload: { member: personRef(target) }, now });
  // The old leader only heard about members waiting for a package; the new one should hear too.
  await tx.member.updateMany({ where: { projectId: project.id, packageReminderAt: { not: null } }, data: { packageReminderAt: null } });
}

/** The leader's pick for the next leader, re-read under the lock: themself → 400, not an active member → 404. */
async function nextLeader(tx: Tx, projectId: string, leader: Member, memberId: string): Promise<Named> {
  const target = await activeTarget(tx, projectId, memberId);
  if (target.id === leader.id) throw new AppError(400, "VALIDATION", "You are the leader already");
  return target;
}

/**
 * Leader hands the role to `memberId` (another active member); the roles swap. 「只管理」 turns off:
 * the new leader keeps their package and the old one becomes a member who needs a package.
 */
export async function transferLeader(db: Db, projectId: string, userId: string, memberId: string, now = clock.now()): Promise<void> {
  await db.$transaction(async (tx) => {
    const { project, member } = await lockAsMember(tx, projectId, userId, { leader: true });
    const target = await nextLeader(tx, projectId, member, memberId);
    await handOver(tx, project, await withName(tx, member), target, false, now);
    await bumpPackages(tx, projectId);
    await remindPackageless(tx, projectId, { now });
  }, TX_OPTIONS);
}

/**
 * 「我自己退出」 (leader): hands the role to `newLeaderMemberId`, then leaves, in one step (transferLeader's
 * rules, then leaveProject's). With nobody else active there is no one to take over (NO_ONE_TO_TRANSFER):
 * the leader can only delete the project for everyone. The group hears the usual MEMBER_LEFT.
 */
export async function leaveAsLeader(
  db: Db,
  projectId: string,
  userId: string,
  newLeaderMemberId: string,
  now = clock.now(),
): Promise<void> {
  await db.$transaction(async (tx) => {
    // Leaving works in an ENDED project too (M5); handing the role over is part of it.
    const { project, member } = await lockAsMember(tx, projectId, userId, { leader: true, allowEnded: true });
    const others = await tx.member.count({ where: { projectId, leftAt: null, removed: false, id: { not: member.id } } });
    if (others === 0) throw new AppError(409, "NO_ONE_TO_TRANSFER", "Nobody else is in the project to take over");
    const target = await nextLeader(tx, projectId, member, newLeaderMemberId);
    const leader = await withName(tx, member);
    await handOver(tx, project, leader, target, true, now);
    // depart bumps the packages version and sends the reminders, now to the new leader.
    await depart(tx, projectId, { ...leader, role: "MEMBER" }, null, now);
  }, TX_OPTIONS);
}
