// The 通知 tab API (srv-core, spec §6/§8): list, pagination, 「跟我有关」, read state, unread count, lazy swap expiry.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { NotificationPage, ProjectView, UnreadCount } from "../../shared/types";
import { notify } from "../src/services/notify";
import { TX_OPTIONS } from "../src/services/tx";
import { call, testDb } from "./helpers";
import { activeWith, freshDb, viewAs } from "./project-fixtures";

beforeEach(freshDb);
afterAll(() => testDb.$disconnect());

const HOUR = 60 * 60 * 1000;
const T0 = new Date("2026-09-20T02:00:00Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

async function team(n = 3) {
  const t = await activeWith(n);
  const idOf = (userId: string) => t.view.members.find((m) => m.userId === userId)!.id;
  return {
    ...t,
    leaderId: idOf(t.leader.user.id),
    memberIds: t.members.map((p) => idOf(p.user.id)),
    packages: [...t.view.packages].sort((a, b) => a.index - b.index),
  };
}

/** A PACKAGE_ASSIGNED for `userId` at `when` (any type would do). */
function send(userId: string, projectId: string | null, when: Date, { mine = true, packageIndex = 1 } = {}) {
  return testDb.$transaction((tx) =>
    notify(tx, { userIds: [userId], projectId, type: "PACKAGE_ASSIGNED", audience: "ONLY_YOU", mine, payload: { packageIndex }, now: when }),
  );
}

const list = (token: string, query = "") => call<NotificationPage>(`/api/notifications${query}`, { token });
const unread = (token: string) => call<UnreadCount>("/api/notifications/unread-count", { token });
const markRead = (token: string, upToId: string) => call<UnreadCount>("/api/notifications/read", { method: "POST", token, body: { upToId } });

/** Five notifications for the leader, a minute apart; the 2nd and 4th are not 「跟我有关」. Newest first. */
async function five(t: Awaited<ReturnType<typeof team>>) {
  for (let i = 0; i < 5; i++) await send(t.leader.user.id, t.projectId, at(i), { mine: i % 2 === 0, packageIndex: i + 1 });
  return (await list(t.leader.token)).data.items;
}

describe("GET /api/notifications", () => {
  it("lists the viewer's notifications newest first, with the project's tag and colour as they are now", async () => {
    const t = await team();
    await send(t.leader.user.id, t.projectId, at(0), { packageIndex: 1 });
    await send(t.leader.user.id, t.projectId, at(1), { packageIndex: 2, mine: false });
    await send(t.members[0]!.user.id, t.projectId, at(2));

    const res = await list(t.leader.token);
    expect(res.status).toBe(200);
    expect(res.data.nextCursor).toBeNull();
    expect(res.data.unreadCount).toBe(2);
    expect(res.data.items).toEqual([
      {
        id: expect.any(String),
        type: "PACKAGE_ASSIGNED",
        projectId: t.projectId,
        projectTag: "CS302",
        projectColor: "lemon",
        audience: "ONLY_YOU",
        mine: false,
        createdAt: at(1).toISOString(),
        read: false,
        payload: { type: "PACKAGE_ASSIGNED", packageIndex: 2 },
        swap: null,
        projectOpen: true,
      },
      expect.objectContaining({ createdAt: at(0).toISOString(), mine: true, payload: { type: "PACKAGE_ASSIGNED", packageIndex: 1 } }),
    ]);

    // The tag follows the project: renaming its short code changes old notifications too.
    await call(`/api/projects/${t.projectId}`, { method: "PATCH", token: t.leader.token, body: { shortCode: null, name: "毕业设计" } });
    expect((await list(t.leader.token)).data.items.map((n) => n.projectTag)).toEqual(["毕业设计", "毕业设计"]);
  });

  it("pages with cursor and limit, in a stable order when times tie", async () => {
    const t = await team();
    const items = await five(t);
    expect(items.map((n) => n.createdAt)).toEqual([4, 3, 2, 1, 0].map((m) => at(m).toISOString()));
    // Three more at the same moment: the id breaks the tie.
    for (let i = 0; i < 3; i++) await send(t.leader.user.id, t.projectId, at(10));
    const all = (await list(t.leader.token)).data.items;
    expect(all).toHaveLength(8);
    const tied = all.slice(0, 3).map((n) => n.id);
    expect(tied).toEqual([...tied].sort().reverse());

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page: NotificationPage = (await list(t.leader.token, `?limit=3${cursor ? `&cursor=${cursor}` : ""}`)).data;
      seen.push(...page.items.map((n) => n.id));
      cursor = page.nextCursor;
      if (cursor) expect(cursor).toBe(page.items.at(-1)!.id);
      pages++;
    } while (cursor);
    expect(pages).toBe(3);
    expect(seen).toEqual(all.map((n) => n.id));
    // Exactly a page's worth left: the last page ends the list.
    const two = (await list(t.leader.token, `?limit=2&cursor=${all[5]!.id}`)).data;
    expect(two.items.map((n) => n.id)).toEqual(all.slice(6).map((n) => n.id));
    expect(two.nextCursor).toBeNull();
    // Blank parameters count as left out.
    expect((await list(t.leader.token, "?cursor=&limit=")).data.items).toHaveLength(8);
  });

  it("shows only 「跟我有关」 with mine=1, paging within it", async () => {
    const t = await team();
    const items = await five(t);
    const mine = (await list(t.leader.token, "?mine=1")).data;
    expect(mine.items.map((n) => n.id)).toEqual(items.filter((n) => n.mine).map((n) => n.id));
    expect(mine.unreadCount).toBe(5);
    const first = (await list(t.leader.token, "?mine=true&limit=1")).data;
    const second = (await list(t.leader.token, `?mine=1&limit=5&cursor=${first.nextCursor}`)).data;
    expect([...first.items, ...second.items].map((n) => n.mine)).toEqual([true, true, true]);
    expect(second.nextCursor).toBeNull();
  });

  it("returns 30 by default and at most 50", async () => {
    const t = await team(2);
    await testDb.notification.createMany({
      data: Array.from({ length: 55 }, (_, i) => ({
        userId: t.leader.user.id,
        projectId: t.projectId,
        type: "PACKAGE_ASSIGNED" as const,
        audience: "ONLY_YOU" as const,
        payload: { type: "PACKAGE_ASSIGNED", packageIndex: 1 },
        createdAt: at(i),
      })),
    });
    expect((await list(t.leader.token)).data.items).toHaveLength(30);
    expect((await list(t.leader.token, "?limit=500")).data.items).toHaveLength(50);
    expect((await list(t.leader.token, "?limit=0")).error?.code).toBe("VALIDATION");
    expect((await list(t.leader.token, "?limit=abc")).error?.code).toBe("VALIDATION");
  });

  it("refuses a cursor that isn't one of the viewer's notifications", async () => {
    const t = await team();
    await send(t.members[0]!.user.id, t.projectId, at(0));
    const theirs = (await list(t.members[0]!.token)).data.items[0]!.id;
    expect((await list(t.leader.token, `?cursor=${theirs}`)).error?.code).toBe("VALIDATION");
    expect((await list(t.leader.token, "?cursor=nope")).error?.code).toBe("VALIDATION");
  });

  it("shows each swap as it is now: pending, expired once past its time, void and who voided it", async () => {
    const t = await team();
    const [aId, bId] = t.memberIds as [string, string];
    const [p1, p2] = t.packages;
    const now = Date.now();
    const mk = (status: "PENDING" | "VOID", createdAt: number, extra = {}) =>
      testDb.swapRequest.create({
        data: {
          projectId: t.projectId,
          requesterId: aId,
          targetId: bId,
          requesterPackageId: p1!.id,
          targetPackageId: p2!.id,
          status,
          createdAt: new Date(createdAt),
          expiresAt: new Date(createdAt + 72 * HOUR),
          ...extra,
        },
      });
    const pending = await mk("PENDING", now - HOUR);
    const stale = await mk("PENDING", now - 80 * HOUR);
    const voidedByA = await mk("VOID", now - 2 * HOUR, { voidReason: "SWITCHED", voidedById: aId, respondedAt: new Date() });
    const voidedByB = await mk("VOID", now - 3 * HOUR, { voidReason: "STARTED", voidedById: bId, respondedAt: new Date() });
    const requester = { memberId: aId, name: "林晓雯" };
    for (const [i, swap] of [voidedByB, voidedByA, stale, pending].entries()) {
      await testDb.$transaction((tx) =>
        notify(tx, {
          userIds: [t.members[1]!.user.id],
          projectId: t.projectId,
          type: "SWAP_REQUEST",
          audience: null,
          payload: { requester, requesterPackageIndex: 1, targetPackageIndex: 2 },
          swapId: swap.id,
          now: new Date(now - (4 - i) * 60_000),
        }),
      );
    }

    const items = (await list(t.members[1]!.token)).data.items;
    expect(items.map((n) => [n.type, n.audience, n.swap])).toEqual([
      ["SWAP_REQUEST", null, { id: pending.id, status: "PENDING", voidReason: null, voidedByRequester: false }],
      ["SWAP_REQUEST", null, { id: stale.id, status: "EXPIRED", voidReason: null, voidedByRequester: false }],
      ["SWAP_REQUEST", null, { id: voidedByA.id, status: "VOID", voidReason: "SWITCHED", voidedByRequester: true }],
      ["SWAP_REQUEST", null, { id: voidedByB.id, status: "VOID", voidReason: "STARTED", voidedByRequester: false }],
    ]);
    // Reading the list expired the stale one for real, and told its requester.
    expect(await testDb.swapRequest.findUniqueOrThrow({ where: { id: stale.id } })).toMatchObject({ status: "EXPIRED" });
    const expired = await testDb.notification.findMany({ where: { userId: t.members[0]!.user.id, type: "SWAP_EXPIRED" } });
    expect(expired.map((n) => [n.swapId, n.payload])).toEqual([
      [stale.id, { type: "SWAP_EXPIRED", target: { memberId: bId, name: "王子杰" } }],
    ]);
    // A notification about a swap that no longer exists shows no state.
    await testDb.swapRequest.delete({ where: { id: voidedByB.id } });
    expect((await list(t.members[1]!.token)).data.items.at(-1)!.swap).toBeNull();
  });

  it("says whether the project can still be opened; notifications without a project have no tag", async () => {
    const t = await team();
    await send(t.members[0]!.user.id, t.projectId, at(0));
    await send(t.members[0]!.user.id, null, at(1));
    expect((await list(t.members[0]!.token)).data.items.map((n) => [n.projectTag, n.projectColor, n.projectOpen])).toEqual([
      [null, null, false],
      ["CS302", "lemon", true],
    ]);
    await call(`/api/projects/${t.projectId}/leave`, { method: "POST", token: t.members[0]!.token });
    expect((await list(t.members[0]!.token)).data.items.map((n) => n.projectOpen)).toEqual([false, false]);
    // Removed: the REMOVED_YOU notification can't open the project either.
    await call(`/api/projects/${t.projectId}/members/${t.memberIds[1]}/remove`, { method: "POST", token: t.leader.token });
    const removed = (await list(t.members[1]!.token)).data.items;
    expect(removed.map((n) => [n.type, n.projectOpen, n.projectTag])).toEqual([["REMOVED_YOU", false, "CS302"], ["MEMBER_LEFT", false, "CS302"]]);
  });

  it("requires sign-in", async () => {
    expect((await call("/api/notifications")).status).toBe(401);
    expect((await call("/api/notifications/unread-count")).status).toBe(401);
    expect((await call("/api/notifications/read", { method: "POST", body: { upToId: "x" } })).status).toBe(401);
  });
});

describe("unread count and marking read", () => {
  it("marks the given notification and everything older as read, and returns what is left", async () => {
    const t = await team();
    const items = await five(t);
    expect((await unread(t.leader.token)).data).toEqual({ count: 5 });

    // The 通知 tab loaded a page whose first item is the 3rd newest; two came in above it since.
    const res = await markRead(t.leader.token, items[2]!.id);
    expect(res).toMatchObject({ status: 200, data: { count: 2 } });
    const after = (await list(t.leader.token)).data;
    expect(after.items.map((n) => n.read)).toEqual([false, false, true, true, true]);
    expect(after.unreadCount).toBe(2);
    const readAt = (await testDb.notification.findUniqueOrThrow({ where: { id: items[4]!.id } })).readAt;
    expect(readAt).not.toBeNull();

    // Again with the newest: all read; marking again changes nothing (the first read time stays).
    expect((await markRead(t.leader.token, items[0]!.id)).data).toEqual({ count: 0 });
    expect((await markRead(t.leader.token, items[0]!.id)).data).toEqual({ count: 0 });
    expect((await testDb.notification.findUniqueOrThrow({ where: { id: items[4]!.id } })).readAt).toEqual(readAt);
    expect((await unread(t.leader.token)).data).toEqual({ count: 0 });
    // Someone else's list is untouched.
    await send(t.members[0]!.user.id, t.projectId, at(0));
    expect((await unread(t.members[0]!.token)).data).toEqual({ count: 1 });
  });

  it("marks ties on the time by id, like the list order", async () => {
    const t = await team(2);
    for (let i = 0; i < 3; i++) await send(t.leader.user.id, t.projectId, at(0));
    const items = (await list(t.leader.token)).data.items;
    expect((await markRead(t.leader.token, items[1]!.id)).data).toEqual({ count: 1 });
    expect((await list(t.leader.token)).data.items.map((n) => n.read)).toEqual([false, true, true]);
  });

  it("only takes one of the viewer's own notification ids", async () => {
    const t = await team();
    await send(t.members[0]!.user.id, t.projectId, at(0));
    const theirs = (await list(t.members[0]!.token)).data.items[0]!.id;
    expect((await markRead(t.leader.token, theirs)).status).toBe(404);
    expect((await markRead(t.leader.token, "nope")).status).toBe(404);
    expect((await call("/api/notifications/read", { method: "POST", token: t.leader.token, body: {} })).error?.code).toBe("VALIDATION");
    expect((await unread(t.members[0]!.token)).data).toEqual({ count: 1 });
  });
});

describe("lazy swap expiry on reads", () => {
  /** A → B asked 80 h ago (so it ran out 8 h ago), still stored as PENDING. */
  async function staleSwap() {
    const t = await team();
    const [aId, bId] = t.memberIds as [string, string];
    for (const [i, id] of [aId, bId].entries()) {
      await testDb.package.update({ where: { id: t.packages[i]!.id }, data: { ownerId: id } });
    }
    const createdAt = new Date(Date.now() - 80 * HOUR);
    const swap = await testDb.swapRequest.create({
      data: {
        projectId: t.projectId,
        requesterId: aId,
        targetId: bId,
        requesterPackageId: t.packages[0]!.id,
        targetPackageId: t.packages[1]!.id,
        createdAt,
        expiresAt: new Date(createdAt.getTime() + 72 * HOUR),
      },
    });
    return { ...t, swap };
  }

  const expiredNotes = (userId: string) => testDb.notification.count({ where: { userId, type: "SWAP_EXPIRED" } });

  it("expires the viewer's swaps on the unread count, once even when two reads race", async () => {
    const t = await staleSwap();
    const [x, y] = await Promise.all([unread(t.members[0]!.token), unread(t.members[0]!.token)]);
    expect([x.data, y.data]).toEqual([{ count: 1 }, { count: 1 }]);
    expect(await expiredNotes(t.members[0]!.user.id)).toBe(1);
    expect(await testDb.swapRequest.findUniqueOrThrow({ where: { id: t.swap.id } })).toMatchObject({ status: "EXPIRED" });
  });

  it("expires them when the target reads the list too", async () => {
    const t = await staleSwap();
    const page = (await list(t.members[1]!.token)).data;
    expect(page.items).toEqual([]);
    expect(await expiredNotes(t.members[0]!.user.id)).toBe(1);
    const forA = (await list(t.members[0]!.token)).data.items;
    expect(forA.map((n) => [n.type, n.swap?.status])).toEqual([["SWAP_EXPIRED", "EXPIRED"]]);
  });

  it("leaves other people's swaps alone", async () => {
    const t = await staleSwap();
    await unread(t.leader.token);
    await list(t.leader.token);
    expect(await testDb.swapRequest.findUniqueOrThrow({ where: { id: t.swap.id } })).toMatchObject({ status: "PENDING" });
  });

  it("expires the project's swaps when anyone opens the project, and the view never shows them", async () => {
    const t = await staleSwap();
    // Even before it is marked, the view treats it as gone.
    const view = (await call<ProjectView>(`/api/projects/${t.projectId}`, { token: t.leader.token })).data;
    expect(view.swaps).toEqual([]);
    expect(await testDb.swapRequest.findUniqueOrThrow({ where: { id: t.swap.id } })).toMatchObject({ status: "EXPIRED" });
    expect(await expiredNotes(t.members[0]!.user.id)).toBe(1);
    await Promise.all([viewAs(t.members[0]!.token, t.projectId), viewAs(t.members[1]!.token, t.projectId)]);
    expect(await expiredNotes(t.members[0]!.user.id)).toBe(1);
  });

  it("uses the same lock order as writes, so a read racing a write doesn't deadlock", async () => {
    const t = await staleSwap();
    const results = await Promise.all([
      unread(t.members[0]!.token),
      testDb.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${t.projectId} FOR UPDATE`;
        await tx.swapRequest.updateMany({ where: { id: t.swap.id, status: "PENDING" }, data: { status: "CANCELLED" } });
      }, TX_OPTIONS),
    ]);
    expect(results[0].status).toBe(200);
    const row = await testDb.swapRequest.findUniqueOrThrow({ where: { id: t.swap.id } });
    expect(["EXPIRED", "CANCELLED"]).toContain(row.status);
    expect(await expiredNotes(t.members[0]!.user.id)).toBe(row.status === "EXPIRED" ? 1 : 0);
  });
});
