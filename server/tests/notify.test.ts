// Step 0 shared services: lockAsMember (services/tx.ts) and services/notify.ts.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { NotificationPayload } from "../../shared/types";
import { AppError } from "../src/lib/errors";
import {
  bumpPackages,
  expireSwaps,
  notify,
  recordEvent,
  remindPackageless,
  voidSwaps,
} from "../src/services/notify";
import { lockAsMember, TX_OPTIONS } from "../src/services/tx";
import { testDb } from "./helpers";
import { activeWith, DAY, freshDb, joinCode, person } from "./project-fixtures";

beforeEach(freshDb);
afterAll(() => testDb.$disconnect());

const HOUR = 60 * 60 * 1000;

/** A 3-person team; package n is owned by person n−1 when `owned`. Members as rows: [leader, A, B]. */
async function team({ owned = true } = {}) {
  const t = await activeWith(3);
  const rows = await testDb.member.findMany({ where: { projectId: t.projectId }, include: { user: true } });
  const byUser = (userId: string) => rows.find((m) => m.userId === userId)!;
  const members = [byUser(t.leader.user.id), ...t.members.map((p) => byUser(p.user.id))];
  const packages = await testDb.package.findMany({ where: { projectId: t.projectId }, orderBy: { index: "asc" } });
  if (owned) {
    for (const [i, pkg] of packages.entries()) {
      await testDb.package.update({ where: { id: pkg.id }, data: { ownerId: members[i]!.id } });
    }
  }
  return { ...t, rows: members, packages };
}

type Member = Awaited<ReturnType<typeof team>>["rows"][number];

function swap(projectId: string, requester: Member, target: Member, createdAt: Date) {
  return testDb.swapRequest.create({
    data: {
      projectId,
      requesterId: requester.id,
      targetId: target.id,
      createdAt,
      expiresAt: new Date(createdAt.getTime() + 72 * HOUR),
    },
  });
}

const notificationsOf = (userId: string, type?: NotificationPayload["type"]) =>
  testDb.notification.findMany({ where: { userId, ...(type ? { type } : {}) }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });

async function failure(promise: Promise<unknown>) {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  return err as AppError;
}

describe("lockAsMember", () => {
  it("returns the locked project and the actor's fresh membership", async () => {
    const t = await team({ owned: false });
    const { project, member } = await testDb.$transaction((tx) => lockAsMember(tx, t.projectId, t.members[0]!.user.id), TX_OPTIONS);
    expect(project.id).toBe(t.projectId);
    expect(member).toMatchObject({ id: t.rows[1]!.id, role: "MEMBER" });
  });

  it("404s strangers and people who left, 403s non-leaders for leader writes, 409s ended projects", async () => {
    const t = await team({ owned: false });
    const stranger = await person(5);
    const run = (userId: string, leader = false) =>
      testDb.$transaction((tx) => lockAsMember(tx, t.projectId, userId, { leader }), TX_OPTIONS);

    expect((await failure(run(stranger.user.id))).status).toBe(404);
    expect((await failure(run(t.members[0]!.user.id, true))).code).toBe("FORBIDDEN");
    await expect(run(t.leader.user.id, true)).resolves.toMatchObject({ member: { role: "LEADER" } });

    await testDb.member.update({ where: { id: t.rows[2]!.id }, data: { leftAt: new Date() } });
    expect((await failure(run(t.members[1]!.user.id))).status).toBe(404);

    await testDb.project.update({ where: { id: t.projectId }, data: { status: "ENDED" } });
    expect((await failure(run(t.leader.user.id))).code).toBe("PROJECT_ENDED");
  });
});

describe("notify, recordEvent, bumpPackages", () => {
  it("writes one row per recipient with the payload's type, `mine` per recipient", async () => {
    const t = await team();
    const [leader, a, b] = t.rows;
    const now = new Date("2026-09-20T10:00:00Z");
    await testDb.$transaction((tx) =>
      notify(tx, {
        userIds: [a!.userId, b!.userId, a!.userId],
        projectId: t.projectId,
        type: "MEMBER_LEFT",
        audience: "GROUP",
        mine: (userId) => userId === b!.userId,
        payload: { member: { memberId: leader!.id, name: leader!.user.name }, unfinishedCount: 2 },
        now,
      }),
    );
    const [forA, forB] = [await notificationsOf(a!.userId), await notificationsOf(b!.userId)];
    expect(forA).toHaveLength(1);
    expect(forA[0]).toMatchObject({ type: "MEMBER_LEFT", audience: "GROUP", mine: false, readAt: null, swapId: null, createdAt: now });
    expect(forA[0]!.payload).toEqual({ type: "MEMBER_LEFT", member: { memberId: leader!.id, name: "陈思远" }, unfinishedCount: 2 });
    expect(forB[0]).toMatchObject({ mine: true });
    expect(await notificationsOf(leader!.userId)).toHaveLength(0);
  });

  it("records feed events and bumps the packages version", async () => {
    const t = await team();
    const before = (await testDb.project.findUniqueOrThrow({ where: { id: t.projectId } })).packagesVersion;
    const version = await testDb.$transaction(async (tx) => {
      await recordEvent(tx, { projectId: t.projectId, actorId: t.rows[1]!.id, type: "PICKED", payload: { packageIndex: 2 } });
      return bumpPackages(tx, t.projectId);
    });
    expect(version).toBe(before + 1);
    const events = await testDb.activityEvent.findMany({ where: { projectId: t.projectId, type: "PICKED" } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actorId: t.rows[1]!.id, payload: { type: "PICKED", packageIndex: 2 } });
  });
});

describe("expireSwaps", () => {
  it("expires pending swaps past 72 h once, telling the requester", async () => {
    const t = await team();
    const [leader, a, b] = t.rows;
    const now = new Date();
    const old = await swap(t.projectId, a!, b!, new Date(now.getTime() - 73 * HOUR));
    const fresh = await swap(t.projectId, leader!, b!, new Date(now.getTime() - HOUR));

    const expired = await testDb.$transaction((tx) => expireSwaps(tx, { projectId: t.projectId }, now));
    expect(expired).toEqual([old.id]);
    expect(await testDb.swapRequest.findUniqueOrThrow({ where: { id: old.id } })).toMatchObject({ status: "EXPIRED", respondedAt: now });
    expect(await testDb.swapRequest.findUniqueOrThrow({ where: { id: fresh.id } })).toMatchObject({ status: "PENDING" });

    const sent = await notificationsOf(a!.userId, "SWAP_EXPIRED");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ audience: "ONLY_YOU", swapId: old.id, projectId: t.projectId });
    expect(sent[0]!.payload).toEqual({ type: "SWAP_EXPIRED", target: { memberId: b!.id, name: b!.user.name } });

    // Again (and at exactly 72 h for the other one): nothing more for the first.
    await testDb.$transaction((tx) => expireSwaps(tx, { projectId: t.projectId }, new Date(fresh.expiresAt)));
    expect(await notificationsOf(a!.userId, "SWAP_EXPIRED")).toHaveLength(1);
    expect(await notificationsOf(leader!.userId, "SWAP_EXPIRED")).toHaveLength(1);
  });

  it("sends SWAP_EXPIRED once when two readers expire at the same time", async () => {
    const t = await team();
    const [, a, b] = t.rows;
    const now = new Date();
    await swap(t.projectId, a!, b!, new Date(now.getTime() - 80 * HOUR));
    const results = await Promise.all(
      [0, 1].map(() => testDb.$transaction((tx) => expireSwaps(tx, { projectId: t.projectId }, now), TX_OPTIONS)),
    );
    expect(results.flat()).toHaveLength(1);
    expect(await notificationsOf(a!.userId, "SWAP_EXPIRED")).toHaveLength(1);
  });
});

describe("voidSwaps", () => {
  it("expires first, voids the rest, and tells requesters other than the one who caused it", async () => {
    const t = await team();
    const [leader, a, b] = t.rows;
    const now = new Date();
    const mine = await swap(t.projectId, a!, b!, new Date(now.getTime() - HOUR));
    const toMe = await swap(t.projectId, leader!, a!, new Date(now.getTime() - HOUR));
    const stale = await swap(t.projectId, b!, a!, new Date(now.getTime() - 100 * HOUR));
    const unrelated = await swap(t.projectId, leader!, b!, new Date(now.getTime() - HOUR));

    const voided = await testDb.$transaction((tx) =>
      voidSwaps(tx, { projectId: t.projectId, memberIds: [a!.id], reason: "STARTED", voidedById: a!.id, now, notify: true }),
    );
    expect(voided.sort()).toEqual([mine.id, toMe.id].sort());
    const rows = await testDb.swapRequest.findMany({ where: { projectId: t.projectId } });
    const status = (id: string) => rows.find((r) => r.id === id)!;
    expect(status(mine.id)).toMatchObject({ status: "VOID", voidReason: "STARTED", voidedById: a!.id, respondedAt: now });
    expect(status(toMe.id)).toMatchObject({ status: "VOID", voidReason: "STARTED" });
    expect(status(stale.id)).toMatchObject({ status: "EXPIRED", voidReason: null });
    expect(status(unrelated.id)).toMatchObject({ status: "PENDING" });

    // The leader asked A, and A started: SWAP_VOID. A caused it: nothing for A. B's stale one expired.
    const forLeader = await notificationsOf(leader!.userId, "SWAP_VOID");
    expect(forLeader).toHaveLength(1);
    expect(forLeader[0]!.payload).toEqual({ type: "SWAP_VOID", target: { memberId: a!.id, name: a!.user.name }, reason: "STARTED" });
    expect(await notificationsOf(a!.userId)).toHaveLength(0);
    expect(await notificationsOf(b!.userId, "SWAP_EXPIRED")).toHaveLength(1);
    expect(await notificationsOf(b!.userId, "SWAP_VOID")).toHaveLength(0);
  });

  it("never notifies for a re-split, nor an inactive requester", async () => {
    const t = await team();
    const [leader, a, b] = t.rows;
    const now = new Date();
    await swap(t.projectId, leader!, b!, new Date(now.getTime() - HOUR));
    const fromGone = await swap(t.projectId, a!, b!, new Date(now.getTime() - HOUR));
    await testDb.member.update({ where: { id: a!.id }, data: { leftAt: now } });

    await testDb.$transaction((tx) =>
      voidSwaps(tx, { projectId: t.projectId, memberIds: [a!.id], reason: "LEFT", voidedById: b!.id, now, notify: true }),
    );
    expect(await testDb.swapRequest.findUniqueOrThrow({ where: { id: fromGone.id } })).toMatchObject({ status: "VOID", voidReason: "LEFT" });
    expect(await notificationsOf(a!.userId)).toHaveLength(0);

    const voided = await testDb.$transaction((tx) =>
      voidSwaps(tx, { projectId: t.projectId, all: true, reason: "RESPLIT", voidedById: leader!.id, now, notify: true }),
    );
    expect(voided).toHaveLength(1);
    expect(await testDb.swapRequest.count({ where: { projectId: t.projectId, status: "PENDING" } })).toBe(0);
    expect(await testDb.notification.count({ where: { type: "SWAP_VOID" } })).toBe(0);
  });

  it("does nothing without members or `all`", async () => {
    const t = await team();
    await swap(t.projectId, t.rows[1]!, t.rows[2]!, new Date());
    const voided = await testDb.$transaction((tx) =>
      voidSwaps(tx, { projectId: t.projectId, memberIds: [], reason: "SWITCHED", voidedById: null, now: new Date(), notify: true }),
    );
    expect(voided).toEqual([]);
    expect(await testDb.swapRequest.count({ where: { status: "PENDING" } })).toBe(1);
  });
});

describe("remindPackageless", () => {
  it("tells the leader once about a member left without a package, and re-arms when they get one", async () => {
    const t = await team();
    const [leader] = t.rows;
    const remind = (joinedMemberId?: string) =>
      testDb.$transaction((tx) => remindPackageless(tx, t.projectId, { joinedMemberId, now: new Date() }));

    // Everyone has a package: nothing to say.
    await remind();
    expect(await notificationsOf(leader!.userId, "MEMBER_NEEDS_PACKAGE")).toHaveLength(0);

    // A 4th person joins while every package is taken.
    const late = await person(3);
    expect((await joinCode(late.token, t.view.inviteCode!)).status).toBe(200);
    const lateRow = await testDb.member.findFirstOrThrow({ where: { projectId: t.projectId, userId: late.user.id } });
    await remind(lateRow.id);
    await remind(lateRow.id);
    const sent = await notificationsOf(leader!.userId, "MEMBER_NEEDS_PACKAGE");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ audience: "ONLY_LEADER", mine: true });
    expect(sent[0]!.payload).toEqual({ type: "MEMBER_NEEDS_PACKAGE", member: { memberId: lateRow.id, name: "张博文" }, joined: true });
    expect((await testDb.member.findUniqueOrThrow({ where: { id: lateRow.id } })).packageReminderAt).not.toBeNull();

    // They take the leader's package: their reminder clears. Now the leader has none, but is never told about themself.
    await testDb.package.update({ where: { id: t.packages[0]!.id }, data: { ownerId: lateRow.id } });
    await remind();
    expect((await testDb.member.findUniqueOrThrow({ where: { id: lateRow.id } })).packageReminderAt).toBeNull();
    expect(await notificationsOf(leader!.userId, "MEMBER_NEEDS_PACKAGE")).toHaveLength(1);

    // A free package means no reminder.
    await testDb.package.update({ where: { id: t.packages[1]!.id }, data: { ownerId: null } });
    await remind();
    expect(await notificationsOf(leader!.userId, "MEMBER_NEEDS_PACKAGE")).toHaveLength(1);
  });

  it("skips the leader who only manages and reports everyone else waiting", async () => {
    const t = await activeWith(3, { leaderManages: true });
    const packages = await testDb.package.findMany({ where: { projectId: t.projectId }, orderBy: { index: "asc" } });
    const rows = await testDb.member.findMany({ where: { projectId: t.projectId, role: "MEMBER" }, orderBy: { joinedAt: "asc" } });
    // Two packages, both taken by the first member and a 4th person; the second member is left out.
    const extra = await person(3);
    await joinCode(extra.token, t.view.inviteCode!);
    const extraRow = await testDb.member.findFirstOrThrow({ where: { projectId: t.projectId, userId: extra.user.id } });
    await testDb.package.update({ where: { id: packages[0]!.id }, data: { ownerId: rows[0]!.id } });
    await testDb.package.update({ where: { id: packages[1]!.id }, data: { ownerId: extraRow.id } });

    await testDb.$transaction((tx) => remindPackageless(tx, t.projectId, { now: new Date(Date.now() + DAY) }));
    const sent = await notificationsOf(t.leader.user.id, "MEMBER_NEEDS_PACKAGE");
    expect(sent.map((n) => n.payload)).toEqual([
      { type: "MEMBER_NEEDS_PACKAGE", member: { memberId: rows[1]!.id, name: "王子杰" }, joined: false },
    ]);
  });
});
