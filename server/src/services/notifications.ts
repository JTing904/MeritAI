// The 通知 tab: list, unread count, mark read (spec §8).
import { projectTag } from "../../../shared/format";
import type { NotificationPage, NotificationPayload, NotificationView } from "../../../shared/types";
import type { Prisma } from "../generated/prisma/client";
import { isActiveMember } from "../lib/access";
import type { Db } from "../lib/db";
import { AppError, notFound } from "../lib/errors";
import { expireSwaps } from "./notify";
import type { NotificationQuery } from "./schemas";
import { TX_OPTIONS } from "./tx";
import { clock } from "../lib/clock";

/**
 * Lazy expiry for reads (GET project view, notifications, unread count). Cheap when nothing is due;
 * otherwise it locks the projects involved (in id order, as every write locks its project first) so
 * it can't deadlock with a swap write touching the same rows.
 */
export async function expireDueSwaps(db: Db, where: Prisma.SwapRequestWhereInput, now: Date): Promise<void> {
  const due = await db.swapRequest.findMany({
    where: { AND: [where, { status: "PENDING", expiresAt: { lte: now } }] },
    select: { projectId: true },
    distinct: ["projectId"],
  });
  if (due.length === 0) return;
  const projectIds = [...new Set(due.map((d) => d.projectId))].sort();
  await db.$transaction(async (tx) => {
    for (const id of projectIds) await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${id} FOR UPDATE`;
    await expireSwaps(tx, { AND: [where, { projectId: { in: projectIds } }] }, now);
  }, TX_OPTIONS);
}

/** Swaps where the user is either side, in any project. */
const swapsOf = (userId: string): Prisma.SwapRequestWhereInput => ({
  OR: [{ requester: { userId } }, { target: { userId } }],
});

/** Rows after `row` in list order (newest first: createdAt, then id, both descending). */
export const olderThan = (row: { createdAt: Date; id: string }) => ({
  OR: [{ createdAt: { lt: row.createdAt } }, { createdAt: row.createdAt, id: { lt: row.id } }],
});

export const unknownCursor = () => new AppError(400, "VALIDATION", "Unknown cursor");

const countUnreadRows = (db: Db, userId: string) => db.notification.count({ where: { userId, readAt: null } });

/** Newest first; expires the user's swaps first. `unreadCount` counts every unread row (the tab badge). */
export async function listNotifications(
  db: Db,
  userId: string,
  query: NotificationQuery,
  now = clock.now(),
): Promise<NotificationPage> {
  await expireDueSwaps(db, swapsOf(userId), now);

  const where: Prisma.NotificationWhereInput[] = [{ userId }];
  if (query.mine) where.push({ mine: true });
  if (query.cursor) {
    const cursor = await db.notification.findFirst({ where: { id: query.cursor, userId }, select: { id: true, createdAt: true } });
    if (!cursor) throw unknownCursor();
    where.push(olderThan(cursor));
  }
  const rows = await db.notification.findMany({
    where: { AND: where },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: query.limit + 1,
    include: {
      project: {
        select: {
          name: true,
          shortCode: true,
          color: true,
          deletedAt: true,
          members: { where: { userId }, select: { leftAt: true, removed: true } },
        },
      },
      swap: { select: { id: true, status: true, voidReason: true, voidedById: true, requesterId: true, expiresAt: true } },
    },
  });

  const page = rows.slice(0, query.limit);
  const items: NotificationView[] = page.map((n) => ({
    id: n.id,
    type: n.type,
    projectId: n.projectId,
    projectTag: n.project ? projectTag(n.project.name, n.project.shortCode) : null,
    projectColor: n.project?.color ?? null,
    audience: n.audience,
    mine: n.mine,
    createdAt: n.createdAt.toISOString(),
    read: n.readAt !== null,
    payload: n.payload as NotificationPayload,
    swap: n.swap
      ? {
          id: n.swap.id,
          status: n.swap.status === "PENDING" && n.swap.expiresAt <= now ? "EXPIRED" : n.swap.status,
          voidReason: n.swap.voidReason,
          voidedByRequester: n.swap.voidedById !== null && n.swap.voidedById === n.swap.requesterId,
        }
      : null,
    // A project deleted for everyone can't be opened (its notifications stay until it is purged).
    projectOpen: n.project !== null && n.project.deletedAt === null && n.project.members.some(isActiveMember),
  }));

  return {
    items,
    nextCursor: rows.length > query.limit ? page.at(-1)!.id : null,
    unreadCount: await countUnreadRows(db, userId),
  };
}

/** Unread notifications (expires the user's swaps first, which may add SWAP_EXPIRED). */
export async function countUnread(db: Db, userId: string, now = clock.now()): Promise<number> {
  await expireDueSwaps(db, swapsOf(userId), now);
  return countUnreadRows(db, userId);
}

/**
 * Marks `upToId` and everything older (list order) as read; returns the unread left, which is what
 * arrived after the list was loaded.
 */
export async function markRead(db: Db, userId: string, upToId: string, now = clock.now()): Promise<number> {
  const upTo = await db.notification.findFirst({ where: { id: upToId, userId }, select: { id: true, createdAt: true } });
  if (!upTo) throw notFound("Notification");
  await db.notification.updateMany({
    where: {
      userId,
      readAt: null,
      OR: [{ createdAt: { lt: upTo.createdAt } }, { createdAt: upTo.createdAt, id: { lte: upTo.id } }],
    },
    data: { readAt: now },
  });
  return countUnreadRows(db, userId);
}
