// Notifications, the project feed, the packages version and swap expiry/voiding, shared by every M3 write.
import type { ActivityPayload, NotificationPayload, SwapVoidReason } from "../../../shared/types";
import type { NotificationAudience, Prisma } from "../generated/prisma/client";
import { isActiveMember } from "../lib/access";
import { needsPackage } from "../lib/package-state";
import type { Tx } from "./tx";

type NotificationKind = NotificationPayload["type"];
type ActivityKind = ActivityPayload["type"];

/** A notification payload without its `type` (notify adds it). */
export type NotificationData<T extends NotificationKind> = Omit<Extract<NotificationPayload, { type: T }>, "type">;
/** A feed payload without its `type` (recordEvent adds it). */
export type ActivityData<T extends ActivityKind> = Omit<Extract<ActivityPayload, { type: T }>, "type">;

export type NotifyInput<T extends NotificationKind> = {
  /** User ids (not member ids). Never include the person who acted. Repeats are sent once. */
  userIds: string[];
  projectId: string | null;
  type: T;
  audience: NotificationAudience | null;
  /** Shown under 「跟我有关」 (default true); a function decides per recipient. */
  mine?: boolean | ((userId: string) => boolean);
  payload: NotificationData<T>;
  swapId?: string | null;
  /** createdAt; defaults to the database time. Pass the service's `now` so tests that move time stay in order. */
  now?: Date;
};

/** One row per recipient. The stored payload is the full NotificationPayload (type included). */
export async function notify<T extends NotificationKind>(tx: Tx, input: NotifyInput<T>): Promise<void> {
  const userIds = [...new Set(input.userIds)];
  if (userIds.length === 0) return;
  const payload = { type: input.type, ...input.payload } as Prisma.InputJsonObject;
  await tx.notification.createMany({
    data: userIds.map((userId) => ({
      userId,
      projectId: input.projectId,
      type: input.type,
      audience: input.audience,
      mine: typeof input.mine === "function" ? input.mine(userId) : (input.mine ?? true),
      payload,
      swapId: input.swapId ?? null,
      ...(input.now ? { createdAt: input.now } : {}),
    })),
  });
}

export type EventInput<T extends ActivityKind> = {
  projectId: string;
  /** Member id of whoever did it (null for none). */
  actorId: string | null;
  type: T;
  payload: ActivityData<T>;
  now?: Date;
};

/** Adds a feed (动态) entry. */
export async function recordEvent<T extends ActivityKind>(tx: Tx, input: EventInput<T>): Promise<void> {
  await tx.activityEvent.create({
    data: {
      projectId: input.projectId,
      actorId: input.actorId,
      type: input.type,
      payload: { type: input.type, ...input.payload } as Prisma.InputJsonObject,
      ...(input.now ? { createdAt: input.now } : {}),
    },
  });
}

/**
 * Marks the packages as changed (a re-split preview taken before this is now stale). Call it on every
 * change to packages, owners, members, or a task's package / owner / status / start / points.
 * Returns the new version.
 */
export async function bumpPackages(tx: Tx, projectId: string): Promise<number> {
  const project = await tx.project.update({
    where: { id: projectId },
    data: { packagesVersion: { increment: 1 } },
    select: { packagesVersion: true },
  });
  return project.packagesVersion;
}

const SWAP_PEOPLE = {
  requester: { select: { id: true, userId: true, leftAt: true, removed: true } },
  target: { select: { id: true, user: { select: { name: true } } } },
} satisfies Prisma.SwapRequestInclude;

/**
 * Lazy expiry (there is no scheduler yet): pending swaps in `where` whose expiresAt has passed become
 * EXPIRED, one guarded update at a time in id order, and the requester gets SWAP_EXPIRED only from the
 * update that actually changed the row (so two concurrent readers send it once). Returns the ids expired.
 */
export async function expireSwaps(tx: Tx, where: Prisma.SwapRequestWhereInput, now: Date): Promise<string[]> {
  const due = await tx.swapRequest.findMany({
    where: { AND: [where, { status: "PENDING", expiresAt: { lte: now } }] },
    orderBy: { id: "asc" },
    include: SWAP_PEOPLE,
  });
  const expired: string[] = [];
  for (const swap of due) {
    const { count } = await tx.swapRequest.updateMany({
      where: { id: swap.id, status: "PENDING" },
      data: { status: "EXPIRED", respondedAt: now },
    });
    if (count !== 1) continue;
    expired.push(swap.id);
    if (!isActiveMember(swap.requester)) continue;
    await notify(tx, {
      userIds: [swap.requester.userId],
      projectId: swap.projectId,
      type: "SWAP_EXPIRED",
      audience: "ONLY_YOU",
      payload: { target: { memberId: swap.target.id, name: swap.target.user.name } },
      swapId: swap.id,
      now,
    });
  }
  return expired;
}

export type VoidSwapsInput = {
  projectId: string;
  /** Pending swaps where any of these members is the requester or the target… */
  memberIds?: string[];
  /** …or every pending swap of the project (a re-split). */
  all?: boolean;
  reason: SwapVoidReason;
  /** Member whose action voided them (stored; they get no SWAP_VOID). */
  voidedById: string | null;
  now: Date;
  /** Send SWAP_VOID to each active requester other than `voidedById`. Never sent for RESPLIT or PROJECT_DELETED. */
  notify: boolean;
};

/**
 * Voids pending swaps. Those already past their time become EXPIRED first (expireSwaps), then each
 * remaining one gets a guarded update to VOID. Returns the ids voided.
 */
export async function voidSwaps(tx: Tx, input: VoidSwapsInput): Promise<string[]> {
  const { projectId, memberIds = [], all = false, reason, voidedById, now } = input;
  if (!all && memberIds.length === 0) return [];
  const scope: Prisma.SwapRequestWhereInput = all
    ? { projectId }
    : { projectId, OR: [{ requesterId: { in: memberIds } }, { targetId: { in: memberIds } }] };
  await expireSwaps(tx, scope, now);

  const pending = await tx.swapRequest.findMany({
    where: { AND: [scope, { status: "PENDING" }] },
    orderBy: { id: "asc" },
    include: SWAP_PEOPLE,
  });
  const voided: string[] = [];
  for (const swap of pending) {
    const { count } = await tx.swapRequest.updateMany({
      where: { id: swap.id, status: "PENDING" },
      data: { status: "VOID", voidReason: reason, voidedById, respondedAt: now },
    });
    if (count !== 1) continue;
    voided.push(swap.id);
    if (!input.notify || reason === "RESPLIT" || reason === "PROJECT_DELETED") continue;
    if (!isActiveMember(swap.requester) || swap.requester.id === voidedById) continue;
    await notify(tx, {
      userIds: [swap.requester.userId],
      projectId,
      type: "SWAP_VOID",
      audience: "ONLY_YOU",
      payload: { target: { memberId: swap.target.id, name: swap.target.user.name }, reason },
      swapId: swap.id,
      now,
    });
  }
  return voided;
}

/**
 * The leader reminder (REQUIREMENTS §13): while no package is free, each active member who needs one
 * (other than the leader) is reported to the leader once with MEMBER_NEEDS_PACKAGE; Member.packageReminderAt
 * dedupes it. Reminders are cleared for members who now hold a package or are no longer active, so a
 * later need (or a rejoin) is reported again. Idempotent: call it at the end of every mutation that
 * changes package owners or members (join, pick, switch, assign, swap, transfer, re-split, leave, remove).
 * `joinedMemberId`: the member who just joined, for the 「加入了 {tag}，但…」 wording.
 */
export async function remindPackageless(
  tx: Tx,
  projectId: string,
  opts: { joinedMemberId?: string; now?: Date } = {},
): Promise<void> {
  const now = opts.now ?? new Date();
  await tx.member.updateMany({
    where: {
      projectId,
      packageReminderAt: { not: null },
      OR: [{ package: { isNot: null } }, { leftAt: { not: null } }, { removed: true }],
    },
    data: { packageReminderAt: null },
  });

  const project = await tx.project.findUniqueOrThrow({
    where: { id: projectId },
    include: {
      packages: { select: { ownerId: true } },
      members: {
        where: { leftAt: null, removed: false },
        orderBy: { joinedAt: "asc" },
        include: { user: { select: { name: true } } },
      },
    },
  });
  if (project.packages.some((p) => p.ownerId === null)) return;
  const leader = project.members.find((m) => m.role === "LEADER");
  if (!leader) return;

  const owners = new Set(project.packages.map((p) => p.ownerId));
  const waiting = project.members.filter(
    (m) => m.id !== leader.id && m.packageReminderAt === null && needsPackage(m, project, owners.has(m.id)),
  );
  if (waiting.length === 0) return;
  await tx.member.updateMany({ where: { id: { in: waiting.map((m) => m.id) } }, data: { packageReminderAt: now } });
  for (const m of waiting) {
    await notify(tx, {
      userIds: [leader.userId],
      projectId,
      type: "MEMBER_NEEDS_PACKAGE",
      audience: "ONLY_LEADER",
      payload: { member: { memberId: m.id, name: m.user.name }, joined: m.id === opts.joinedMemberId },
      now,
    });
  }
}
