// Leaving, removing and transferring the leader role (srv-core, spec §2 Members).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { ActivityPayload, HomeData, NotificationPayload, ProjectView } from "../../shared/types";
import type { Tx } from "../src/services/tx";
import { call, testDb } from "./helpers";
import { activeWith, DAY, freshDb, joinCode, person, viewAs } from "./project-fixtures";

beforeEach(freshDb);
afterAll(() => testDb.$disconnect());

const HOUR = 60 * 60 * 1000;

/** activeWith plus member ids (leader, then people 1 … n−1) and the packages in index order. */
async function team(n: number, opts: Parameters<typeof activeWith>[1] = {}) {
  const t = await activeWith(n, opts);
  const idOf = (userId: string) => t.view.members.find((m) => m.userId === userId)!.id;
  return {
    ...t,
    leaderId: idOf(t.leader.user.id),
    memberIds: t.members.map((p) => idOf(p.user.id)),
    packages: [...t.view.packages].sort((a, b) => a.index - b.index),
  };
}

/** Gives a package (and every task in it) to a member, as picking would. */
async function own(packageId: string, memberId: string) {
  await testDb.package.update({ where: { id: packageId }, data: { ownerId: memberId } });
  await testDb.task.updateMany({ where: { packageId }, data: { ownerId: memberId } });
}

const leave = (token: string, projectId: string) => call<null>(`/api/projects/${projectId}/leave`, { method: "POST", token });
const remove = (token: string, projectId: string, memberId: string) =>
  call<ProjectView>(`/api/projects/${projectId}/members/${memberId}/remove`, { method: "POST", token });
const transfer = (token: string, projectId: string, memberId: string) =>
  call<ProjectView>(`/api/projects/${projectId}/members/${memberId}/transfer`, { method: "POST", token });
const leaveAsLeader = (token: string, projectId: string, newLeaderMemberId: string) =>
  call<null>(`/api/projects/${projectId}/leave-as-leader`, { method: "POST", token, body: { newLeaderMemberId } });

const notes = (userId: string, type?: NotificationPayload["type"]) =>
  testDb.notification.findMany({ where: { userId, ...(type ? { type } : {}) }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
const events = (projectId: string, type: ActivityPayload["type"]) =>
  testDb.activityEvent.findMany({ where: { projectId, type }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
const versionOf = async (projectId: string) => (await testDb.project.findUniqueOrThrow({ where: { id: projectId } })).packagesVersion;

function pendingSwap(projectId: string, requester: { id: string; packageId: string }, target: { id: string; packageId: string }) {
  const createdAt = new Date(Date.now() - HOUR);
  return testDb.swapRequest.create({
    data: {
      projectId,
      requesterId: requester.id,
      targetId: target.id,
      requesterPackageId: requester.packageId,
      targetPackageId: target.packageId,
      createdAt,
      expiresAt: new Date(createdAt.getTime() + 72 * HOUR),
    },
  });
}

describe("POST /api/projects/:id/leave", () => {
  it("frees the package, keeps finished and in-review work with its owner, releases the rest in place", async () => {
    const t = await team(3);
    const [aId, bId] = t.memberIds as [string, string];
    const [p1, p2] = t.packages;
    const tasks = await testDb.task.findMany({ where: { projectId: t.projectId }, orderBy: { number: "asc" } });
    await own(p1!.id, aId);
    await own(p2!.id, bId);
    // A's package holds a task in every state.
    const started = new Date(Date.now() - DAY);
    const states = [
      { status: "DONE", grade: "PASS", startedAt: started, startedById: aId },
      { status: "REVIEWING", grade: null, startedAt: started, startedById: aId },
      { status: "DOING", grade: null, startedAt: started, startedById: aId },
      { status: "TODO", grade: null, startedAt: null, startedById: null },
      { status: "FAIL", grade: "FAIL", startedAt: started, startedById: aId },
    ] as const;
    for (const [i, state] of states.entries()) {
      await testDb.task.update({ where: { id: tasks[i]!.id }, data: { ...state, packageId: p1!.id, ownerId: aId } });
    }
    await testDb.task.update({ where: { id: tasks[5]!.id }, data: { packageId: p2!.id, ownerId: bId } });
    const version = await versionOf(t.projectId);

    const res = await leave(t.members[0]!.token, t.projectId);
    expect(res).toMatchObject({ status: 200, data: null });

    const view = await viewAs(t.leader.token, t.projectId);
    const a = view.members.find((m) => m.id === aId)!;
    expect(a).toMatchObject({ active: false, removed: false, packageId: null, needsPackage: false, unfinishedCount: 1 });
    expect(a.leftAt).not.toBeNull();
    expect(a.earnedPoints).toBe(tasks[0]!.points);
    expect(view.earnedPoints).toBe(tasks[0]!.points);

    const byId = new Map(view.tasks.map((task) => [task.id, task]));
    // Finished and in-review work stays theirs (points, grades) but leaves the package.
    expect(byId.get(tasks[0]!.id)).toMatchObject({ ownerMemberId: aId, packageId: null, status: "DONE" });
    expect(byId.get(tasks[1]!.id)).toMatchObject({ ownerMemberId: aId, packageId: null, status: "REVIEWING" });
    // The rest is released and stays in the package: nobody owns it and it is no longer started.
    const released = { ownerMemberId: null, packageId: p1!.id, startedAt: null, startedByMemberId: null };
    expect(byId.get(tasks[2]!.id)).toMatchObject({ ...released, status: "TODO", locked: false });
    expect(byId.get(tasks[3]!.id)).toMatchObject({ ...released, status: "TODO" });
    expect(byId.get(tasks[4]!.id)).toMatchObject({ ...released, status: "FAIL" });
    expect(byId.get(tasks[5]!.id)).toMatchObject({ ownerMemberId: bId, packageId: p2!.id });
    const pkg1 = view.packages.find((p) => p.id === p1!.id)!;
    expect(pkg1).toMatchObject({ ownerMemberId: null, started: false });
    expect([...pkg1.taskIds].sort()).toEqual([tasks[2]!.id, tasks[3]!.id, tasks[4]!.id].sort());
    expect(view.packagesVersion).toBeGreaterThan(version);

    // Everyone still in the project hears about it (not 「跟我有关」); the one who left hears nothing.
    for (const p of [t.leader, t.members[1]!]) {
      const sent = await notes(p.user.id, "MEMBER_LEFT");
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ projectId: t.projectId, audience: "GROUP", mine: false });
      expect(sent[0]!.payload).toEqual({ type: "MEMBER_LEFT", member: { memberId: aId, name: "林晓雯" }, unfinishedCount: 3 });
    }
    expect(await notes(t.members[0]!.user.id)).toHaveLength(0);
    const left = await events(t.projectId, "LEFT");
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ actorId: aId, payload: { type: "LEFT" } });

    // Gone from their home screen and the project.
    expect((await call(`/api/projects/${t.projectId}`, { token: t.members[0]!.token })).status).toBe(404);
    const home = await call<HomeData>("/api/home", { token: t.members[0]!.token });
    expect(home.data.projects).toEqual([]);
    expect((await leave(t.members[0]!.token, t.projectId)).status).toBe(404);
  });

  it("counts nothing unfinished when all their work was done", async () => {
    const t = await team(3);
    const [aId] = t.memberIds as [string];
    await own(t.packages[0]!.id, aId);
    await testDb.task.updateMany({ where: { packageId: t.packages[0]!.id }, data: { status: "DONE", grade: "PASS", startedById: aId } });
    await leave(t.members[0]!.token, t.projectId);
    const sent = await notes(t.leader.user.id, "MEMBER_LEFT");
    expect(sent[0]!.payload).toMatchObject({ unfinishedCount: 0 });
    // The package keeps its number but no tasks: the done work went with its owner.
    const view = await viewAs(t.leader.token, t.projectId);
    expect(view.packages.find((p) => p.id === t.packages[0]!.id)).toMatchObject({ ownerMemberId: null, taskIds: [], points: 0 });
  });

  it("lets them come back with the code: joined again now, their finished points still theirs", async () => {
    const t = await team(3);
    const [aId] = t.memberIds as [string];
    await own(t.packages[0]!.id, aId);
    const done = (await testDb.task.findFirstOrThrow({ where: { packageId: t.packages[0]!.id } })).id;
    await testDb.task.update({ where: { id: done }, data: { status: "DONE", grade: "PASS", startedById: aId } });
    const before = await testDb.member.findUniqueOrThrow({ where: { id: aId } });
    await leave(t.members[0]!.token, t.projectId);

    const back = await joinCode(t.members[0]!.token, t.view.inviteCode!);
    expect(back.status).toBe(200);
    const me = back.data.members.find((m) => m.id === aId)!;
    expect(me).toMatchObject({ active: true, leftAt: null, packageId: null, needsPackage: true });
    expect(me.earnedPoints).toBeGreaterThan(0);
    expect(new Date(me.joinedAt).getTime()).toBeGreaterThan(before.joinedAt.getTime());
    expect(back.data.tasks.find((task) => task.id === done)).toMatchObject({ ownerMemberId: aId, packageId: null });
    expect(await events(t.projectId, "JOINED")).toHaveLength(3);
  });

  it("is refused to the leader until they hand the role over", async () => {
    const t = await team(3);
    const res = await leave(t.leader.token, t.projectId);
    expect(res).toMatchObject({ status: 409, error: { code: "LEADER_MUST_TRANSFER" } });
    expect((await transfer(t.leader.token, t.projectId, t.memberIds[0]!)).status).toBe(200);
    expect((await leave(t.leader.token, t.projectId)).status).toBe(200);
  });

  it("voids their pending swaps, telling only requesters still in the project", async () => {
    const t = await team(3);
    const [aId, bId] = t.memberIds as [string, string];
    const [p1, p2, p3] = t.packages;
    await own(p1!.id, aId);
    await own(p2!.id, bId);
    await own(p3!.id, t.leaderId);
    const toA = await pendingSwap(t.projectId, { id: bId, packageId: p2!.id }, { id: aId, packageId: p1!.id });
    const fromA = await pendingSwap(t.projectId, { id: aId, packageId: p1!.id }, { id: t.leaderId, packageId: p3!.id });

    await leave(t.members[0]!.token, t.projectId);
    for (const id of [toA.id, fromA.id]) {
      expect(await testDb.swapRequest.findUniqueOrThrow({ where: { id } })).toMatchObject({
        status: "VOID",
        voidReason: "LEFT",
        voidedById: aId,
      });
    }
    // B asked A: SWAP_VOID. A asked the leader, but A is gone: nothing for A, and the leader (the target) gets none.
    const forB = await notes(t.members[1]!.user.id, "SWAP_VOID");
    expect(forB.map((n) => n.payload)).toEqual([
      { type: "SWAP_VOID", target: { memberId: aId, name: "林晓雯" }, reason: "LEFT" },
    ]);
    expect(await notes(t.members[0]!.user.id)).toHaveLength(0);
    expect(await notes(t.leader.user.id, "SWAP_VOID")).toHaveLength(0);
  });

  it("needs sign-in and an active membership; an ENDED project can still be left (M5)", async () => {
    const t = await team(3);
    const stranger = await person(5);
    expect((await leave("", t.projectId)).status).toBe(401);
    expect((await leave(stranger.token, t.projectId)).status).toBe(404);
    await testDb.project.update({ where: { id: t.projectId }, data: { status: "ENDED" } });
    expect((await leave(t.members[0]!.token, t.projectId)).status).toBe(200);
  });
});

describe("POST /api/projects/:id/members/:memberId/remove", () => {
  it("works like leaving, keeps them out and tells the group and the person", async () => {
    const t = await team(3);
    const [aId, bId] = t.memberIds as [string, string];
    await own(t.packages[1]!.id, bId);
    const [done, todo] = await testDb.task.findMany({ where: { packageId: t.packages[1]!.id }, orderBy: { number: "asc" } });
    await testDb.task.update({ where: { id: done!.id }, data: { status: "DONE", grade: "PASS", startedAt: new Date(), startedById: bId } });

    const res = await remove(t.leader.token, t.projectId, bId);
    expect(res.status).toBe(200);
    expect(res.data.viewerRole).toBe("LEADER");
    const b = res.data.members.find((m) => m.id === bId)!;
    expect(b).toMatchObject({ active: false, removed: true, packageId: null, earnedPoints: done!.points });
    expect(res.data.packages[1]).toMatchObject({ ownerMemberId: null, taskIds: [todo!.id] });
    expect(res.data.tasks.find((task) => task.id === todo!.id)).toMatchObject({ ownerMemberId: null });

    // The group minus the leader who did it; the removed person gets REMOVED_YOU.
    const forA = await notes(t.members[0]!.user.id, "MEMBER_REMOVED");
    expect(forA).toHaveLength(1);
    expect(forA[0]).toMatchObject({ audience: "GROUP", mine: false });
    expect(forA[0]!.payload).toEqual({ type: "MEMBER_REMOVED", member: { memberId: bId, name: "王子杰" }, unfinishedCount: 1 });
    expect(await notes(t.leader.user.id)).toHaveLength(0);
    const forB = await notes(t.members[1]!.user.id);
    expect(forB.map((n) => [n.type, n.audience, n.payload])).toEqual([["REMOVED_YOU", "ONLY_YOU", { type: "REMOVED_YOU" }]]);
    const removed = await events(t.projectId, "REMOVED");
    expect(removed).toHaveLength(1);
    expect(removed[0]).toMatchObject({ actorId: t.leaderId, payload: { type: "REMOVED", member: { memberId: bId, name: "王子杰" } } });

    // They can't come back with the code, nor see the project.
    expect((await joinCode(t.members[1]!.token, t.view.inviteCode!)).error?.code).toBe("REMOVED_FROM_PROJECT");
    expect((await call(`/api/projects/${t.projectId}`, { token: t.members[1]!.token })).status).toBe(404);
    // A is unaffected.
    expect((await viewAs(t.members[0]!.token, t.projectId)).members.find((m) => m.id === aId)).toMatchObject({ active: true });
  });

  it("voids the removed person's swaps without telling them", async () => {
    const t = await team(3);
    const [aId, bId] = t.memberIds as [string, string];
    const [p1, p2, p3] = t.packages;
    await own(p1!.id, aId);
    await own(p2!.id, bId);
    await own(p3!.id, t.leaderId);
    const fromB = await pendingSwap(t.projectId, { id: bId, packageId: p2!.id }, { id: aId, packageId: p1!.id });
    const toB = await pendingSwap(t.projectId, { id: aId, packageId: p1!.id }, { id: bId, packageId: p2!.id });

    await remove(t.leader.token, t.projectId, bId);
    for (const id of [fromB.id, toB.id]) {
      expect(await testDb.swapRequest.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "VOID", voidReason: "LEFT", voidedById: bId });
    }
    expect(await notes(t.members[1]!.user.id, "SWAP_VOID")).toHaveLength(0);
    const forA = await notes(t.members[0]!.user.id, "SWAP_VOID");
    expect(forA.map((n) => [n.swapId, n.payload])).toEqual([
      [toB.id, { type: "SWAP_VOID", target: { memberId: bId, name: "王子杰" }, reason: "LEFT" }],
    ]);
  });

  it("is the leader's, for another active member of this project", async () => {
    const t = await team(3);
    const other = await team(2);
    const [aId, bId] = t.memberIds as [string, string];
    expect((await remove(t.members[0]!.token, t.projectId, bId)).error?.code).toBe("FORBIDDEN");
    expect((await remove(t.leader.token, t.projectId, t.leaderId)).error?.code).toBe("VALIDATION");
    expect((await remove(t.leader.token, t.projectId, "nobody")).status).toBe(404);
    expect((await remove(t.leader.token, t.projectId, other.memberIds[0]!)).status).toBe(404);
    expect((await remove(t.leader.token, t.projectId, aId)).status).toBe(200);
    expect((await remove(t.leader.token, t.projectId, aId)).status).toBe(404);
    expect((await remove((await person(5)).token, t.projectId, bId)).status).toBe(404);
  });
});

describe("POST /api/projects/:id/members/:memberId/transfer", () => {
  it("swaps the roles, turns 「只管理」 off and reminds the new leader the old one has no package", async () => {
    const t = await team(3, { leaderManages: true });
    const [aId, bId] = t.memberIds as [string, string];
    // Two packages, both picked.
    await own(t.packages[0]!.id, aId);
    await own(t.packages[1]!.id, bId);
    const version = await versionOf(t.projectId);

    const res = await transfer(t.leader.token, t.projectId, aId);
    expect(res.status).toBe(200);
    // Answered as the old leader sees it now.
    expect(res.data).toMatchObject({ viewerRole: "MEMBER", viewerNeedsPackage: true });
    expect(res.data.basics.leaderManages).toBe(false);
    expect(res.data.members.map((m) => [m.id, m.role])).toEqual([
      [aId, "LEADER"],
      [t.leaderId, "MEMBER"],
      [bId, "MEMBER"],
    ]);
    expect(res.data.members.find((m) => m.id === aId)).toMatchObject({ packageId: t.packages[0]!.id, needsPackage: false });
    expect(res.data.members.find((m) => m.id === t.leaderId)).toMatchObject({ packageId: null, needsPackage: true });
    expect(res.data.packagesVersion).toBeGreaterThan(version);

    const forA = await notes(t.members[0]!.user.id);
    expect(forA.map((n) => [n.type, n.audience, n.payload])).toEqual([
      ["LEADER_TRANSFERRED", "ONLY_YOU", { type: "LEADER_TRANSFERRED", from: { memberId: t.leaderId, name: "陈思远" } }],
      ["MEMBER_NEEDS_PACKAGE", "ONLY_LEADER", { type: "MEMBER_NEEDS_PACKAGE", member: { memberId: t.leaderId, name: "陈思远" }, joined: false }],
    ]);
    expect(await notes(t.leader.user.id)).toHaveLength(0);
    const feed = await events(t.projectId, "LEADER_TRANSFERRED");
    expect(feed.map((e) => [e.actorId, e.payload])).toEqual([
      [t.leaderId, { type: "LEADER_TRANSFERRED", member: { memberId: aId, name: "林晓雯" } }],
    ]);

    // The new leader runs things now; the old one can't.
    expect((await transfer(t.leader.token, t.projectId, bId)).error?.code).toBe("FORBIDDEN");
    expect((await leave(t.members[0]!.token, t.projectId)).error?.code).toBe("LEADER_MUST_TRANSFER");
    expect((await viewAs(t.members[0]!.token, t.projectId)).viewerRole).toBe("LEADER");
  });

  it("tells the new leader about everyone still waiting, but not while a package is free", async () => {
    const t = await team(2);
    const [aId] = t.memberIds as [string];
    await own(t.packages[0]!.id, t.leaderId);
    await own(t.packages[1]!.id, aId);
    // A third person joins with every package taken: the old leader is reminded once.
    const late = await person(2);
    const joined = await joinCode(late.token, t.view.inviteCode!);
    const lateId = joined.data.viewerMemberId;
    expect(await notes(t.leader.user.id, "MEMBER_NEEDS_PACKAGE")).toHaveLength(1);

    await transfer(t.leader.token, t.projectId, aId);
    const forA = await notes(t.members[0]!.user.id, "MEMBER_NEEDS_PACKAGE");
    expect(forA.map((n) => n.payload)).toEqual([{ type: "MEMBER_NEEDS_PACKAGE", member: { memberId: lateId, name: "王子杰" }, joined: false }]);

    // With a free package nobody is reminded.
    const t2 = await team(3);
    await own(t2.packages[0]!.id, t2.memberIds[0]!);
    const res = await transfer(t2.leader.token, t2.projectId, t2.memberIds[0]!);
    expect(res.data.basics.leaderManages).toBe(false);
    expect(await testDb.notification.count({ where: { projectId: t2.projectId, type: "MEMBER_NEEDS_PACKAGE" } })).toBe(0);
  });

  it("is the leader's, to another active member", async () => {
    const t = await team(3);
    const [aId, bId] = t.memberIds as [string, string];
    expect((await transfer(t.members[0]!.token, t.projectId, bId)).error?.code).toBe("FORBIDDEN");
    expect((await transfer(t.leader.token, t.projectId, t.leaderId)).error?.code).toBe("VALIDATION");
    expect((await transfer(t.leader.token, t.projectId, "nobody")).status).toBe(404);
    await leave(t.members[0]!.token, t.projectId);
    expect((await transfer(t.leader.token, t.projectId, aId)).status).toBe(404);
    expect(await testDb.member.count({ where: { projectId: t.projectId, role: "LEADER" } })).toBe(1);
  });
});

describe("POST /api/projects/:id/leave-as-leader", () => {
  it("hands the role over and leaves in one step, turning 「只管理」 off", async () => {
    const t = await team(3, { leaderManages: true });
    const [aId, bId] = t.memberIds as [string, string];
    await own(t.packages[0]!.id, aId);
    const version = await versionOf(t.projectId);

    const res = await leaveAsLeader(t.leader.token, t.projectId, aId);
    expect(res).toMatchObject({ status: 200, data: null });

    const view = await viewAs(t.members[0]!.token, t.projectId);
    expect(view.viewerRole).toBe("LEADER");
    expect(view.basics.leaderManages).toBe(false);
    expect(view.members.find((m) => m.id === t.leaderId)).toMatchObject({ role: "MEMBER", active: false, removed: false });
    expect(view.members.find((m) => m.id === aId)).toMatchObject({ role: "LEADER", active: true, packageId: t.packages[0]!.id });
    expect(view.members.find((m) => m.id === bId)).toMatchObject({ role: "MEMBER", active: true });
    expect(view.packagesVersion).toBeGreaterThan(version);
    expect(await testDb.member.count({ where: { projectId: t.projectId, role: "LEADER" } })).toBe(1);

    // The new leader: LEADER_TRANSFERRED (left after) and the group's MEMBER_LEFT; never a reminder about the
    // old leader, who is gone. B: MEMBER_LEFT. The old leader: nothing.
    const forA = await notes(t.members[0]!.user.id);
    expect(forA.map((n) => [n.type, n.audience, n.payload])).toEqual([
      ["LEADER_TRANSFERRED", "ONLY_YOU", { type: "LEADER_TRANSFERRED", from: { memberId: t.leaderId, name: "陈思远" }, leftAfter: true }],
      ["MEMBER_LEFT", "GROUP", { type: "MEMBER_LEFT", member: { memberId: t.leaderId, name: "陈思远" }, unfinishedCount: 0 }],
    ]);
    const forB = await notes(t.members[1]!.user.id);
    expect(forB.map((n) => n.type)).toEqual(["MEMBER_LEFT"]);
    expect(await notes(t.leader.user.id)).toHaveLength(0);
    expect((await events(t.projectId, "LEADER_TRANSFERRED")).map((e) => [e.actorId, e.payload])).toEqual([
      [t.leaderId, { type: "LEADER_TRANSFERRED", member: { memberId: aId, name: "林晓雯" } }],
    ]);
    expect((await events(t.projectId, "LEFT")).map((e) => e.actorId)).toEqual([t.leaderId]);

    // Gone for the old leader.
    expect((await call(`/api/projects/${t.projectId}`, { token: t.leader.token })).status).toBe(404);
    expect((await call<HomeData>("/api/home", { token: t.leader.token })).data.projects).toEqual([]);
  });

  it("releases the old leader's unfinished work and frees their package, like leaving", async () => {
    const t = await team(3);
    const [aId, bId] = t.memberIds as [string, string];
    const [p1, p2, p3] = t.packages;
    await own(p1!.id, t.leaderId);
    await own(p2!.id, aId);
    await own(p3!.id, bId);
    const [done] = await testDb.task.findMany({ where: { packageId: p1!.id }, orderBy: { number: "asc" } });
    await testDb.task.update({ where: { id: done!.id }, data: { status: "DONE", grade: "PASS", startedAt: new Date(), startedById: t.leaderId } });
    // A swap the leader asked for ends with them.
    const swap = await pendingSwap(t.projectId, { id: t.leaderId, packageId: p1!.id }, { id: bId, packageId: p3!.id });

    expect((await leaveAsLeader(t.leader.token, t.projectId, bId)).status).toBe(200);
    const view = await viewAs(t.members[1]!.token, t.projectId);
    expect(view.packages.find((p) => p.id === p1!.id)).toMatchObject({ ownerMemberId: null });
    expect(view.tasks.find((task) => task.id === done!.id)).toMatchObject({ ownerMemberId: t.leaderId, packageId: null });
    expect(view.members.find((m) => m.id === t.leaderId)).toMatchObject({ active: false, earnedPoints: done!.points });
    expect(await testDb.swapRequest.findUniqueOrThrow({ where: { id: swap.id } })).toMatchObject({ status: "VOID", voidReason: "LEFT" });
    const left = await notes(t.members[0]!.user.id, "MEMBER_LEFT");
    expect(left[0]!.payload).toMatchObject({ unfinishedCount: 1 });
    // A package is free now, so nobody is reminded to re-split.
    expect(await testDb.notification.count({ where: { projectId: t.projectId, type: "MEMBER_NEEDS_PACKAGE" } })).toBe(0);
  });

  it("tells the new leader about someone still waiting for a package", async () => {
    // With a leader who only manages (no package to free), someone who joined late still has none.
    const t = await team(3, { leaderManages: true });
    const [aId, bId] = t.memberIds as [string, string];
    await own(t.packages[0]!.id, aId);
    await own(t.packages[1]!.id, bId);
    const late = await person(3);
    const lateId = (await joinCode(late.token, t.view.inviteCode!)).data.viewerMemberId;
    expect(await notes(t.leader.user.id, "MEMBER_NEEDS_PACKAGE")).toHaveLength(1);

    await leaveAsLeader(t.leader.token, t.projectId, aId);
    const forA = await notes(t.members[0]!.user.id, "MEMBER_NEEDS_PACKAGE");
    expect(forA.map((n) => n.payload)).toEqual([{ type: "MEMBER_NEEDS_PACKAGE", member: { memberId: lateId, name: "张博文" }, joined: false }]);
  });

  it("is the leader's, to another active member; alone, there is no one to hand it to", async () => {
    const t = await team(3);
    const [aId, bId] = t.memberIds as [string, string];
    const other = await team(2);
    expect((await leaveAsLeader(t.members[0]!.token, t.projectId, bId)).error?.code).toBe("FORBIDDEN");
    expect((await leaveAsLeader(t.leader.token, t.projectId, t.leaderId)).error?.code).toBe("VALIDATION");
    expect((await leaveAsLeader(t.leader.token, t.projectId, "nobody")).status).toBe(404);
    expect((await leaveAsLeader(t.leader.token, t.projectId, other.memberIds[0]!)).status).toBe(404);
    await leave(t.members[0]!.token, t.projectId);
    expect((await leaveAsLeader(t.leader.token, t.projectId, aId)).status).toBe(404);
    expect((await call(`/api/projects/${t.projectId}/leave-as-leader`, { method: "POST", token: t.leader.token, body: {} })).status).toBe(400);
    expect((await leaveAsLeader("", t.projectId, bId)).status).toBe(401);
    // Nothing changed.
    expect(await testDb.member.findUniqueOrThrow({ where: { id: t.leaderId } })).toMatchObject({ role: "LEADER", leftAt: null });

    // B leaves too: the leader is alone.
    await leave(t.members[1]!.token, t.projectId);
    expect(await leaveAsLeader(t.leader.token, t.projectId, bId)).toMatchObject({ status: 409, error: { code: "NO_ONE_TO_TRANSFER" } });
    expect(await testDb.member.findUniqueOrThrow({ where: { id: t.leaderId } })).toMatchObject({ role: "LEADER", leftAt: null });
  });

  it("works in an ENDED project too (M5: leaving is allowed after the end)", async () => {
    const t = await team(2);
    await testDb.project.update({ where: { id: t.projectId }, data: { status: "ENDED" } });
    expect((await leaveAsLeader(t.leader.token, t.projectId, t.memberIds[0]!)).status).toBe(200);
    expect(await testDb.member.findUniqueOrThrow({ where: { id: t.leaderId } })).toMatchObject({ role: "MEMBER" });
  });
});

describe("races between people acting at once", () => {
  it("leaving as leader and a transfer at the same time: one wins, exactly one active leader", async () => {
    const t = await team(3);
    const [aId, bId] = t.memberIds as [string, string];
    const [left, moved] = await Promise.all([leaveAsLeader(t.leader.token, t.projectId, aId), transfer(t.leader.token, t.projectId, bId)]);
    // The loser gets 403 under the lock, or 404 when the leave already committed before its access check.
    const statuses = [left.status, moved.status].sort();
    expect(statuses[0]).toBe(200);
    expect([403, 404]).toContain(statuses[1]);
    const leaders = await testDb.member.findMany({ where: { projectId: t.projectId, role: "LEADER", leftAt: null, removed: false } });
    expect(leaders).toHaveLength(1);
    const old = await testDb.member.findUniqueOrThrow({ where: { id: t.leaderId } });
    if (left.status === 200) {
      expect(leaders[0]!.id).toBe(aId);
      expect(old.leftAt).not.toBeNull();
    } else {
      expect(leaders[0]!.id).toBe(bId);
      expect(old).toMatchObject({ role: "MEMBER", leftAt: null });
    }
    expect(await testDb.notification.count({ where: { type: "LEADER_TRANSFERRED" } })).toBe(1);
  });

  it("two transfers at the same time leave exactly one leader", async () => {
    const t = await team(3);
    const [aId, bId] = t.memberIds as [string, string];
    const results = await Promise.all([transfer(t.leader.token, t.projectId, aId), transfer(t.leader.token, t.projectId, bId)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 403]);
    const leaders = await testDb.member.findMany({ where: { projectId: t.projectId, role: "LEADER" } });
    expect(leaders).toHaveLength(1);
    expect([aId, bId]).toContain(leaders[0]!.id);
    expect(await testDb.notification.count({ where: { type: "LEADER_TRANSFERRED" } })).toBe(1);
  });

  it("a transfer and the new leader leaving at the same time: one wins, the project keeps an active leader", async () => {
    const t = await team(3);
    const [aId] = t.memberIds as [string];
    const [moved, left] = await Promise.all([
      transfer(t.leader.token, t.projectId, aId),
      leave(t.members[0]!.token, t.projectId),
    ]);
    const a = await testDb.member.findUniqueOrThrow({ where: { id: aId } });
    if (moved.status === 200) {
      expect(left.error?.code).toBe("LEADER_MUST_TRANSFER");
      expect(a).toMatchObject({ role: "LEADER", leftAt: null });
    } else {
      expect(moved.status).toBe(404);
      expect(left.status).toBe(200);
      expect(a.leftAt).not.toBeNull();
    }
    const leaders = await testDb.member.findMany({ where: { projectId: t.projectId, role: "LEADER", leftAt: null, removed: false } });
    expect(leaders).toHaveLength(1);
  });

  it("removing someone while they pick: they end up out, and the package free", async () => {
    const t = await team(3);
    const [, bId] = t.memberIds as [string, string];
    const pick = `/api/projects/${t.projectId}/packages/${t.packages[0]!.id}/pick`;
    const [removed, picked] = await Promise.all([
      remove(t.leader.token, t.projectId, bId),
      call<ProjectView>(pick, { method: "POST", token: t.members[1]!.token }),
    ]);
    expect(removed.status).toBe(200);
    expect([200, 404]).toContain(picked.status);
    expect(await testDb.member.findUniqueOrThrow({ where: { id: bId } })).toMatchObject({ removed: true });
    expect(await testDb.package.count({ where: { projectId: t.projectId, ownerId: bId } })).toBe(0);
    expect(await testDb.task.count({ where: { projectId: t.projectId, ownerId: bId } })).toBe(0);
    expect((await viewAs(t.leader.token, t.projectId)).packages[0]!.ownerMemberId).toBeNull();
  });
});

describe("writes re-check the caller under the project lock", () => {
  /** Resolves once some request of this test database is waiting on a row lock. */
  async function someoneWaitsOnALock() {
    for (let i = 0; i < 250; i++) {
      const [row] = await testDb.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`;
      if (row!.n > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error("The request never waited on the project lock");
  }

  /**
   * Holds the project row lock, sends `request` (its route checks pass, then it waits on the lock),
   * makes `change` in the holding transaction and commits: the request then runs after the change.
   */
  async function afterChange<T>(projectId: string, request: () => Promise<T>, change: (tx: Tx) => Promise<unknown>): Promise<T> {
    let pending: Promise<T> | undefined;
    await testDb.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId} FOR UPDATE`;
        pending = request();
        await someoneWaitsOnALock();
        await change(tx);
      },
      { timeout: 20_000, maxWait: 10_000 },
    );
    return pending!;
  }

  /** What 转让组长 does to the roles (the old leader keeps their membership). */
  const handOver = (from: string, to: string) => async (tx: Tx) => {
    await tx.member.update({ where: { id: from }, data: { role: "MEMBER" } });
    await tx.member.update({ where: { id: to }, data: { role: "LEADER" } });
  };

  it("editing the project after the leader role moved on is refused", async () => {
    const t = await team(3);
    const before = await testDb.project.findUniqueOrThrow({ where: { id: t.projectId } });
    const res = await afterChange(
      t.projectId,
      () =>
        call(`/api/projects/${t.projectId}`, {
          method: "PATCH",
          token: t.leader.token,
          body: { name: "改名了", deadline: new Date(before.deadline.getTime() + 7 * DAY).toISOString() },
        }),
      handOver(t.leaderId, t.memberIds[0]!),
    );
    expect([res.status, res.error?.code]).toEqual([403, "FORBIDDEN"]);
    const after = await testDb.project.findUniqueOrThrow({ where: { id: t.projectId } });
    expect(after).toMatchObject({ name: before.name, deadline: before.deadline });
  });

  it("regenerating the invite code after the leader role moved on is refused", async () => {
    const t = await team(3);
    const before = await testDb.project.findUniqueOrThrow({ where: { id: t.projectId } });
    const res = await afterChange(
      t.projectId,
      () => call(`/api/projects/${t.projectId}/invite-code/reset`, { method: "POST", token: t.leader.token }),
      handOver(t.leaderId, t.memberIds[0]!),
    );
    expect([res.status, res.error?.code]).toEqual([403, "FORBIDDEN"]);
    expect((await testDb.project.findUniqueOrThrow({ where: { id: t.projectId } })).inviteCode).toBe(before.inviteCode);
    expect(await testDb.retiredInviteCode.count({ where: { projectId: t.projectId } })).toBe(0);
  });

  it("inviting people after being removed is refused", async () => {
    const t = await team(3);
    const bId = t.memberIds[1]!;
    const res = await afterChange(
      t.projectId,
      () => call(`/api/projects/${t.projectId}/invites`, { method: "POST", token: t.members[1]!.token, body: { targets: "someone@example.com" } }),
      (tx) => tx.member.update({ where: { id: bId }, data: { removed: true, leftAt: new Date() } }),
    );
    expect(res.status).toBe(404);
    expect(await testDb.invite.count({ where: { projectId: t.projectId } })).toBe(0);
  });

  it("a waiting edit by someone who still leads goes through (control)", async () => {
    const t = await team(2);
    const res = await afterChange(
      t.projectId,
      () => call<ProjectView>(`/api/projects/${t.projectId}`, { method: "PATCH", token: t.leader.token, body: { name: "新名字" } }),
      async () => undefined,
    );
    expect(res.status).toBe(200);
    // Answered with the view as the caller is now.
    expect(res.data).toMatchObject({ viewerRole: "LEADER", basics: { name: "新名字" } });
  });
});
