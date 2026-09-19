// Swap requests (互换, spec §2): ask, accept, decline, cancel, the one-request limit, expiry and voiding.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { LoginResult, NotificationPayload, ProjectView } from "../../shared/types";
import { call, testDb } from "./helpers";
import { activeWith, freshDb, person, pickAs, startAs } from "./project-fixtures";

beforeEach(freshDb);
afterAll(() => testDb.$disconnect());

const HOUR = 60 * 60 * 1000;

const packagesOf = (projectId: string) => testDb.package.findMany({ where: { projectId }, orderBy: { index: "asc" } });
const tasksIn = (packageId: string) => testDb.task.findMany({ where: { packageId }, orderBy: { number: "asc" } });
const notificationsOf = (userId: string, type?: NotificationPayload["type"]) =>
  testDb.notification.findMany({ where: { userId, ...(type ? { type } : {}) }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
const swapRow = (id: string) => testDb.swapRequest.findUniqueOrThrow({ where: { id } });

const ask = (token: string, projectId: string, packageId: string) =>
  call<ProjectView>(`/api/projects/${projectId}/swaps`, { method: "POST", token, body: { packageId } });
const answer = (token: string, swapId: string, action: "accept" | "decline" | "cancel") =>
  call<ProjectView>(`/api/swaps/${swapId}/${action}`, { method: "POST", token });

type Person = LoginResult & { memberId: string; name: string };

/**
 * `n` people; the first `picked` of them (leader first) pick packages 1, 2, … in order.
 * `people[0]` is the leader.
 */
async function team(n: number, picked = n, over: Parameters<typeof activeWith>[1] = {}) {
  const t = await activeWith(n, over);
  const logins = [t.leader, ...t.members];
  const people: Person[] = [];
  for (const p of logins) {
    const row = await testDb.member.findFirstOrThrow({ where: { projectId: t.projectId, userId: p.user.id }, include: { user: true } });
    people.push({ ...p, memberId: row.id, name: row.user.name });
  }
  for (let i = 0; i < picked; i++) {
    const res = await pickAs(people[i]!.token, t.projectId, i + 1);
    if (res.status !== 200) throw new Error(`pick failed: ${JSON.stringify(res.error)}`);
  }
  return { projectId: t.projectId, people, pkgs: await packagesOf(t.projectId) };
}

/** The pending request `from` just sent (throws unless the ask succeeded). */
async function askFor(projectId: string, from: Person, packageId: string) {
  const res = await ask(from.token, projectId, packageId);
  if (res.status !== 200) throw new Error(`ask failed: ${res.status} ${JSON.stringify(res.error)}`);
  return testDb.swapRequest.findFirstOrThrow({ where: { requesterId: from.memberId, status: "PENDING" } });
}

describe("POST /api/projects/:id/swaps", () => {
  it("asks the owner of another package, who is notified", async () => {
    const { projectId, people, pkgs } = await team(3);
    const [, a, b] = people;
    const res = await ask(a!.token, projectId, pkgs[2]!.id);
    expect(res.status).toBe(200);
    expect(res.data.viewerMemberId).toBe(a!.memberId);

    const swaps = await testDb.swapRequest.findMany({ where: { projectId } });
    expect(swaps).toHaveLength(1);
    const swap = swaps[0]!;
    expect(swap).toMatchObject({
      requesterId: a!.memberId,
      targetId: b!.memberId,
      requesterPackageId: pkgs[1]!.id,
      targetPackageId: pkgs[2]!.id,
      status: "PENDING",
      respondedAt: null,
    });
    expect(swap.expiresAt.getTime() - swap.createdAt.getTime()).toBe(72 * HOUR);

    const sent = await notificationsOf(b!.user.id, "SWAP_REQUEST");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ audience: null, mine: true, swapId: swap.id, projectId });
    expect(sent[0]!.payload).toEqual({
      type: "SWAP_REQUEST",
      requester: { memberId: a!.memberId, name: "林晓雯" },
      requesterPackageIndex: 2,
      targetPackageIndex: 3,
    });
  });

  it("refuses without an own package, for free or own packages, and when either side started", async () => {
    const { projectId, people, pkgs } = await team(4, 3);
    const [leader, a, b, c] = people;

    const none = await ask(c!.token, projectId, pkgs[1]!.id);
    expect([none.status, none.error!.code]).toEqual([409, "NEEDS_OWN_PACKAGE"]);
    const free = await ask(a!.token, projectId, pkgs[3]!.id);
    expect([free.status, free.error!.code]).toEqual([400, "VALIDATION"]);
    const own = await ask(a!.token, projectId, pkgs[1]!.id);
    expect([own.status, own.error!.code]).toEqual([400, "VALIDATION"]);
    expect((await ask(a!.token, projectId, "nope")).status).toBe(404);
    expect((await ask((await person(5)).token, projectId, pkgs[1]!.id)).status).toBe(404);

    const [bTask] = await tasksIn(pkgs[2]!.id);
    await startAs(b!.token, projectId, bTask!.id);
    const target = await ask(a!.token, projectId, pkgs[2]!.id);
    expect([target.status, target.error!.code]).toEqual([409, "TARGET_STARTED"]);
    const mine = await ask(b!.token, projectId, pkgs[0]!.id);
    expect([mine.status, mine.error!.code]).toEqual([409, "PACKAGE_STARTED"]);

    expect(await testDb.swapRequest.count({ where: { projectId } })).toBe(0);
    expect(await notificationsOf(leader!.user.id, "SWAP_REQUEST")).toHaveLength(0);
  });

  it("allows one pending request per person, while several people may ask the same person", async () => {
    const { projectId, people, pkgs } = await team(4);
    const [leader, a, b, c] = people;
    await askFor(projectId, a!, pkgs[2]!.id);
    const second = await ask(a!.token, projectId, pkgs[3]!.id);
    expect([second.status, second.error!.code]).toEqual([409, "SWAP_LIMIT"]);
    const again = await ask(a!.token, projectId, pkgs[2]!.id);
    expect(again.error!.code).toBe("SWAP_LIMIT");

    await askFor(projectId, c!, pkgs[2]!.id);
    // The person asked can ask someone else too, and ask back.
    await askFor(projectId, b!, pkgs[1]!.id);
    expect(await testDb.swapRequest.count({ where: { projectId, status: "PENDING" } })).toBe(3);
    expect(await notificationsOf(b!.user.id, "SWAP_REQUEST")).toHaveLength(2);
    expect(await notificationsOf(leader!.user.id)).toHaveLength(0);
  });
});

describe("POST /api/swaps/:id/accept", () => {
  it("trades the packages and the tasks each person held in them", async () => {
    const { projectId, people, pkgs } = await team(4);
    const [, x, y, other] = people;
    // X also holds a task in someone else's package; it stays X's (tasks follow the package, not the person).
    const [elsewhere] = await tasksIn(pkgs[3]!.id);
    await testDb.task.update({
      where: { id: elsewhere!.id },
      data: { ownerId: x!.memberId, status: "DOING", startedAt: new Date(), startedById: other!.memberId },
    });
    const aTasks = (await tasksIn(pkgs[1]!.id)).map((t) => t.id);
    const bTasks = (await tasksIn(pkgs[2]!.id)).map((t) => t.id);
    const swap = await askFor(projectId, x!, pkgs[2]!.id);
    const before = (await testDb.project.findUniqueOrThrow({ where: { id: projectId } })).packagesVersion;

    const res = await answer(y!.token, swap.id, "accept");
    expect(res.status).toBe(200);
    expect(res.data.viewerMemberId).toBe(y!.memberId);

    const after = await packagesOf(projectId);
    expect(after[1]!.ownerId).toBe(y!.memberId);
    expect(after[2]!.ownerId).toBe(x!.memberId);
    for (const id of aTasks) expect((await testDb.task.findUniqueOrThrow({ where: { id } })).ownerId).toBe(y!.memberId);
    for (const id of bTasks) expect((await testDb.task.findUniqueOrThrow({ where: { id } })).ownerId).toBe(x!.memberId);
    expect((await testDb.task.findUniqueOrThrow({ where: { id: elsewhere!.id } })).ownerId).toBe(x!.memberId);

    const row = await swapRow(swap.id);
    expect(row.status).toBe("ACCEPTED");
    expect(row.respondedAt).not.toBeNull();
    expect((await testDb.project.findUniqueOrThrow({ where: { id: projectId } })).packagesVersion).toBe(before + 1);

    const accepted = await notificationsOf(x!.user.id, "SWAP_ACCEPTED");
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toMatchObject({ audience: "ONLY_YOU", swapId: swap.id });
    expect(accepted[0]!.payload).toEqual({ type: "SWAP_ACCEPTED", target: { memberId: y!.memberId, name: "王子杰" }, targetPackageIndex: 3 });
    const events = await testDb.activityEvent.findMany({ where: { projectId, type: "SWAPPED" } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actorId: y!.memberId });
    expect(events[0]!.payload).toEqual({
      type: "SWAPPED",
      requester: { memberId: x!.memberId, name: "林晓雯" },
      requesterPackageIndex: 2,
      targetPackageIndex: 3,
    });
  });

  it("ends every other pending request of both people and tells those requesters", async () => {
    const { projectId, people, pkgs } = await team(5);
    const [leader, x, y, c, d] = people;
    const accepted = await askFor(projectId, x!, pkgs[2]!.id);
    const cToX = await askFor(projectId, c!, pkgs[1]!.id);
    const dToY = await askFor(projectId, d!, pkgs[2]!.id);
    const yToLeader = await askFor(projectId, y!, pkgs[0]!.id);

    expect((await answer(y!.token, accepted.id, "accept")).status).toBe(200);
    for (const s of [cToX, dToY, yToLeader]) {
      expect(await swapRow(s.id)).toMatchObject({ status: "VOID", voidReason: "SWAPPED_ELSEWHERE", voidedById: y!.memberId });
    }
    expect((await notificationsOf(c!.user.id, "SWAP_VOID")).map((n) => n.payload)).toEqual([
      { type: "SWAP_VOID", target: { memberId: x!.memberId, name: x!.name }, reason: "SWAPPED_ELSEWHERE" },
    ]);
    expect((await notificationsOf(d!.user.id, "SWAP_VOID")).map((n) => n.payload)).toEqual([
      { type: "SWAP_VOID", target: { memberId: y!.memberId, name: y!.name }, reason: "SWAPPED_ELSEWHERE" },
    ]);
    // Y accepted, so Y isn't told their own request ended; the leader was only asked.
    expect(await notificationsOf(y!.user.id, "SWAP_VOID")).toHaveLength(0);
    expect(await notificationsOf(leader!.user.id, "SWAP_VOID")).toHaveLength(0);
  });

  it("fails with SWAP_NOT_PENDING after the requester switched, and the request stays VOID", async () => {
    const { projectId, people, pkgs } = await team(4, 3);
    const [, x, y] = people;
    const swap = await askFor(projectId, x!, pkgs[2]!.id);
    expect((await pickAs(x!.token, projectId, 4)).status).toBe(200);

    const res = await answer(y!.token, swap.id, "accept");
    expect([res.status, res.error!.code]).toEqual([409, "SWAP_NOT_PENDING"]);
    expect(await swapRow(swap.id)).toMatchObject({ status: "VOID", voidReason: "SWITCHED", voidedById: x!.memberId });
    expect((await packagesOf(projectId))[2]!.ownerId).toBe(y!.memberId);
  });

  it("closes a request that no longer holds as VOID even though the accept fails", async () => {
    const { projectId, people, pkgs } = await team(4, 3);
    const [, x, y] = people;

    // X's package changed hands without the request being ended (anything unforeseen): VOID, SWITCHED.
    const moved = await askFor(projectId, x!, pkgs[2]!.id);
    await testDb.package.update({ where: { id: pkgs[1]!.id }, data: { ownerId: null } });
    await testDb.package.update({ where: { id: pkgs[3]!.id }, data: { ownerId: x!.memberId } });
    const first = await answer(y!.token, moved.id, "accept");
    expect(first.error!.code).toBe("SWAP_NOT_PENDING");
    expect(await swapRow(moved.id)).toMatchObject({ status: "VOID", voidReason: "SWITCHED", voidedById: x!.memberId });
    expect(await notificationsOf(x!.user.id, "SWAP_VOID")).toHaveLength(0);

    // Y's package got started behind the request's back: VOID, STARTED, and X is told.
    await testDb.package.update({ where: { id: pkgs[3]!.id }, data: { ownerId: null } });
    await testDb.package.update({ where: { id: pkgs[1]!.id }, data: { ownerId: x!.memberId } });
    const started = await askFor(projectId, x!, pkgs[2]!.id);
    const [yTask] = await tasksIn(pkgs[2]!.id);
    await testDb.task.update({ where: { id: yTask!.id }, data: { status: "DOING", startedAt: new Date(), startedById: y!.memberId } });
    const second = await answer(y!.token, started.id, "accept");
    expect(second.error!.code).toBe("SWAP_NOT_PENDING");
    expect(await swapRow(started.id)).toMatchObject({ status: "VOID", voidReason: "STARTED", voidedById: y!.memberId });
    expect((await notificationsOf(x!.user.id, "SWAP_VOID")).map((n) => n.payload)).toEqual([
      { type: "SWAP_VOID", target: { memberId: y!.memberId, name: y!.name }, reason: "STARTED" },
    ]);
    expect((await packagesOf(projectId))[1]!.ownerId).toBe(x!.memberId);
  });

  it("never moves finished tasks: finishing counts as starting, and other people's finished work stays theirs", async () => {
    const { projectId, people, pkgs } = await team(4);
    const [, x, y, other] = people;
    const [aDone, ...aRest] = await tasksIn(pkgs[1]!.id);
    const [bHalf, ...bRest] = await tasksIn(pkgs[2]!.id);
    expect([aRest.length, bRest.length].every((n) => n > 0)).toBe(true);

    // X finished a task someone else started while the request was pending: X's package is started.
    const first = await askFor(projectId, x!, pkgs[2]!.id);
    await testDb.task.update({
      where: { id: aDone!.id },
      data: { status: "DONE", startedAt: new Date(), startedById: other!.memberId },
    });
    const refused = await answer(y!.token, first.id, "accept");
    expect([refused.status, refused.error!.code]).toEqual([409, "SWAP_NOT_PENDING"]);
    expect(await swapRow(first.id)).toMatchObject({ status: "VOID", voidReason: "STARTED", voidedById: x!.memberId });
    expect((await packagesOf(projectId)).map((p) => p.ownerId).slice(1, 3)).toEqual([x!.memberId, y!.memberId]);
    expect((await testDb.task.findUniqueOrThrow({ where: { id: aDone!.id } })).ownerId).toBe(x!.memberId);

    // Finished work of someone else in either package stays theirs when the packages change hands.
    await testDb.task.update({ where: { id: aDone!.id }, data: { ownerId: other!.memberId } });
    await testDb.task.update({
      where: { id: bHalf!.id },
      data: { status: "HALF", ownerId: other!.memberId, startedAt: new Date(), startedById: other!.memberId },
    });
    const second = await askFor(projectId, x!, pkgs[2]!.id);
    expect((await answer(y!.token, second.id, "accept")).status).toBe(200);
    expect((await packagesOf(projectId)).map((p) => p.ownerId).slice(1, 3)).toEqual([y!.memberId, x!.memberId]);
    for (const t of aRest) expect((await testDb.task.findUniqueOrThrow({ where: { id: t.id } })).ownerId).toBe(y!.memberId);
    for (const t of bRest) expect((await testDb.task.findUniqueOrThrow({ where: { id: t.id } })).ownerId).toBe(x!.memberId);
    for (const t of [aDone!, bHalf!]) {
      expect(await testDb.task.findUniqueOrThrow({ where: { id: t.id } })).toMatchObject({
        ownerId: other!.memberId,
        packageId: t.packageId,
      });
    }
  });

  it("only lets the person asked answer; strangers and unknown requests get 404", async () => {
    const { projectId, people, pkgs } = await team(4);
    const [leader, x, y, other] = people;
    const swap = await askFor(projectId, x!, pkgs[2]!.id);

    expect((await answer(x!.token, swap.id, "accept")).status).toBe(403);
    expect((await answer(other!.token, swap.id, "accept")).status).toBe(403);
    expect((await answer(leader!.token, swap.id, "accept")).status).toBe(403);
    expect((await answer(leader!.token, swap.id, "decline")).status).toBe(403);
    expect((await answer(y!.token, swap.id, "cancel")).status).toBe(403);
    expect((await answer((await person(5)).token, swap.id, "accept")).status).toBe(404);
    expect((await answer(y!.token, "nope", "accept")).status).toBe(404);
    expect((await swapRow(swap.id)).status).toBe("PENDING");
  });
});

describe("POST /api/swaps/:id/decline and /cancel", () => {
  it("declines: the requester is told, nothing changes hands, and it can't be answered again", async () => {
    const { projectId, people, pkgs } = await team(3);
    const [, x, y] = people;
    const swap = await askFor(projectId, x!, pkgs[2]!.id);

    const res = await answer(y!.token, swap.id, "decline");
    expect(res.status).toBe(200);
    expect((await swapRow(swap.id)).status).toBe("DECLINED");
    expect((await packagesOf(projectId))[1]!.ownerId).toBe(x!.memberId);
    expect((await notificationsOf(x!.user.id, "SWAP_DECLINED")).map((n) => [n.swapId, n.payload])).toEqual([
      [swap.id, { type: "SWAP_DECLINED", target: { memberId: y!.memberId, name: y!.name } }],
    ]);

    for (const action of ["accept", "decline"] as const) {
      const again = await answer(y!.token, swap.id, action);
      expect([again.status, again.error!.code]).toEqual([409, "SWAP_NOT_PENDING"]);
    }
  });

  it("cancels: no notification, and the requester may ask again", async () => {
    const { projectId, people, pkgs } = await team(3);
    const [, x, y] = people;
    const swap = await askFor(projectId, x!, pkgs[2]!.id);

    expect((await answer(x!.token, swap.id, "cancel")).status).toBe(200);
    expect((await swapRow(swap.id)).status).toBe("CANCELLED");
    expect(await notificationsOf(y!.user.id)).toHaveLength(1);
    expect(await notificationsOf(x!.user.id)).toHaveLength(0);
    expect((await answer(y!.token, swap.id, "accept")).error!.code).toBe("SWAP_NOT_PENDING");
    expect((await answer(x!.token, swap.id, "cancel")).error!.code).toBe("SWAP_NOT_PENDING");
    await askFor(projectId, x!, pkgs[2]!.id);
  });
});

describe("expiry (3 days, lazy)", () => {
  async function ageSwap(id: string, hours: number) {
    const createdAt = new Date(Date.now() - hours * HOUR);
    await testDb.swapRequest.update({ where: { id }, data: { createdAt, expiresAt: new Date(createdAt.getTime() + 72 * HOUR) } });
  }

  it("a request past 72 h can't be accepted: it becomes EXPIRED and the requester is told once", async () => {
    const { projectId, people, pkgs } = await team(3);
    const [, x, y] = people;
    const swap = await askFor(projectId, x!, pkgs[2]!.id);
    await ageSwap(swap.id, 73);

    const res = await answer(y!.token, swap.id, "accept");
    expect([res.status, res.error!.code]).toEqual([409, "SWAP_NOT_PENDING"]);
    expect(await swapRow(swap.id)).toMatchObject({ status: "EXPIRED" });
    expect((await packagesOf(projectId))[1]!.ownerId).toBe(x!.memberId);
    const expired = await notificationsOf(x!.user.id, "SWAP_EXPIRED");
    expect(expired.map((n) => [n.swapId, n.payload])).toEqual([
      [swap.id, { type: "SWAP_EXPIRED", target: { memberId: y!.memberId, name: y!.name } }],
    ]);
    expect((await answer(x!.token, swap.id, "cancel")).error!.code).toBe("SWAP_NOT_PENDING");
    expect(await notificationsOf(x!.user.id, "SWAP_EXPIRED")).toHaveLength(1);
  });

  it("sends exactly one SWAP_EXPIRED when two requests race on an expired one", async () => {
    const { projectId, people, pkgs } = await team(3);
    const [, x, y] = people;
    const swap = await askFor(projectId, x!, pkgs[2]!.id);
    await ageSwap(swap.id, 80);

    const results = await Promise.all([answer(y!.token, swap.id, "accept"), answer(y!.token, swap.id, "decline")]);
    expect(results.map((r) => r.error?.code)).toEqual(["SWAP_NOT_PENDING", "SWAP_NOT_PENDING"]);
    expect((await swapRow(swap.id)).status).toBe("EXPIRED");
    expect(await notificationsOf(x!.user.id, "SWAP_EXPIRED")).toHaveLength(1);
    expect(await notificationsOf(x!.user.id, "SWAP_DECLINED")).toHaveLength(0);
  });

  it("an expired request no longer counts against the limit", async () => {
    const { projectId, people, pkgs } = await team(4);
    const [, x, , z] = people;
    const old = await askFor(projectId, x!, pkgs[2]!.id);
    await ageSwap(old.id, 72);

    const res = await ask(x!.token, projectId, pkgs[3]!.id);
    expect(res.status).toBe(200);
    expect((await swapRow(old.id)).status).toBe("EXPIRED");
    expect(await notificationsOf(x!.user.id, "SWAP_EXPIRED")).toHaveLength(1);
    expect(await notificationsOf(z!.user.id, "SWAP_REQUEST")).toHaveLength(1);
  });
});
