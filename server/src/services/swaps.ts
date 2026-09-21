// Swap requests (互换, spec §2): ask, accept, decline, cancel. Pending requests expire after 3 days, lazily.
import type { SwapVoidNoticeReason } from "../../../shared/types";
import type { Prisma } from "../generated/prisma/client";
import { isActiveMember } from "../lib/access";
import type { Db } from "../lib/db";
import { AppError, forbidden, notFound } from "../lib/errors";
import { UNFINISHED_WHERE } from "../lib/package-state";
import { bumpPackages, expireSwaps, notify, recordEvent, remindPackageless, voidSwaps } from "./notify";
import {
  findPackage,
  isPackageStarted,
  NOT_UNDER_REVIEW_WHERE,
  ownPackageStarted,
  personRef,
  UNDER_REVIEW_WHERE,
  WITH_NAME,
} from "./packages";
import { lockAsMember, TX_OPTIONS, type Tx } from "./tx";
import { clock } from "../lib/clock";

export const SWAP_TTL_MS = 72 * 60 * 60 * 1000;

const swapNotPending = () => new AppError(409, "SWAP_NOT_PENDING", "This swap request was already handled or has expired");

const SWAP_PEOPLE = {
  requester: { include: WITH_NAME },
  target: { include: WITH_NAME },
} satisfies Prisma.SwapRequestInclude;

type SwapWithPeople = Prisma.SwapRequestGetPayload<{ include: typeof SWAP_PEOPLE }>;

/** Asks the owner of `packageId` to swap packages with the actor. Both packages must not be started. */
export async function requestSwap(db: Db, projectId: string, userId: string, packageId: string, now = clock.now()): Promise<void> {
  await db.$transaction(async (tx) => {
    const { member } = await lockAsMember(tx, projectId, userId);
    const target = await findPackage(tx, projectId, packageId);
    const own = await tx.package.findUnique({ where: { ownerId: member.id } });
    if (!own) throw new AppError(409, "NEEDS_OWN_PACKAGE", "Pick a package first, then you can ask to swap");
    if (target.ownerId === null) throw new AppError(400, "VALIDATION", "Nobody has this package yet: pick it instead");
    if (target.id === own.id) throw new AppError(400, "VALIDATION", "This is your own package");
    if (await isPackageStarted(tx, own)) throw ownPackageStarted();
    if (await isPackageStarted(tx, target)) throw new AppError(409, "TARGET_STARTED", "They've started, so you can't swap");
    // Pending but past its time counts as gone (expireSwaps below makes it so).
    const outgoing = await tx.swapRequest.count({
      where: { requesterId: member.id, status: "PENDING", expiresAt: { gt: now } },
    });
    if (outgoing > 0) {
      throw new AppError(409, "SWAP_LIMIT", "You can only have one swap request at a time. Cancel the other one first");
    }

    await expireSwaps(tx, { projectId }, now);
    const owner = await tx.member.findUniqueOrThrow({ where: { id: target.ownerId } });
    const swap = await tx.swapRequest.create({
      data: {
        projectId,
        requesterId: member.id,
        targetId: owner.id,
        requesterPackageId: own.id,
        targetPackageId: target.id,
        createdAt: now,
        expiresAt: new Date(now.getTime() + SWAP_TTL_MS),
      },
    });
    const requester = await tx.member.findUniqueOrThrow({ where: { id: member.id }, include: WITH_NAME });
    await notify(tx, {
      userIds: [owner.userId],
      projectId,
      type: "SWAP_REQUEST",
      audience: null,
      payload: { requester: personRef(requester), requesterPackageIndex: own.index, targetPackageIndex: target.index },
      swapId: swap.id,
      now,
    });
  }, TX_OPTIONS);
}

/** The project of a swap request (404 when there is none). */
async function swapProject(db: Db, swapId: string): Promise<string> {
  const swap = await db.swapRequest.findUnique({ where: { id: swapId }, select: { projectId: true } });
  if (!swap) throw notFound("Swap request");
  return swap.projectId;
}

type Answer = "accept" | "decline" | "cancel";

/**
 * Shared start of accept / decline / cancel, under the project lock: only the target answers and only
 * the requester cancels (403 otherwise); a request that isn't pending fails before anything is written.
 * Then this project's overdue requests expire; `null` means this one just did (the caller commits
 * that and fails afterwards).
 */
async function openSwap(tx: Tx, projectId: string, swapId: string, userId: string, answer: Answer, now: Date) {
  const { member } = await lockAsMember(tx, projectId, userId);
  const swap = await tx.swapRequest.findUnique({ where: { id: swapId }, include: SWAP_PEOPLE });
  if (!swap) throw notFound("Swap request");
  const allowed = answer === "cancel" ? swap.requesterId === member.id : swap.targetId === member.id;
  if (!allowed) {
    throw forbidden(answer === "cancel" ? "Only the person who asked can cancel" : "Only the person asked can answer");
  }
  if (swap.status !== "PENDING") throw swapNotPending();
  const expired = await expireSwaps(tx, { projectId }, now);
  return expired.includes(swap.id) ? null : swap;
}

/** Ends one pending request as VOID; SWAP_VOID goes to its requester unless they caused it. */
async function voidOne(tx: Tx, swap: SwapWithPeople, reason: SwapVoidNoticeReason, voidedById: string, now: Date) {
  const { count } = await tx.swapRequest.updateMany({
    where: { id: swap.id, status: "PENDING" },
    data: { status: "VOID", voidReason: reason, voidedById, respondedAt: now },
  });
  if (count !== 1 || !isActiveMember(swap.requester) || swap.requesterId === voidedById) return;
  await notify(tx, {
    userIds: [swap.requester.userId],
    projectId: swap.projectId,
    type: "SWAP_VOID",
    audience: "ONLY_YOU",
    payload: { target: personRef(swap.target), reason },
    swapId: swap.id,
    now,
  });
}

/**
 * The target accepts: the two people trade packages, and the unfinished tasks each held in their package
 * go with it. A request that expired or no longer holds (someone switched or started) is closed as EXPIRED /
 * VOID and the call fails with SWAP_NOT_PENDING. Every other pending request of either person ends.
 * Returns the swap's project id (the route answers with that project's view).
 */
export async function acceptSwap(db: Db, swapId: string, userId: string, now = clock.now()): Promise<string> {
  const projectId = await swapProject(db, swapId);
  const failed = await db.$transaction(async (tx) => {
    const swap = await openSwap(tx, projectId, swapId, userId, "accept", now);
    if (!swap) return true;
    const x = swap.requester;
    const y = swap.target;
    const a = swap.requesterPackageId ? await tx.package.findUnique({ where: { id: swap.requesterPackageId } }) : null;
    const b = swap.targetPackageId ? await tx.package.findUnique({ where: { id: swap.targetPackageId } }) : null;

    // Normally switching, starting or leaving already voided it; this catches anything else that changed.
    if (!a || a.ownerId !== x.id || !isActiveMember(x)) {
      await voidOne(tx, swap, "SWITCHED", x.id, now);
      return true;
    }
    if (!b || b.ownerId !== y.id) {
      await voidOne(tx, swap, "SWITCHED", y.id, now);
      return true;
    }
    if (await isPackageStarted(tx, a)) {
      await voidOne(tx, swap, "STARTED", x.id, now);
      return true;
    }
    if (await isPackageStarted(tx, b)) {
      await voidOne(tx, swap, "STARTED", y.id, now);
      return true;
    }

    const { count } = await tx.swapRequest.updateMany({
      where: { id: swap.id, status: "PENDING" },
      data: { status: "ACCEPTED", respondedAt: now },
    });
    if (count !== 1) return true;

    // Package.ownerId is unique, so A is emptied first. Tasks are re-owned by package, never by owner
    // alone: a task someone holds outside their package stays where it is. Finished work never changes
    // hands (a package whose owner finished a task counts as started, so this is a second guard), and
    // neither does a submission waiting for review: it stays with its submitter, outside the package.
    await tx.package.update({ where: { id: a.id }, data: { ownerId: null } });
    await tx.package.update({ where: { id: b.id }, data: { ownerId: x.id } });
    await tx.package.update({ where: { id: a.id }, data: { ownerId: y.id } });
    const reviewing = [UNFINISHED_WHERE, UNDER_REVIEW_WHERE];
    const movable = [UNFINISHED_WHERE, NOT_UNDER_REVIEW_WHERE];
    await tx.task.updateMany({ where: { packageId: a.id, ownerId: x.id, AND: reviewing }, data: { packageId: null } });
    await tx.task.updateMany({ where: { packageId: b.id, ownerId: y.id, AND: reviewing }, data: { packageId: null } });
    await tx.task.updateMany({ where: { packageId: a.id, ownerId: x.id, AND: movable }, data: { ownerId: y.id } });
    await tx.task.updateMany({ where: { packageId: b.id, ownerId: y.id, AND: movable }, data: { ownerId: x.id } });
    await voidSwaps(tx, { projectId, memberIds: [x.id, y.id], reason: "SWAPPED_ELSEWHERE", voidedById: y.id, now, notify: true });

    await notify(tx, {
      userIds: [x.userId],
      projectId,
      type: "SWAP_ACCEPTED",
      audience: "ONLY_YOU",
      payload: { target: personRef(y), targetPackageIndex: b.index },
      swapId: swap.id,
      now,
    });
    await recordEvent(tx, {
      projectId,
      actorId: y.id,
      type: "SWAPPED",
      payload: { requester: personRef(x), requesterPackageIndex: a.index, targetPackageIndex: b.index },
      now,
    });
    await bumpPackages(tx, projectId);
    await remindPackageless(tx, projectId, { now });
    return false;
  }, TX_OPTIONS);
  if (failed) throw swapNotPending();
  return projectId;
}

/** The target declines; the requester is told. Returns the swap's project id. */
export async function declineSwap(db: Db, swapId: string, userId: string, now = clock.now()): Promise<string> {
  const projectId = await swapProject(db, swapId);
  const failed = await db.$transaction(async (tx) => {
    const swap = await openSwap(tx, projectId, swapId, userId, "decline", now);
    if (!swap) return true;
    const { count } = await tx.swapRequest.updateMany({
      where: { id: swap.id, status: "PENDING" },
      data: { status: "DECLINED", respondedAt: now },
    });
    if (count !== 1) return true;
    if (isActiveMember(swap.requester)) {
      await notify(tx, {
        userIds: [swap.requester.userId],
        projectId,
        type: "SWAP_DECLINED",
        audience: "ONLY_YOU",
        payload: { target: personRef(swap.target) },
        swapId: swap.id,
        now,
      });
    }
    return false;
  }, TX_OPTIONS);
  if (failed) throw swapNotPending();
  return projectId;
}

/** The requester cancels (the target's request card shows it; no notification). Returns the swap's project id. */
export async function cancelSwap(db: Db, swapId: string, userId: string, now = clock.now()): Promise<string> {
  const projectId = await swapProject(db, swapId);
  const failed = await db.$transaction(async (tx) => {
    const swap = await openSwap(tx, projectId, swapId, userId, "cancel", now);
    if (!swap) return true;
    const { count } = await tx.swapRequest.updateMany({
      where: { id: swap.id, status: "PENDING" },
      data: { status: "CANCELLED", respondedAt: now },
    });
    return count !== 1;
  }, TX_OPTIONS);
  if (failed) throw swapNotPending();
  return projectId;
}
