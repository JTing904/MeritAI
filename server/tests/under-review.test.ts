// 交了就不换手 (M4 spec §15 #1): a task with a PENDING attempt never changes hands. moveTask refuses it
// (packages.test.ts); switching, swap accept and pick / assign leave it with its submitter, outside the
// package. In the app a submission starts the task, which makes its package started (no switch or swap),
// so these states are written through Prisma: a task someone else started, moved in, then submitted.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { ProjectView } from "../../shared/types";
import { addAttempt, recompute } from "./attempt-rows";
import { call, testDb } from "./helpers";
import { activeWith, freshDb, pickAs, taskOf, viewAs, withPackages, type ActiveTeam } from "./project-fixtures";

beforeEach(freshDb);
afterAll(() => testDb.$disconnect());

const memberId = (view: ProjectView, userId: string) => view.members.find((m) => m.userId === userId)!.id;
const taskRow = (id: string) => testDb.task.findUniqueOrThrow({ where: { id } });

/** Puts a PENDING attempt on `taskId` (owned by `ownerId`) that `starterId` started: the package isn't started. */
async function submittedNotStarted(taskId: string, ownerId: string, starterId: string) {
  await testDb.task.update({ where: { id: taskId }, data: { ownerId, startedAt: new Date(), startedById: starterId, status: "DOING" } });
  await addAttempt(taskId, { no: 1, status: "PENDING", submittedById: ownerId, links: 1 });
  await recompute(taskId);
}

describe("a submission waiting for review stays with its submitter", () => {
  it("when the submitter switches packages: the task leaves the package, the rest goes back to nobody", async () => {
    const t = await activeWith(3);
    const [lin, wang] = t.members as [ActiveTeam["leader"], ActiveTeam["leader"]];
    await pickAs(t.leader.token, t.projectId, 1);
    await pickAs(wang.token, t.projectId, 3);
    expect((await pickAs(lin.token, t.projectId, 2)).status).toBe(200);
    const view = await viewAs(lin.token, t.projectId);
    const linId = memberId(view, lin.user.id);
    const [reviewing, other] = [taskOf(view, 0, 2), taskOf(view, 1, 2)];
    await submittedNotStarted(reviewing.id, linId, memberId(view, wang.user.id));
    await testDb.package.update({ where: { id: view.packages[2]!.id }, data: { ownerId: null } });
    await testDb.task.updateMany({ where: { packageId: view.packages[2]!.id }, data: { ownerId: null } });

    const res = await pickAs(lin.token, t.projectId, 3);
    expect(res.status).toBe(200);
    expect(await taskRow(reviewing.id)).toMatchObject({ ownerId: linId, packageId: null, status: "REVIEWING" });
    expect(await taskRow(other.id)).toMatchObject({ ownerId: null, packageId: view.packages[1]!.id });
    // Still waiting for the leader, and on the submitter's list.
    expect(res.data.tasks.find((x) => x.id === reviewing.id)).toMatchObject({ ownerMemberId: linId, packageId: null, status: "REVIEWING" });
    expect((await viewAs(t.leader.token, t.projectId)).pendingReviews.map((r) => [r.taskId, r.ownerMemberId])).toEqual([[reviewing.id, linId]]);
  });

  it("when a swap is accepted: each side's reviewing task stays with them, outside the package", async () => {
    const t = await withPackages(3);
    const [lin, wang] = t.members as [ActiveTeam["leader"], ActiveTeam["leader"]];
    const linId = memberId(t.view, lin.user.id);
    const wangId = memberId(t.view, wang.user.id);
    const [linReviewing, linOther] = [taskOf(t.view, 0, 2), taskOf(t.view, 1, 2)];
    const [wangReviewing, wangOther] = [taskOf(t.view, 0, 3), taskOf(t.view, 1, 3)];
    const leaderId = memberId(t.view, t.leader.user.id);
    await submittedNotStarted(linReviewing.id, linId, leaderId);
    await submittedNotStarted(wangReviewing.id, wangId, leaderId);
    const pkg2 = t.view.packages[1]!.id;
    const pkg3 = t.view.packages[2]!.id;

    const asked = await call(`/api/projects/${t.projectId}/swaps`, { method: "POST", token: lin.token, body: { packageId: pkg3 } });
    expect(asked.status).toBe(200);
    const swap = await testDb.swapRequest.findFirstOrThrow({ where: { projectId: t.projectId, status: "PENDING" } });
    const res = await call<ProjectView>(`/api/swaps/${swap.id}/accept`, { method: "POST", token: wang.token });
    expect(res.status).toBe(200);

    expect(await taskRow(linReviewing.id)).toMatchObject({ ownerId: linId, packageId: null });
    expect(await taskRow(wangReviewing.id)).toMatchObject({ ownerId: wangId, packageId: null });
    expect(await taskRow(linOther.id)).toMatchObject({ ownerId: wangId, packageId: pkg2 });
    expect(await taskRow(wangOther.id)).toMatchObject({ ownerId: linId, packageId: pkg3 });
  });

  it("when a free package is picked or assigned: a submitted task nobody owns isn't handed to the picker", async () => {
    const t = await activeWith(3);
    const [lin, wang] = t.members as [ActiveTeam["leader"], ActiveTeam["leader"]];
    const pkg2 = t.view.packages[1]!;
    const pkg3 = t.view.packages[2]!;
    const [a2, b2] = [taskOf(t.view, 0, 2), taskOf(t.view, 1, 2)];
    const [a3, b3] = [taskOf(t.view, 0, 3), taskOf(t.view, 1, 3)];
    const leaderId = memberId(t.view, t.leader.user.id);
    // Left by someone's submission in free packages (not reachable through the app; the guard holds anyway).
    for (const id of [a2.id, a3.id]) {
      await testDb.task.update({ where: { id }, data: { startedAt: new Date(), startedById: leaderId, status: "DOING" } });
      await addAttempt(id, { no: 1, status: "PENDING", links: 1 });
      await recompute(id);
    }

    expect((await pickAs(lin.token, t.projectId, 2)).status).toBe(200);
    const linId = memberId(await viewAs(lin.token, t.projectId), lin.user.id);
    expect(await taskRow(a2.id)).toMatchObject({ ownerId: null, packageId: pkg2.id, status: "REVIEWING" });
    expect(await taskRow(b2.id)).toMatchObject({ ownerId: linId });

    const wangId = memberId(await viewAs(wang.token, t.projectId), wang.user.id);
    const assigned = await call(`/api/projects/${t.projectId}/packages/${pkg3.id}/assign`, {
      method: "POST",
      token: t.leader.token,
      body: { memberId: wangId },
    });
    expect(assigned.status).toBe(200);
    expect(await taskRow(a3.id)).toMatchObject({ ownerId: null, packageId: pkg3.id });
    expect(await taskRow(b3.id)).toMatchObject({ ownerId: wangId });
  });
});
