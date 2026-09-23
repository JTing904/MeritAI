// 为所有人删除项目 (REQUIREMENTS §13 「组长退出 / 删除项目」): the leader hides a running project from
// everyone at once, can restore it for 7 days, and after that it is purged (rows and files).
import { PROJECT_RESTORE_DAYS } from "../../../shared/constants";
import { deleteConfirmMatches, projectTag } from "../../../shared/format";
import type { PersonRef } from "../../../shared/types";
import type { Member } from "../generated/prisma/client";
import { isActiveMember } from "../lib/access";
import { DAY_MS, endedPurgeAt } from "../lib/lifecycle";
import type { Db } from "../lib/db";
import { AppError, conflict, notFound } from "../lib/errors";
import { getStorage } from "../lib/storage";
import { bumpPackages, notify, recordEvent, voidSwaps } from "./notify";
import { lockProject, memberUnderLock, TX_OPTIONS, type Tx } from "./tx";
import { clock } from "../lib/clock";

async function leaderRef(tx: Tx, member: Member): Promise<PersonRef> {
  const user = await tx.user.findUniqueOrThrow({ where: { id: member.userId }, select: { name: true } });
  return { memberId: member.id, name: user.name };
}

/** User ids of the active members other than `leaderId`. */
async function othersOf(tx: Tx, projectId: string, leaderId: string): Promise<string[]> {
  const members = await tx.member.findMany({
    where: { projectId, leftAt: null, removed: false, id: { not: leaderId } },
    select: { userId: true },
  });
  return members.map((m) => m.userId);
}

/**
 * The leader deletes a confirmed (ACTIVE, AWAITING_CONFIRM or ENDED) project for everyone. `confirm` must be the
 * project tag (case and spaces ignored), checked against the tag as it is under the lock. From now on
 * nobody sees the project (every read and write answers 404); the leader can restore it until
 * purgeAfter. Pending swaps end as VOID (no SWAP_VOID: PROJECT_DELETED tells everyone). Drafts are
 * deleted outright with DELETE /projects/:id instead. An ENDED project keeps the earlier of its two purge
 * dates (M5); restoring it gives the ended one back.
 */
export async function deleteProject(db: Db, projectId: string, userId: string, confirm: string, now = clock.now()): Promise<void> {
  await db.$transaction(async (tx) => {
    const project = await lockProject(tx, projectId);
    const leader = await memberUnderLock(tx, project, userId, { leader: true });
    if (project.status === "DRAFT") throw new AppError(409, "CONFLICT", "Delete a draft from the home screen instead");
    if (!deleteConfirmMatches(confirm, projectTag(project.name, project.shortCode))) {
      throw new AppError(400, "DELETE_CONFIRM_MISMATCH", "Type the project's short name to delete it");
    }

    const restoreUntil = new Date(now.getTime() + PROJECT_RESTORE_DAYS * DAY_MS);
    const purgeAfter = project.purgeAfter !== null && project.purgeAfter < restoreUntil ? project.purgeAfter : restoreUntil;
    await tx.project.update({ where: { id: projectId }, data: { deletedAt: now, purgeAfter, deletedById: leader.id } });
    await voidSwaps(tx, { projectId, all: true, reason: "PROJECT_DELETED", voidedById: leader.id, now, notify: false });
    await notify(tx, {
      userIds: await othersOf(tx, projectId, leader.id),
      projectId,
      type: "PROJECT_DELETED",
      audience: "GROUP",
      payload: { leader: await leaderRef(tx, leader), purgeAfter: purgeAfter.toISOString() },
      now,
    });
    await recordEvent(tx, { projectId, actorId: leader.id, type: "PROJECT_DELETED", payload: {}, now });
    await bumpPackages(tx, projectId);
  }, TX_OPTIONS);
}

/**
 * 恢复项目: only the leader who deleted it (still its active leader), only before purgeAfter. Anyone
 * else, or too late, gets 404 as for any project they can't see; a project that isn't deleted → 409.
 * Everything comes back as it was, except the swaps that were voided.
 */
export async function restoreProject(db: Db, projectId: string, userId: string, now = clock.now()): Promise<void> {
  await db.$transaction(async (tx) => {
    const project = await lockProject(tx, projectId);
    const member = await tx.member.findUnique({ where: { projectId_userId: { projectId, userId } } });
    if (!member || !isActiveMember(member)) throw notFound("Project");
    if (project.deletedAt === null) {
      if (member.role === "LEADER") throw conflict("The project isn't deleted");
      throw notFound("Project");
    }
    const due = project.purgeAfter !== null && project.purgeAfter <= now;
    if (member.role !== "LEADER" || project.deletedById !== member.id || due) throw notFound("Project");

    // An ENDED project goes back to its own purge date (endedAt + 14 days, always later than this one).
    const endedPurge = project.status === "ENDED" && project.endedAt ? endedPurgeAt(project.endedAt) : null;
    await tx.project.update({ where: { id: projectId }, data: { deletedAt: null, purgeAfter: endedPurge, deletedById: null } });
    await notify(tx, {
      userIds: await othersOf(tx, projectId, member.id),
      projectId,
      type: "PROJECT_RESTORED",
      audience: "GROUP",
      payload: { leader: await leaderRef(tx, member) },
      now,
    });
    await recordEvent(tx, { projectId, actorId: member.id, type: "PROJECT_RESTORED", payload: {}, now });
    await bumpPackages(tx, projectId);
  }, TX_OPTIONS);
}

/**
 * Deletes for good every project deleted for everyone whose purgeAfter has passed (and, with `ended`,
 * every ENDED project past its purgeAfter too, M5): its rows (the cascade takes members, tasks,
 * attempts, evidence rows, notifications, feed…) and then its files (the storage prefix "<projectId>").
 * `userId` limits it to that person's projects (GET /api/home runs it lazily for the caller, deleted
 * ones only, as before M5; the tick calls it for everything with `ended`). Each project is re-checked
 * under its lock, so a restore or reopen that got in first wins. A storage failure is logged, not
 * thrown: the rows are gone and the files are unreachable. Returns the ids purged.
 *
 * TODO(D7): badges must outlive the project; copy them out before the delete once they exist.
 */
export async function purgeDeletedProjects(
  db: Db,
  now = clock.now(),
  scope: { userId?: string; ended?: boolean } = {},
): Promise<string[]> {
  const kinds = [{ deletedAt: { not: null } }, ...(scope.ended ? [{ status: "ENDED" as const }] : [])];
  const due = await db.project.findMany({
    where: {
      OR: kinds,
      purgeAfter: { lte: now },
      ...(scope.userId ? { members: { some: { userId: scope.userId } } } : {}),
    },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  const purged: string[] = [];
  for (const { id } of due) {
    const gone = await db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Project" WHERE id = ${id} FOR UPDATE`;
      if (rows.length === 0) return false;
      const project = await tx.project.findUniqueOrThrow({ where: { id }, select: { deletedAt: true, status: true, purgeAfter: true } });
      const kind = project.deletedAt !== null || (scope.ended === true && project.status === "ENDED");
      if (!kind || project.purgeAfter === null || project.purgeAfter > now) return false;
      await tx.project.delete({ where: { id } });
      return true;
    }, TX_OPTIONS);
    if (!gone) continue;
    purged.push(id);
    try {
      await getStorage().deletePrefix(id);
    } catch (err) {
      console.error(`purge: could not delete the files of project ${id}`, err);
    }
  }
  return purged;
}
