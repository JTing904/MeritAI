// 前置任务 (M4 spec §2): which task this one waits for, and PREREQ_DONE when that one is finished.
// lib/grading.ts imports notifyPrereqDone from here, so this file must not import lib/grading.ts
// (the finished predicate comes from lib/package-state.ts).
import { isActiveMember } from "../lib/access";
import type { Db } from "../lib/db";
import { AppError, forbidden, notFound } from "../lib/errors";
import { isFinished } from "../lib/package-state";
import { notify, recordEvent } from "./notify";
import { personRef, WITH_NAME } from "./packages";
import { lockAsMember, TX_OPTIONS, type Tx } from "./tx";
import { clock } from "../lib/clock";

/** Sets (WAITING_ON_YOU, feed PREREQ_SET) or clears (feed only) the task's prerequisite: the owner or the leader. */
export async function setPrereq(
  db: Db,
  projectId: string,
  taskId: string,
  userId: string,
  prereqTaskId: string | null,
  now = clock.now(),
): Promise<void> {
  await db.$transaction(async (tx) => {
    const { member } = await lockAsMember(tx, projectId, userId);
    const task = await tx.task.findFirst({ where: { id: taskId, projectId }, include: { owner: { include: WITH_NAME } } });
    if (!task) throw notFound("Task");
    const isLeader = member.role === "LEADER";
    if (!isLeader && task.ownerId !== member.id) throw forbidden("Only the task's owner or the leader can set what it waits for");

    if (prereqTaskId === null) {
      if (task.prereqTaskId === null) return;
      await tx.task.update({ where: { id: task.id }, data: { prereqTaskId: null } });
      await recordEvent(tx, {
        projectId,
        actorId: member.id,
        type: "PREREQ_SET",
        payload: { taskId: task.id, title: task.title, prereqTaskId: null, prereqTitle: null, prereqOwner: null, cleared: true },
        now,
      });
      return;
    }

    if (prereqTaskId === task.id) throw new AppError(400, "PREREQ_SELF", "A task can't wait for itself");
    const prereq = await tx.task.findFirst({ where: { id: prereqTaskId, projectId }, include: { owner: { include: WITH_NAME } } });
    if (!prereq) throw notFound("Task");
    if (isFinished(prereq)) throw new AppError(409, "PREREQ_FINISHED", "That task is already finished");
    if (task.prereqTaskId === prereq.id) return;
    if (await waitsFor(tx, prereq.prereqTaskId, task.id)) {
      throw new AppError(409, "PREREQ_CYCLE", "That would make the tasks wait for each other");
    }

    await tx.task.update({ where: { id: task.id }, data: { prereqTaskId: prereq.id } });
    const prereqOwner = prereq.owner ? personRef(prereq.owner) : null;
    await recordEvent(tx, {
      projectId,
      actorId: member.id,
      type: "PREREQ_SET",
      payload: { taskId: task.id, title: task.title, prereqTaskId: prereq.id, prereqTitle: prereq.title, prereqOwner, cleared: false },
      now,
    });

    // Nobody waits on a task nobody owns yet: no WAITING_ON_YOU then (the feed still shows it).
    if (!task.owner) return;
    const actor = await tx.member.findUniqueOrThrow({ where: { id: member.id }, include: WITH_NAME });
    const leader = isLeader
      ? actor
      : await tx.member.findFirst({ where: { projectId, role: "LEADER", leftAt: null, removed: false }, include: WITH_NAME });

    const toOwner = prereq.owner && isActiveMember(prereq.owner) && prereq.owner.id !== member.id ? prereq.owner : null;
    const toLeader = leader && isActiveMember(leader) && leader.id !== member.id && leader.id !== prereq.owner?.id ? leader : null;
    const audience = toOwner && toLeader ? "YOU_AND_LEADER" : "ONLY_YOU";
    const payload = {
      waitingTaskId: task.id,
      waitingTitle: task.title,
      prereqTaskId: prereq.id,
      prereqTitle: prereq.title,
      waiter: personRef(task.owner),
      prereqOwner,
      setBy: personRef(actor),
    };
    if (toOwner) {
      await notify(tx, {
        userIds: [toOwner.userId],
        projectId,
        type: "WAITING_ON_YOU",
        audience,
        payload: { ...payload, forLeader: false },
        now,
      });
    }
    if (toLeader) {
      await notify(tx, {
        userIds: [toLeader.userId],
        projectId,
        type: "WAITING_ON_YOU",
        audience,
        payload: { ...payload, forLeader: true },
        now,
      });
    }
  }, TX_OPTIONS);
}

/**
 * Whether following the prerequisite chain from `startId` reaches `targetId`: then making `targetId`
 * wait for the chain's head would close a loop where nobody can go first. `seen` guards against a loop
 * that is already stored (none should be).
 */
async function waitsFor(tx: Tx, startId: string | null, targetId: string): Promise<boolean> {
  const seen = new Set<string>();
  for (let id = startId; id !== null && !seen.has(id); ) {
    if (id === targetId) return true;
    seen.add(id);
    const next = await tx.task.findUnique({ where: { id }, select: { prereqTaskId: true } });
    id = next?.prereqTaskId ?? null;
  }
  return false;
}

/**
 * Inside the caller's transaction, after `taskId` became finished: PREREQ_DONE to the active owner of
 * every unfinished task waiting for it, never to the actor.
 */
export async function notifyPrereqDone(tx: Tx, taskId: string, actorUserId: string, now: Date): Promise<void> {
  const prereq = await tx.task.findUniqueOrThrow({
    where: { id: taskId },
    include: { waitingTasks: { orderBy: [{ order: "asc" }, { number: "asc" }], include: { owner: true } } },
  });
  for (const waiting of prereq.waitingTasks) {
    const owner = waiting.owner;
    if (!owner || !isActiveMember(owner) || owner.userId === actorUserId || isFinished(waiting)) continue;
    await notify(tx, {
      userIds: [owner.userId],
      projectId: prereq.projectId,
      type: "PREREQ_DONE",
      audience: "ONLY_YOU",
      payload: { prereqTaskId: prereq.id, prereqTitle: prereq.title, waitingTaskId: waiting.id, waitingTitle: waiting.title },
      now,
    });
  }
}
