// Picking, switching, assigning, moving and starting (spec §2), plus the development status endpoint.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NotificationPayload, ProjectView } from "../../shared/types";
import type { ActivityType } from "../src/generated/prisma/client";
import { call, testDb } from "./helpers";
import { activeWith, devStatus, freshDb, joinCode, person, pickAs, startAs, viewAs } from "./project-fixtures";

beforeEach(freshDb);
afterEach(() => vi.unstubAllEnvs());
afterAll(() => testDb.$disconnect());

const HOUR = 60 * 60 * 1000;

const memberRow = (projectId: string, userId: string) =>
  testDb.member.findFirstOrThrow({ where: { projectId, userId }, include: { user: true } });
const packagesOf = (projectId: string) => testDb.package.findMany({ where: { projectId }, orderBy: { index: "asc" } });
const tasksIn = (packageId: string) => testDb.task.findMany({ where: { packageId }, orderBy: { number: "asc" } });
const version = async (projectId: string) => (await testDb.project.findUniqueOrThrow({ where: { id: projectId } })).packagesVersion;
const notificationsOf = (userId: string, type?: NotificationPayload["type"]) =>
  testDb.notification.findMany({ where: { userId, ...(type ? { type } : {}) }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
const eventsOf = (projectId: string, type: ActivityType) =>
  testDb.activityEvent.findMany({ where: { projectId, type }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });

function pendingSwap(projectId: string, requesterId: string, targetId: string, from: string, to: string) {
  const now = Date.now();
  return testDb.swapRequest.create({
    data: {
      projectId,
      requesterId,
      targetId,
      requesterPackageId: from,
      targetPackageId: to,
      createdAt: new Date(now - HOUR),
      expiresAt: new Date(now + 71 * HOUR),
    },
  });
}

const pickById = (token: string, projectId: string, packageId: string) =>
  call<ProjectView>(`/api/projects/${projectId}/packages/${packageId}/pick`, { method: "POST", token });

describe("POST /api/projects/:id/packages/:packageId/pick", () => {
  it("gives a free package to a member who needs one, with its unfinished tasks nobody owns", async () => {
    const t = await activeWith(3);
    const [a] = t.members;
    const pkgs = await packagesOf(t.projectId);
    const [first, second] = await tasksIn(pkgs[1]!.id);
    // A task handed back unfinished (FAIL, nobody) comes along; a finished one without an owner doesn't.
    await testDb.task.update({ where: { id: first!.id }, data: { status: "FAIL" } });
    await testDb.task.update({ where: { id: second!.id }, data: { status: "DONE", startedAt: new Date() } });
    const before = await version(t.projectId);

    const res = await pickAs(a!.token, t.projectId, 2);
    expect(res.status).toBe(200);
    const aRow = await memberRow(t.projectId, a!.user.id);
    expect(res.data.viewerMemberId).toBe(aRow.id);
    expect((await packagesOf(t.projectId))[1]!.ownerId).toBe(aRow.id);
    const tasks = await tasksIn(pkgs[1]!.id);
    expect(tasks.find((x) => x.id === first!.id)!.ownerId).toBe(aRow.id);
    expect(tasks.find((x) => x.id === second!.id)!.ownerId).toBeNull();
    expect(await version(t.projectId)).toBe(before + 1);
    const picked = await eventsOf(t.projectId, "PICKED");
    expect(picked).toHaveLength(1);
    expect(picked[0]).toMatchObject({ actorId: aRow.id, payload: { type: "PICKED", packageIndex: 2 } });
  });

  it("lets only one of two simultaneous pickers have it; the other gets PACKAGE_TAKEN", async () => {
    const t = await activeWith(3);
    const [a, b] = t.members;
    const pkg = (await packagesOf(t.projectId))[0]!;
    const results = await Promise.all([pickById(a!.token, t.projectId, pkg.id), pickById(b!.token, t.projectId, pkg.id)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const loser = results.find((r) => r.status === 409)!;
    expect(loser.error!.code).toBe("PACKAGE_TAKEN");
    const winner = results[0]!.status === 200 ? a! : b!;
    expect((await packagesOf(t.projectId))[0]!.ownerId).toBe((await memberRow(t.projectId, winner.user.id)).id);
    expect(await eventsOf(t.projectId, "PICKED")).toHaveLength(1);
  });

  it("refuses someone else's package, ignores your own, 404s unknown packages and strangers", async () => {
    const t = await activeWith(3);
    const [a, b] = t.members;
    expect((await pickAs(a!.token, t.projectId, 1)).status).toBe(200);
    const taken = await pickAs(b!.token, t.projectId, 1);
    expect(taken.status).toBe(409);
    expect(taken.error!.code).toBe("PACKAGE_TAKEN");

    const v = await version(t.projectId);
    expect((await pickAs(a!.token, t.projectId, 1)).status).toBe(200);
    expect(await version(t.projectId)).toBe(v);

    expect((await pickById(a!.token, t.projectId, "nope")).status).toBe(404);
    const stranger = await person(5);
    const pkg = (await packagesOf(t.projectId))[1]!;
    expect((await pickById(stranger.token, t.projectId, pkg.id)).status).toBe(404);
  });

  it("won't let a leader who only manages pick", async () => {
    const t = await activeWith(3, { leaderManages: true });
    const res = await pickAs(t.leader.token, t.projectId, 1);
    expect(res.status).toBe(409);
    expect(res.error!.code).toBe("LEADER_ONLY_MANAGES");
    expect((await packagesOf(t.projectId)).every((p) => p.ownerId === null)).toBe(true);
  });

  it("switches to a free package: frees the old one, its tasks go back to nobody, pending swaps end", async () => {
    const t = await activeWith(4);
    const [a, b] = t.members;
    await pickAs(a!.token, t.projectId, 1);
    await pickAs(b!.token, t.projectId, 2);
    const [aRow, bRow] = [await memberRow(t.projectId, a!.user.id), await memberRow(t.projectId, b!.user.id)];
    const pkgs = await packagesOf(t.projectId);
    const toA = await pendingSwap(t.projectId, bRow.id, aRow.id, pkgs[1]!.id, pkgs[0]!.id);

    const res = await pickAs(a!.token, t.projectId, 3);
    expect(res.status).toBe(200);
    const after = await packagesOf(t.projectId);
    expect(after[0]!.ownerId).toBeNull();
    expect(after[2]!.ownerId).toBe(aRow.id);
    expect((await tasksIn(pkgs[0]!.id)).every((x) => x.ownerId === null)).toBe(true);
    expect((await tasksIn(pkgs[2]!.id)).every((x) => x.ownerId === aRow.id)).toBe(true);

    expect(await testDb.swapRequest.findUniqueOrThrow({ where: { id: toA.id } })).toMatchObject({
      status: "VOID",
      voidReason: "SWITCHED",
      voidedById: aRow.id,
    });
    const told = await notificationsOf(b!.user.id, "SWAP_VOID");
    expect(told.map((n) => n.payload)).toEqual([
      { type: "SWAP_VOID", target: { memberId: aRow.id, name: aRow.user.name }, reason: "SWITCHED" },
    ]);
    const switched = await eventsOf(t.projectId, "SWITCHED");
    expect(switched.map((e) => e.payload)).toEqual([{ type: "SWITCHED", fromPackageIndex: 1, toPackageIndex: 3 }]);
  });

  it("refuses to switch once you started a task in your package (PACKAGE_STARTED)", async () => {
    const t = await activeWith(3);
    const [a] = t.members;
    await pickAs(a!.token, t.projectId, 1);
    const pkgs = await packagesOf(t.projectId);
    const [task] = await tasksIn(pkgs[0]!.id);
    expect((await startAs(a!.token, t.projectId, task!.id)).status).toBe(200);

    const res = await pickAs(a!.token, t.projectId, 2);
    expect(res.status).toBe(409);
    expect(res.error!.code).toBe("PACKAGE_STARTED");
    const aRow = await memberRow(t.projectId, a!.user.id);
    expect((await packagesOf(t.projectId))[0]!.ownerId).toBe(aRow.id);
    expect((await packagesOf(t.projectId))[1]!.ownerId).toBeNull();
  });

  it("doesn't count a task someone else started (moved in) as your start; a switch leaves it for the next picker", async () => {
    const t = await activeWith(4);
    const [a, b, c] = t.members;
    await pickAs(a!.token, t.projectId, 1);
    await pickAs(b!.token, t.projectId, 2);
    const pkgs = await packagesOf(t.projectId);
    const [bTask] = await tasksIn(pkgs[1]!.id);
    await startAs(b!.token, t.projectId, bTask!.id);
    const moved = await call(`/api/projects/${t.projectId}/tasks/${bTask!.id}/move`, {
      method: "POST",
      token: t.leader.token,
      body: { packageId: pkgs[0]!.id },
    });
    expect(moved.status).toBe(200);
    const [aRow, bRow, cRow] = await Promise.all([a!, b!, c!].map((p) => memberRow(t.projectId, p.user.id)));
    expect(await testDb.task.findUniqueOrThrow({ where: { id: bTask!.id } })).toMatchObject({
      ownerId: aRow!.id,
      status: "DOING",
      startedById: bRow!.id,
    });

    expect((await pickAs(a!.token, t.projectId, 3)).status).toBe(200);
    // Every unfinished task A held in package 1 goes back to nobody, the half-done one with its progress.
    const left = await testDb.task.findUniqueOrThrow({ where: { id: bTask!.id } });
    expect(left).toMatchObject({ ownerId: null, packageId: pkgs[0]!.id, status: "DOING", startedById: bRow!.id });
    expect(left.startedAt).not.toBeNull();
    expect((await tasksIn(pkgs[0]!.id)).every((x) => x.ownerId === null)).toBe(true);
    const aView = await viewAs(a!.token, t.projectId);
    expect(aView.members.find((m) => m.id === aRow!.id)!.unfinishedCount).toBe((await tasksIn(pkgs[2]!.id)).length);

    // Whoever picks package 1 next gets it, still half done, and isn't counted as started.
    expect((await pickAs(c!.token, t.projectId, 1)).status).toBe(200);
    expect(await testDb.task.findUniqueOrThrow({ where: { id: bTask!.id } })).toMatchObject({
      ownerId: cRow!.id,
      status: "DOING",
      startedById: bRow!.id,
      startedAt: left.startedAt,
    });
    expect((await tasksIn(pkgs[0]!.id)).every((x) => x.ownerId === cRow!.id)).toBe(true);
    expect((await viewAs(c!.token, t.projectId)).packages.find((p) => p.index === 1)!.started).toBe(false);
  });

  it("doesn't count work left in a free package as your start", async () => {
    const t = await activeWith(3);
    const [a] = t.members;
    const pkgs = await packagesOf(t.projectId);
    const [left] = await tasksIn(pkgs[1]!.id);
    // Someone who left had it in review and got it back as FAIL: released, nobody's.
    await testDb.task.update({ where: { id: left!.id }, data: { status: "FAIL", ownerId: null, startedAt: null, startedById: null } });

    await pickAs(a!.token, t.projectId, 2);
    const aRow = await memberRow(t.projectId, a!.user.id);
    expect(await testDb.task.findUniqueOrThrow({ where: { id: left!.id } })).toMatchObject({ ownerId: aRow.id, status: "FAIL" });
    expect((await pickAs(a!.token, t.projectId, 3)).status).toBe(200);
  });

  it("counts finishing a task someone else started as your start: no switching or swapping, pending swaps end", async () => {
    const t = await activeWith(4);
    const [a, b, c] = t.members;
    await pickAs(a!.token, t.projectId, 1);
    await pickAs(b!.token, t.projectId, 2);
    await pickAs(c!.token, t.projectId, 3);
    const pkgs = await packagesOf(t.projectId);
    const [aRow, bRow, cRow] = await Promise.all([a!, b!, c!].map((p) => memberRow(t.projectId, p.user.id)));
    const [bTask] = await tasksIn(pkgs[1]!.id);
    await startAs(b!.token, t.projectId, bTask!.id);
    const moved = await call(`/api/projects/${t.projectId}/tasks/${bTask!.id}/move`, {
      method: "POST",
      token: t.leader.token,
      body: { packageId: pkgs[0]!.id },
    });
    expect(moved.status).toBe(200);
    // Holding B's half-done task isn't A's start yet, so C may ask A to swap.
    expect((await viewAs(a!.token, t.projectId)).packages.find((p) => p.index === 1)!.started).toBe(false);
    const asked = await call(`/api/projects/${t.projectId}/swaps`, { method: "POST", token: c!.token, body: { packageId: pkgs[0]!.id } });
    expect(asked.status).toBe(200);
    const swap = await testDb.swapRequest.findFirstOrThrow({ where: { projectId: t.projectId, status: "PENDING" } });

    expect((await devStatus(a!.token, bTask!.id, "DONE")).status).toBe(200);
    expect(await testDb.task.findUniqueOrThrow({ where: { id: bTask!.id } })).toMatchObject({
      ownerId: aRow!.id,
      status: "DONE",
      startedById: bRow!.id,
    });
    expect(await testDb.swapRequest.findUniqueOrThrow({ where: { id: swap.id } })).toMatchObject({
      status: "VOID",
      voidReason: "STARTED",
      voidedById: aRow!.id,
    });
    expect((await notificationsOf(c!.user.id, "SWAP_VOID")).map((n) => n.payload)).toEqual([
      { type: "SWAP_VOID", target: { memberId: aRow!.id, name: aRow!.user.name }, reason: "STARTED" },
    ]);
    expect((await viewAs(a!.token, t.projectId)).packages.find((p) => p.index === 1)!.started).toBe(true);

    const switched = await pickAs(a!.token, t.projectId, 4);
    expect([switched.status, switched.error!.code]).toEqual([409, "PACKAGE_STARTED"]);
    const mine = await call(`/api/projects/${t.projectId}/swaps`, { method: "POST", token: a!.token, body: { packageId: pkgs[2]!.id } });
    expect([mine.status, mine.error!.code]).toEqual([409, "PACKAGE_STARTED"]);
    const theirs = await call(`/api/projects/${t.projectId}/swaps`, { method: "POST", token: c!.token, body: { packageId: pkgs[0]!.id } });
    expect([theirs.status, theirs.error!.code]).toEqual([409, "TARGET_STARTED"]);

    // HALF is finished too.
    expect((await devStatus(a!.token, bTask!.id, "HALF")).status).toBe(200);
    expect((await pickAs(a!.token, t.projectId, 4)).error!.code).toBe("PACKAGE_STARTED");
    expect((await packagesOf(t.projectId)).map((p) => p.ownerId)).toEqual([aRow!.id, bRow!.id, cRow!.id, null]);
  });

  it("tells the leader when the last free package goes and someone is still without one", async () => {
    const t = await activeWith(3);
    const [a, b] = t.members;
    const late = await person(3);
    expect((await joinCode(late.token, t.view.inviteCode!)).status).toBe(200);
    await pickAs(t.leader.token, t.projectId, 1);
    await pickAs(a!.token, t.projectId, 2);
    expect(await notificationsOf(t.leader.user.id, "MEMBER_NEEDS_PACKAGE")).toHaveLength(0);

    await pickAs(b!.token, t.projectId, 3);
    const lateRow = await memberRow(t.projectId, late.user.id);
    const sent = await notificationsOf(t.leader.user.id, "MEMBER_NEEDS_PACKAGE");
    expect(sent.map((n) => n.payload)).toEqual([
      { type: "MEMBER_NEEDS_PACKAGE", member: { memberId: lateRow.id, name: "张博文" }, joined: false },
    ]);
  });
});

describe("POST /api/projects/:id/packages/:packageId/assign", () => {
  const assign = (token: string, projectId: string, packageId: string, memberId: string) =>
    call<ProjectView>(`/api/projects/${projectId}/packages/${packageId}/assign`, { method: "POST", token, body: { memberId } });

  it("gives a free package to a member who needs one; they are told and may still switch", async () => {
    const t = await activeWith(3);
    const [a] = t.members;
    const aRow = await memberRow(t.projectId, a!.user.id);
    const pkgs = await packagesOf(t.projectId);
    const before = await version(t.projectId);

    const res = await assign(t.leader.token, t.projectId, pkgs[1]!.id, aRow.id);
    expect(res.status).toBe(200);
    expect((await packagesOf(t.projectId))[1]!.ownerId).toBe(aRow.id);
    expect((await tasksIn(pkgs[1]!.id)).every((x) => x.ownerId === aRow.id)).toBe(true);
    expect(await version(t.projectId)).toBe(before + 1);
    const told = await notificationsOf(a!.user.id, "PACKAGE_ASSIGNED");
    expect(told).toHaveLength(1);
    expect(told[0]).toMatchObject({ audience: "ONLY_YOU", payload: { type: "PACKAGE_ASSIGNED", packageIndex: 2 } });
    const events = await eventsOf(t.projectId, "ASSIGNED");
    expect(events[0]!.payload).toEqual({ type: "ASSIGNED", packageIndex: 2, member: { memberId: aRow.id, name: "林晓雯" } });

    expect((await pickAs(a!.token, t.projectId, 3)).status).toBe(200);
  });

  it("assigns to the leader themself without a notification", async () => {
    const t = await activeWith(2);
    const leaderRow = await memberRow(t.projectId, t.leader.user.id);
    const pkgs = await packagesOf(t.projectId);
    expect((await assign(t.leader.token, t.projectId, pkgs[0]!.id, leaderRow.id)).status).toBe(200);
    expect((await packagesOf(t.projectId))[0]!.ownerId).toBe(leaderRow.id);
    expect(await notificationsOf(t.leader.user.id)).toHaveLength(0);
  });

  it("refuses members, people with a package, the leader who only manages, taken and unknown packages", async () => {
    const t = await activeWith(3, { leaderManages: true, teamSize: 4 });
    const [a, b] = t.members;
    const [aRow, bRow] = [await memberRow(t.projectId, a!.user.id), await memberRow(t.projectId, b!.user.id)];
    const leaderRow = await memberRow(t.projectId, t.leader.user.id);
    const pkgs = await packagesOf(t.projectId);
    await pickAs(a!.token, t.projectId, 1);

    const byMember = await assign(a!.token, t.projectId, pkgs[1]!.id, bRow.id);
    expect(byMember.status).toBe(403);
    const has = await assign(t.leader.token, t.projectId, pkgs[1]!.id, aRow.id);
    expect([has.status, has.error!.code]).toEqual([409, "ALREADY_HAS_PACKAGE"]);
    const manager = await assign(t.leader.token, t.projectId, pkgs[1]!.id, leaderRow.id);
    expect([manager.status, manager.error!.code]).toEqual([409, "LEADER_ONLY_MANAGES"]);
    const taken = await assign(t.leader.token, t.projectId, pkgs[0]!.id, bRow.id);
    expect([taken.status, taken.error!.code]).toEqual([409, "PACKAGE_TAKEN"]);
    expect((await assign(t.leader.token, t.projectId, "nope", bRow.id)).status).toBe(404);
    expect((await assign(t.leader.token, t.projectId, pkgs[1]!.id, "nope")).status).toBe(404);

    await testDb.member.update({ where: { id: bRow.id }, data: { leftAt: new Date() } });
    expect((await assign(t.leader.token, t.projectId, pkgs[1]!.id, bRow.id)).status).toBe(404);
    expect((await packagesOf(t.projectId))[1]!.ownerId).toBeNull();
  });
});

describe("POST /api/projects/:id/tasks/:taskId/move", () => {
  const move = (token: string, projectId: string, taskId: string, packageId: string) =>
    call<ProjectView>(`/api/projects/${projectId}/tasks/${taskId}/move`, { method: "POST", token, body: { packageId } });

  async function team() {
    const t = await activeWith(4);
    const [a, b] = t.members;
    await pickAs(t.leader.token, t.projectId, 1);
    await pickAs(a!.token, t.projectId, 2);
    await pickAs(b!.token, t.projectId, 3);
    const rows = {
      leader: await memberRow(t.projectId, t.leader.user.id),
      a: await memberRow(t.projectId, a!.user.id),
      b: await memberRow(t.projectId, b!.user.id),
    };
    return { ...t, a: a!, b: b!, rows, pkgs: await packagesOf(t.projectId) };
  }

  it("hands a task to the owner of another package, keeping its progress, and tells both", async () => {
    const t = await team();
    const [task] = await tasksIn(t.pkgs[2]!.id);
    await startAs(t.b.token, t.projectId, task!.id);
    const before = await version(t.projectId);

    const res = await move(t.leader.token, t.projectId, task!.id, t.pkgs[1]!.id);
    expect(res.status).toBe(200);
    const moved = await testDb.task.findUniqueOrThrow({ where: { id: task!.id } });
    expect(moved).toMatchObject({ packageId: t.pkgs[1]!.id, ownerId: t.rows.a.id, status: "DOING", startedById: t.rows.b.id });
    expect(moved.startedAt).not.toBeNull();
    expect(await version(t.projectId)).toBe(before + 1);

    const movedIn = await notificationsOf(t.a.user.id, "TASK_MOVED_IN");
    expect(movedIn).toHaveLength(1);
    expect(movedIn[0]).toMatchObject({ audience: "ONLY_YOU" });
    expect(movedIn[0]!.payload).toEqual({
      type: "TASK_MOVED_IN",
      taskId: task!.id,
      title: task!.title,
      from: { memberId: t.rows.b.id, name: "王子杰" },
      fromPackageIndex: 3,
      toPackageIndex: 2,
      hasEvidence: false,
    });
    const movedOut = await notificationsOf(t.b.user.id, "TASK_MOVED_OUT");
    expect(movedOut.map((n) => n.payload)).toEqual([
      {
        type: "TASK_MOVED_OUT",
        taskId: task!.id,
        title: task!.title,
        fromPackageIndex: 3,
        to: { memberId: t.rows.a.id, name: "林晓雯" },
        toPackageIndex: 2,
      },
    ]);
    expect(await notificationsOf(t.leader.user.id)).toHaveLength(0);
    const events = await eventsOf(t.projectId, "TASK_MOVED");
    expect(events[0]).toMatchObject({ actorId: t.rows.leader.id });
    expect(events[0]!.payload).toEqual({ type: "TASK_MOVED", taskId: task!.id, title: task!.title, fromPackageIndex: 3, toPackageIndex: 2 });
  });

  it("releases a task moved into a free package; REVIEWING keeps its status", async () => {
    const t = await team();
    const [doing, reviewing] = await tasksIn(t.pkgs[2]!.id);
    await startAs(t.b.token, t.projectId, doing!.id);
    await testDb.task.update({
      where: { id: reviewing!.id },
      data: { status: "REVIEWING", startedAt: new Date(), startedById: t.rows.b.id },
    });

    expect((await move(t.leader.token, t.projectId, doing!.id, t.pkgs[3]!.id)).status).toBe(200);
    expect((await move(t.leader.token, t.projectId, reviewing!.id, t.pkgs[3]!.id)).status).toBe(200);
    expect(await testDb.task.findUniqueOrThrow({ where: { id: doing!.id } })).toMatchObject({
      packageId: t.pkgs[3]!.id,
      ownerId: null,
      startedAt: null,
      startedById: null,
      status: "TODO",
    });
    expect(await testDb.task.findUniqueOrThrow({ where: { id: reviewing!.id } })).toMatchObject({
      ownerId: null,
      startedAt: null,
      startedById: null,
      status: "REVIEWING",
    });
    const out = await notificationsOf(t.b.user.id, "TASK_MOVED_OUT");
    expect(out.map((n) => n.payload)).toEqual([
      { type: "TASK_MOVED_OUT", taskId: doing!.id, title: doing!.title, fromPackageIndex: 3, to: null, toPackageIndex: 4 },
      { type: "TASK_MOVED_OUT", taskId: reviewing!.id, title: reviewing!.title, fromPackageIndex: 3, to: null, toPackageIndex: 4 },
    ]);
  });

  it("from a free package or the leader's own: only the other person hears about it", async () => {
    const t = await team();
    const [free] = await tasksIn(t.pkgs[3]!.id);
    const [mine] = await tasksIn(t.pkgs[0]!.id);
    expect((await move(t.leader.token, t.projectId, free!.id, t.pkgs[1]!.id)).status).toBe(200);
    expect((await move(t.leader.token, t.projectId, mine!.id, t.pkgs[1]!.id)).status).toBe(200);
    expect(await testDb.task.findUniqueOrThrow({ where: { id: free!.id } })).toMatchObject({ ownerId: t.rows.a.id });

    const movedIn = await notificationsOf(t.a.user.id, "TASK_MOVED_IN");
    expect(movedIn.map((n) => (n.payload as { from: unknown }).from)).toEqual([null, { memberId: t.rows.leader.id, name: "陈思远" }]);
    // Into the leader's package: the leader isn't told about their own move.
    const [aTask] = (await tasksIn(t.pkgs[1]!.id)).filter((x) => x.id !== free!.id && x.id !== mine!.id);
    expect((await move(t.leader.token, t.projectId, aTask!.id, t.pkgs[0]!.id)).status).toBe(200);
    expect(await notificationsOf(t.leader.user.id)).toHaveLength(0);
    expect(await notificationsOf(t.a.user.id, "TASK_MOVED_OUT")).toHaveLength(1);
  });

  it("moving a task back to the person who started it ends their pending swaps (their package is started again)", async () => {
    const t = await activeWith(4);
    const [a, b, c] = t.members;
    await pickAs(a!.token, t.projectId, 1);
    await pickAs(b!.token, t.projectId, 2);
    await pickAs(c!.token, t.projectId, 3);
    const pkgs = await packagesOf(t.projectId);
    const [bRow, cRow] = [await memberRow(t.projectId, b!.user.id), await memberRow(t.projectId, c!.user.id)];
    const [bTask] = await tasksIn(pkgs[1]!.id);
    await startAs(b!.token, t.projectId, bTask!.id);
    expect((await move(t.leader.token, t.projectId, bTask!.id, pkgs[0]!.id)).status).toBe(200);
    // B's package isn't started any more, so C may ask B to swap.
    const asked = await call(`/api/projects/${t.projectId}/swaps`, { method: "POST", token: c!.token, body: { packageId: pkgs[1]!.id } });
    expect(asked.status).toBe(200);
    const swap = await testDb.swapRequest.findFirstOrThrow({ where: { projectId: t.projectId } });

    expect((await move(t.leader.token, t.projectId, bTask!.id, pkgs[1]!.id)).status).toBe(200);
    expect(await testDb.swapRequest.findUniqueOrThrow({ where: { id: swap.id } })).toMatchObject({
      status: "VOID",
      voidReason: "STARTED",
      voidedById: bRow.id,
    });
    expect((await notificationsOf(c!.user.id, "SWAP_VOID")).map((n) => n.payload)).toEqual([
      { type: "SWAP_VOID", target: { memberId: bRow.id, name: bRow.user.name }, reason: "STARTED" },
    ]);
    const bView = await viewAs(b!.token, t.projectId);
    expect(bView.packages.find((p) => p.index === 2)!.started).toBe(true);
    expect(bView.swaps).toHaveLength(0);
    // C's one request is gone, so C may ask someone else.
    const again = await call(`/api/projects/${t.projectId}/swaps`, { method: "POST", token: c!.token, body: { packageId: pkgs[0]!.id } });
    expect(again.status).toBe(200);
    const open = await testDb.swapRequest.findMany({ where: { projectId: t.projectId, status: "PENDING" } });
    expect(open.map((x) => x.requesterId)).toEqual([cRow.id]);
  });

  it("moving a started task to someone who didn't start it leaves their swaps alone", async () => {
    const t = await team();
    const [bTask] = await tasksIn(t.pkgs[2]!.id);
    await startAs(t.b.token, t.projectId, bTask!.id);
    const pending = await pendingSwap(t.projectId, t.rows.leader.id, t.rows.a.id, t.pkgs[0]!.id, t.pkgs[1]!.id);
    expect((await move(t.leader.token, t.projectId, bTask!.id, t.pkgs[1]!.id)).status).toBe(200);
    expect(await testDb.swapRequest.findUniqueOrThrow({ where: { id: pending.id } })).toMatchObject({ status: "PENDING" });
  });

  it("refuses finished tasks, the same package, members, and unknown tasks or packages", async () => {
    const t = await team();
    const [done, other] = await tasksIn(t.pkgs[2]!.id);
    await devStatus(t.b.token, done!.id, "DONE");

    const finished = await move(t.leader.token, t.projectId, done!.id, t.pkgs[1]!.id);
    expect([finished.status, finished.error!.code]).toEqual([409, "TASK_FINISHED"]);
    const same = await move(t.leader.token, t.projectId, other!.id, t.pkgs[2]!.id);
    expect([same.status, same.error!.code]).toEqual([400, "VALIDATION"]);
    expect((await move(t.a.token, t.projectId, other!.id, t.pkgs[1]!.id)).status).toBe(403);
    expect((await move(t.leader.token, t.projectId, "nope", t.pkgs[1]!.id)).status).toBe(404);
    expect((await move(t.leader.token, t.projectId, other!.id, "nope")).status).toBe(404);
    expect(await testDb.task.findUniqueOrThrow({ where: { id: other!.id } })).toMatchObject({ packageId: t.pkgs[2]!.id });
  });
});

describe("POST /api/projects/:id/tasks/:taskId/start", () => {
  it("starts the owner's task, ends their pending swaps, and records it", async () => {
    const t = await activeWith(4);
    const [a, b, c] = t.members;
    await pickAs(a!.token, t.projectId, 1);
    await pickAs(b!.token, t.projectId, 2);
    await pickAs(c!.token, t.projectId, 3);
    const [aRow, bRow, cRow] = await Promise.all([a!, b!, c!].map((p) => memberRow(t.projectId, p.user.id)));
    const pkgs = await packagesOf(t.projectId);
    const fromA = await pendingSwap(t.projectId, aRow!.id, bRow!.id, pkgs[0]!.id, pkgs[1]!.id);
    const toA = await pendingSwap(t.projectId, cRow!.id, aRow!.id, pkgs[2]!.id, pkgs[0]!.id);
    const [task] = await tasksIn(pkgs[0]!.id);
    const before = await version(t.projectId);

    const res = await startAs(a!.token, t.projectId, task!.id);
    expect(res.status).toBe(200);
    const started = await testDb.task.findUniqueOrThrow({ where: { id: task!.id } });
    expect(started).toMatchObject({ status: "DOING", startedById: aRow!.id });
    expect(started.startedAt).not.toBeNull();
    expect(await version(t.projectId)).toBe(before + 1);

    for (const id of [fromA.id, toA.id]) {
      expect(await testDb.swapRequest.findUniqueOrThrow({ where: { id } })).toMatchObject({
        status: "VOID",
        voidReason: "STARTED",
        voidedById: aRow!.id,
      });
    }
    expect((await notificationsOf(c!.user.id, "SWAP_VOID")).map((n) => n.payload)).toEqual([
      { type: "SWAP_VOID", target: { memberId: aRow!.id, name: "林晓雯" }, reason: "STARTED" },
    ]);
    expect(await notificationsOf(a!.user.id, "SWAP_VOID")).toHaveLength(0);
    const events = await eventsOf(t.projectId, "TASK_STARTED");
    expect(events.map((e) => [e.actorId, e.payload])).toEqual([[aRow!.id, { type: "TASK_STARTED", taskId: task!.id, title: task!.title }]]);

    // Again: nothing changes.
    expect((await startAs(a!.token, t.projectId, task!.id)).status).toBe(200);
    expect(await version(t.projectId)).toBe(before + 1);
    expect(await eventsOf(t.projectId, "TASK_STARTED")).toHaveLength(1);
  });

  it("only lets the owner start; strangers and unknown tasks get 404", async () => {
    const t = await activeWith(3);
    const [a, b] = t.members;
    await pickAs(a!.token, t.projectId, 1);
    const [task] = await tasksIn((await packagesOf(t.projectId))[0]!.id);
    expect((await startAs(b!.token, t.projectId, task!.id)).status).toBe(403);
    expect((await startAs(t.leader.token, t.projectId, task!.id)).status).toBe(403);
    expect((await startAs((await person(5)).token, t.projectId, task!.id)).status).toBe(404);
    expect((await startAs(a!.token, t.projectId, "nope")).status).toBe(404);
    expect(await testDb.task.findUniqueOrThrow({ where: { id: task!.id } })).toMatchObject({ status: "TODO", startedAt: null });
  });
});

describe("POST /api/dev/tasks/:taskId/status", () => {
  it("leaving TODO starts the task as its owner; TODO clears the start", async () => {
    const t = await activeWith(3);
    const [a, b] = t.members;
    await pickAs(a!.token, t.projectId, 1);
    await pickAs(b!.token, t.projectId, 2);
    const [aRow, bRow] = [await memberRow(t.projectId, a!.user.id), await memberRow(t.projectId, b!.user.id)];
    const pkgs = await packagesOf(t.projectId);
    const swap = await pendingSwap(t.projectId, bRow.id, aRow.id, pkgs[1]!.id, pkgs[0]!.id);
    const [task] = await tasksIn(pkgs[0]!.id);
    const before = await version(t.projectId);

    const res = await devStatus(a!.token, task!.id, "DOING");
    expect(res.status).toBe(200);
    expect(res.data).toBeNull();
    const doing = await testDb.task.findUniqueOrThrow({ where: { id: task!.id } });
    expect(doing).toMatchObject({ status: "DOING", startedById: aRow.id });
    expect(await testDb.swapRequest.findUniqueOrThrow({ where: { id: swap.id } })).toMatchObject({ status: "VOID", voidReason: "STARTED" });
    expect(await notificationsOf(b!.user.id, "SWAP_VOID")).toHaveLength(1);

    // Any member of the project may use it (it stands in for grading).
    expect((await devStatus(t.leader.token, task!.id, "HALF")).status).toBe(200);
    const half = await testDb.task.findUniqueOrThrow({ where: { id: task!.id } });
    expect(half).toMatchObject({ status: "HALF", startedById: aRow.id, startedAt: doing.startedAt });

    expect((await devStatus(a!.token, task!.id, "TODO")).status).toBe(200);
    expect(await testDb.task.findUniqueOrThrow({ where: { id: task!.id } })).toMatchObject({
      status: "TODO",
      startedAt: null,
      startedById: null,
    });
    expect(await version(t.projectId)).toBe(before + 3);

    // Straight to DONE from TODO also counts as started.
    expect((await devStatus(a!.token, task!.id, "DONE")).status).toBe(200);
    expect(await testDb.task.findUniqueOrThrow({ where: { id: task!.id } })).toMatchObject({ status: "DONE", startedById: aRow.id });
  });

  it("only works on tasks with an owner and a package", async () => {
    const t = await activeWith(2);
    const [task] = await tasksIn((await packagesOf(t.projectId))[0]!.id);
    const res = await devStatus(t.leader.token, task!.id, "DONE");
    expect([res.status, res.error!.code]).toEqual([409, "CONFLICT"]);
    expect((await devStatus(t.leader.token, "nope", "DONE")).status).toBe(404);
    const bad = await call(`/api/dev/tasks/${task!.id}/status`, { method: "POST", token: t.leader.token, body: { status: "REVIEWING" } });
    expect(bad.status).toBe(400);
  });

  it("needs sign-in and an active membership of the task's project", async () => {
    const t = await activeWith(3);
    const [a, b] = t.members;
    await pickAs(a!.token, t.projectId, 1);
    const [task] = await tasksIn((await packagesOf(t.projectId))[0]!.id);

    const anonymous = await call(`/api/dev/tasks/${task!.id}/status`, { method: "POST", body: { status: "DONE" } });
    expect([anonymous.status, anonymous.error!.code]).toEqual([401, "UNAUTHENTICATED"]);
    const outsider = await person(5);
    expect((await devStatus(outsider.token, task!.id, "DONE")).status).toBe(404);
    // A member who left can't use it any more.
    expect((await call(`/api/projects/${t.projectId}/leave`, { method: "POST", token: b!.token })).status).toBe(200);
    const v = await version(t.projectId);
    expect((await devStatus(b!.token, task!.id, "DONE")).status).toBe(404);

    expect(await testDb.task.findUniqueOrThrow({ where: { id: task!.id } })).toMatchObject({ status: "TODO", startedAt: null });
    expect(await version(t.projectId)).toBe(v);
  });

  it("is hidden when DEV_LOGIN is off and in production", async () => {
    const t = await activeWith(2);
    const [a] = t.members;
    await pickAs(a!.token, t.projectId, 1);
    const [task] = await tasksIn((await packagesOf(t.projectId))[0]!.id);

    vi.stubEnv("DEV_LOGIN", "false");
    expect((await devStatus(a!.token, task!.id, "DONE")).status).toBe(404);
    vi.stubEnv("DEV_LOGIN", "true");
    vi.stubEnv("NODE_ENV", "production");
    expect((await devStatus(a!.token, task!.id, "DONE")).status).toBe(404);
    expect(await testDb.task.findUniqueOrThrow({ where: { id: task!.id } })).toMatchObject({ status: "TODO", startedAt: null });
  });
});

describe("views after picking", () => {
  it("answer with the actor's project view", async () => {
    const t = await activeWith(2);
    const [a] = t.members;
    const res = await pickAs(a!.token, t.projectId, 2);
    const aView = await viewAs(a!.token, t.projectId);
    expect(res.data.packages.find((p) => p.index === 2)!.ownerMemberId).toBe(aView.viewerMemberId);
  });
});

describe("ids from another project, and people no longer in the project", () => {
  /** Everything about a project that a stray write could change. */
  async function snapshot(projectId: string) {
    return {
      packages: await testDb.package.findMany({ where: { projectId }, orderBy: { index: "asc" } }),
      tasks: await testDb.task.findMany({ where: { projectId }, orderBy: { number: "asc" } }),
      members: await testDb.member.findMany({ where: { projectId }, orderBy: { id: "asc" } }),
      swaps: await testDb.swapRequest.findMany({ where: { projectId }, orderBy: { id: "asc" } }),
      version: await version(projectId),
    };
  }

  it("never reach into another project, even for someone who is in both", async () => {
    // The same people lead and join both projects.
    const p1 = await activeWith(3);
    const p2 = await activeWith(3, { name: "另一个项目" });
    const [a, b] = p1.members;
    await pickAs(a!.token, p1.projectId, 1);
    await pickAs(a!.token, p2.projectId, 1);
    await pickAs(b!.token, p2.projectId, 2);
    const [pkgs1, pkgs2] = [await packagesOf(p1.projectId), await packagesOf(p2.projectId)];
    const [aTask2] = await tasksIn(pkgs2[0]!.id);
    const [p1Task] = await tasksIn(pkgs1[0]!.id);
    const bIn1 = await memberRow(p1.projectId, b!.user.id);
    const bIn2 = await memberRow(p2.projectId, b!.user.id);
    const before = await snapshot(p2.projectId);
    const p1Before = await snapshot(p1.projectId);

    const in1 = (path: string) => `/api/projects/${p1.projectId}${path}`;
    const attempts = {
      pick: await call(in1(`/packages/${pkgs2[2]!.id}/pick`), { method: "POST", token: b!.token }),
      assignPackage: await call(in1(`/packages/${pkgs2[2]!.id}/assign`), {
        method: "POST",
        token: p1.leader.token,
        body: { memberId: bIn1.id },
      }),
      assignMember: await call(in1(`/packages/${pkgs1[1]!.id}/assign`), {
        method: "POST",
        token: p1.leader.token,
        body: { memberId: bIn2.id },
      }),
      moveTask: await call(in1(`/tasks/${aTask2!.id}/move`), { method: "POST", token: p1.leader.token, body: { packageId: pkgs1[1]!.id } }),
      moveInto: await call(in1(`/tasks/${p1Task!.id}/move`), { method: "POST", token: p1.leader.token, body: { packageId: pkgs2[2]!.id } }),
      start: await call(in1(`/tasks/${aTask2!.id}/start`), { method: "POST", token: a!.token }),
      swap: await call(in1("/swaps"), { method: "POST", token: a!.token, body: { packageId: pkgs2[1]!.id } }),
      transfer: await call(in1(`/members/${bIn2.id}/transfer`), { method: "POST", token: p1.leader.token }),
      remove: await call(in1(`/members/${bIn2.id}/remove`), { method: "POST", token: p1.leader.token }),
    };
    for (const [name, res] of Object.entries(attempts)) expect([name, res.status]).toEqual([name, 404]);

    expect(await snapshot(p2.projectId)).toEqual(before);
    expect(await snapshot(p1.projectId)).toEqual(p1Before);
  });

  it("refuse people who left or were removed: pick, swap, start, accept and cancel all 404", async () => {
    const t = await activeWith(4);
    const [a, b, c] = t.members;
    await pickAs(a!.token, t.projectId, 1);
    await pickAs(b!.token, t.projectId, 2);
    await pickAs(c!.token, t.projectId, 3);
    const pkgs = await packagesOf(t.projectId);
    const [aTask] = await tasksIn(pkgs[0]!.id);
    const [cTask] = await tasksIn(pkgs[2]!.id);
    const ask = (token: string, packageId: string) => call(`/api/projects/${t.projectId}/swaps`, { method: "POST", token, body: { packageId } });
    expect((await ask(a!.token, pkgs[1]!.id)).status).toBe(200);
    expect((await ask(c!.token, pkgs[0]!.id)).status).toBe(200);
    const aRow = await memberRow(t.projectId, a!.user.id);
    const cRow = await memberRow(t.projectId, c!.user.id);
    const fromA = await testDb.swapRequest.findFirstOrThrow({ where: { requesterId: aRow.id } });
    const fromC = await testDb.swapRequest.findFirstOrThrow({ where: { requesterId: cRow.id } });

    expect((await call(`/api/projects/${t.projectId}/members/${cRow.id}/remove`, { method: "POST", token: t.leader.token })).status).toBe(200);
    expect((await call(`/api/projects/${t.projectId}/leave`, { method: "POST", token: a!.token })).status).toBe(200);
    const before = await snapshot(t.projectId);

    const attempts = {
      leftPick: await call(`/api/projects/${t.projectId}/packages/${pkgs[3]!.id}/pick`, { method: "POST", token: a!.token }),
      leftSwap: await ask(a!.token, pkgs[1]!.id),
      leftStart: await call(`/api/projects/${t.projectId}/tasks/${aTask!.id}/start`, { method: "POST", token: a!.token }),
      leftCancel: await call(`/api/swaps/${fromA.id}/cancel`, { method: "POST", token: a!.token }),
      leftAccept: await call(`/api/swaps/${fromC.id}/accept`, { method: "POST", token: a!.token }),
      leftDecline: await call(`/api/swaps/${fromC.id}/decline`, { method: "POST", token: a!.token }),
      removedPick: await call(`/api/projects/${t.projectId}/packages/${pkgs[3]!.id}/pick`, { method: "POST", token: c!.token }),
      removedSwap: await ask(c!.token, pkgs[1]!.id),
      removedStart: await call(`/api/projects/${t.projectId}/tasks/${cTask!.id}/start`, { method: "POST", token: c!.token }),
      removedCancel: await call(`/api/swaps/${fromC.id}/cancel`, { method: "POST", token: c!.token }),
    };
    for (const [name, res] of Object.entries(attempts)) expect([name, res.status]).toEqual([name, 404]);
    expect(await snapshot(t.projectId)).toEqual(before);
  });
});
