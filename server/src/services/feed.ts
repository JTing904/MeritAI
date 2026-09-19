// The project feed (动态, spec §9).
import type { ActivityPayload, ActivityView, FeedPage } from "../../../shared/types";
import type { Prisma } from "../generated/prisma/client";
import type { Db } from "../lib/db";
import { olderThan, unknownCursor } from "./notifications";
import type { PageQuery } from "./schemas";

/** Newest first. `cursor` is the id of the last entry already shown. */
export async function loadFeed(db: Db, projectId: string, query: PageQuery): Promise<FeedPage> {
  const where: Prisma.ActivityEventWhereInput[] = [{ projectId }];
  if (query.cursor) {
    const cursor = await db.activityEvent.findFirst({ where: { id: query.cursor, projectId }, select: { id: true, createdAt: true } });
    if (!cursor) throw unknownCursor();
    where.push(olderThan(cursor));
  }
  const rows = await db.activityEvent.findMany({
    where: { AND: where },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: query.limit + 1,
    include: { actor: { select: { id: true, color: true, user: { select: { name: true } } } } },
  });

  const page = rows.slice(0, query.limit);
  const items: ActivityView[] = page.map((e) => ({
    id: e.id,
    type: e.type,
    createdAt: e.createdAt.toISOString(),
    actor: e.actor ? { memberId: e.actor.id, name: e.actor.user.name, color: e.actor.color } : null,
    payload: e.payload as ActivityPayload,
  }));
  return { items, nextCursor: rows.length > query.limit ? page.at(-1)!.id : null };
}
