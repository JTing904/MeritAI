// 为所有人删除项目, 恢复项目 and the purge after 7 days (REQUIREMENTS §13 「组长退出 / 删除项目」).
import { readdir } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { HomeData, MyTasksView, NotificationPage, NotificationPayload, ProjectView } from "../../shared/types";
import { purgeDeletedProjects, restoreProject } from "../src/services/project-delete";
import { call, testDb } from "./helpers";
import {
  activeWith,
  createActive,
  createDraft,
  DAY,
  fakeFile,
  freshDb,
  joinCode,
  person,
  pickAs,
  taskOf,
  uploadDir,
  uploadEvidence,
  viewAs,
  withPackages,
} from "./project-fixtures";

beforeEach(freshDb);
afterAll(() => testDb.$disconnect());

const HOUR = 60 * 60 * 1000;

const del = (token: string, projectId: string, confirm: string) =>
  call<null>(`/api/projects/${projectId}/delete`, { method: "POST", token, body: { confirm } });
const restore = (token: string, projectId: string) => call<null>(`/api/projects/${projectId}/restore`, { method: "POST", token });
const home = async (token: string) => (await call<HomeData>("/api/home", { token })).data;
const notes = (userId: string, type?: NotificationPayload["type"]) =>
  testDb.notification.findMany({ where: { userId, ...(type ? { type } : {}) }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
const memberIdOf = (view: ProjectView, userId: string) => view.members.find((m) => m.userId === userId)!.id;

/** Files under UPLOAD_DIR/<projectId> ([] when the folder doesn't exist). */
async function filesOf(projectId: string): Promise<string[]> {
  try {
    const entries = await readdir(path.join(uploadDir(), projectId), { recursive: true, withFileTypes: true });
    return entries.filter((e) => e.isFile()).map((e) => e.name);
  } catch {
    return [];
  }
}

describe("POST /api/projects/:id/delete", () => {
  it("needs the project tag typed (case and spaces ignored), from the leader", async () => {
    const t = await activeWith(3);
    const before = await testDb.project.findUniqueOrThrow({ where: { id: t.projectId } });

    for (const typed of ["", "CS30", "CS302x", "校园二手市场 App"]) {
      expect(await del(t.leader.token, t.projectId, typed)).toMatchObject({ status: 400, error: { code: "DELETE_CONFIRM_MISMATCH" } });
    }
    expect((await del(t.members[0]!.token, t.projectId, "CS302")).error?.code).toBe("FORBIDDEN");
    expect((await del("", t.projectId, "CS302")).status).toBe(401);
    expect((await del((await person(5)).token, t.projectId, "CS302")).status).toBe(404);
    expect(await testDb.project.findUniqueOrThrow({ where: { id: t.projectId } })).toMatchObject({
      deletedAt: null,
      packagesVersion: before.packagesVersion,
    });
    expect(await testDb.notification.count({ where: { type: "PROJECT_DELETED" } })).toBe(0);

    expect((await del(t.leader.token, t.projectId, " cs 302 ")).status).toBe(200);
    const row = await testDb.project.findUniqueOrThrow({ where: { id: t.projectId } });
    expect(row.deletedAt).not.toBeNull();
    expect(row.purgeAfter!.getTime() - row.deletedAt!.getTime()).toBe(7 * DAY);
    expect(row.deletedById).toBe(memberIdOf(t.view, t.leader.user.id));
    // Deleting it again: it is gone as far as the API is concerned.
    expect((await del(t.leader.token, t.projectId, "CS302")).status).toBe(404);
  });

  it("uses the tag made from the name when there is no short code", async () => {
    const t = await activeWith(2, { shortCode: null, name: "Mobile Computing Project" });
    expect((await del(t.leader.token, t.projectId, "Mobile Computing")).error?.code).toBe("DELETE_CONFIRM_MISMATCH");
    expect((await del(t.leader.token, t.projectId, "mobile")).status).toBe(200);
  });

  it("refuses drafts (they are deleted outright) and ended projects; a project past its deadline is fine", async () => {
    const leader = await person(0);
    const draft = await createDraft(leader.token);
    expect((await del(leader.token, draft.basics.id, "CS302")).error?.code).toBe("CONFLICT");

    const t = await activeWith(2);
    await testDb.project.update({ where: { id: t.projectId }, data: { status: "ENDED" } });
    expect((await del(t.leader.token, t.projectId, "CS302")).error?.code).toBe("PROJECT_ENDED");
    await testDb.project.update({ where: { id: t.projectId }, data: { status: "AWAITING_CONFIRM" } });
    expect((await del(t.leader.token, t.projectId, "CS302")).status).toBe(200);
  });

  it("hides the project from every member at once, everywhere", async () => {
    const t = await withPackages(3);
    const [a] = t.members;
    const aTask = taskOf(t.view, 0, 2);

    expect((await del(t.leader.token, t.projectId, "CS302")).status).toBe(200);

    for (const p of [t.leader, ...t.members]) {
      expect((await call(`/api/projects/${t.projectId}`, { token: p.token })).status).toBe(404);
      expect((await call(`/api/projects/${t.projectId}/feed`, { token: p.token })).status).toBe(404);
      expect((await call(`/api/projects/${t.projectId}/tasks/${aTask.id}`, { token: p.token })).status).toBe(404);
      const h = await home(p.token);
      expect(h.projects.map((c) => c.id)).not.toContain(t.projectId);
      const mine = (await call<MyTasksView>("/api/tasks/mine", { token: p.token })).data;
      expect([...mine.open, ...mine.done].map((r) => r.projectId)).not.toContain(t.projectId);
    }
    // Every write answers 404 too (the lock re-checks it).
    const writes = [
      call(`/api/projects/${t.projectId}/tasks/${aTask.id}/start`, { method: "POST", token: a!.token }),
      call(`/api/projects/${t.projectId}/leave`, { method: "POST", token: a!.token }),
      call(`/api/projects/${t.projectId}/invites`, { method: "POST", token: a!.token, body: { targets: "x@example.com" } }),
      call(`/api/projects/${t.projectId}`, { method: "PATCH", token: t.leader.token, body: { name: "新名字" } }),
      call(`/api/projects/${t.projectId}/invite-code/reset`, { method: "POST", token: t.leader.token }),
      call(`/api/projects/${t.projectId}/members/${memberIdOf(t.view, a!.user.id)}/transfer`, { method: "POST", token: t.leader.token }),
      call(`/api/projects/${t.projectId}/leave-as-leader`, {
        method: "POST",
        token: t.leader.token,
        body: { newLeaderMemberId: memberIdOf(t.view, a!.user.id) },
      }),
    ];
    for (const res of await Promise.all(writes)) expect(res.status).toBe(404);
    expect(await testDb.task.findUniqueOrThrow({ where: { id: aTask.id } })).toMatchObject({ status: "TODO", startedAt: null });
  });

  it("shows the leader a deleted card on home; nobody else", async () => {
    const t = await activeWith(3);
    expect((await del(t.leader.token, t.projectId, "CS302")).status).toBe(200);
    const row = await testDb.project.findUniqueOrThrow({ where: { id: t.projectId } });

    const h = await home(t.leader.token);
    expect(h.projects).toEqual([]);
    expect(h.deletedProjects).toEqual([
      {
        id: t.projectId,
        name: "校园二手市场 App",
        shortCode: "CS302",
        color: row.color,
        deletedAt: row.deletedAt!.toISOString(),
        purgeAfter: row.purgeAfter!.toISOString(),
      },
    ]);
    for (const p of t.members) expect((await home(p.token)).deletedProjects).toEqual([]);
  });

  it("refuses joining by code or invite, and hides the invite", async () => {
    const t = await activeWith(2);
    const outsider = await person(5);
    const invited = await call(`/api/projects/${t.projectId}/invites`, { method: "POST", token: t.leader.token, body: { targets: "ahmad-dev" } });
    expect(invited.status).toBe(200);
    expect((await home(outsider.token)).invites).toHaveLength(1);
    const inviteId = (await home(outsider.token)).invites[0]!.id;

    await del(t.leader.token, t.projectId, "CS302");
    expect((await joinCode(outsider.token, t.view.inviteCode!)).error?.code).toBe("INVITE_CODE_INVALID");
    expect((await call(`/api/join/${t.view.inviteCode}`, { token: outsider.token })).error?.code).toBe("INVITE_CODE_INVALID");
    expect((await home(outsider.token)).invites).toEqual([]);
    expect((await call(`/api/invites/${inviteId}/accept`, { method: "POST", token: outsider.token })).status).toBe(404);
    expect(await testDb.member.count({ where: { projectId: t.projectId, userId: outsider.user.id } })).toBe(0);
  });

  it("voids pending swaps without SWAP_VOID and tells everyone but the leader", async () => {
    const t = await withPackages(3);
    const [a, b] = t.members;
    const aId = memberIdOf(t.view, a!.user.id);
    const bId = memberIdOf(t.view, b!.user.id);
    const [, p2, p3] = [...t.view.packages].sort((x, y) => x.index - y.index);
    const createdAt = new Date(Date.now() - HOUR);
    const swap = await testDb.swapRequest.create({
      data: {
        projectId: t.projectId,
        requesterId: aId,
        targetId: bId,
        requesterPackageId: p2!.id,
        targetPackageId: p3!.id,
        createdAt,
        expiresAt: new Date(createdAt.getTime() + 72 * HOUR),
      },
    });
    const leaderId = memberIdOf(t.view, t.leader.user.id);

    await del(t.leader.token, t.projectId, "CS302");
    expect(await testDb.swapRequest.findUniqueOrThrow({ where: { id: swap.id } })).toMatchObject({
      status: "VOID",
      voidReason: "PROJECT_DELETED",
      voidedById: leaderId,
    });
    expect(await testDb.notification.count({ where: { type: "SWAP_VOID" } })).toBe(0);

    const row = await testDb.project.findUniqueOrThrow({ where: { id: t.projectId } });
    for (const p of [a!, b!]) {
      const sent = await notes(p.user.id, "PROJECT_DELETED");
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ projectId: t.projectId, audience: "GROUP", mine: true });
      expect(sent[0]!.payload).toEqual({
        type: "PROJECT_DELETED",
        leader: { memberId: leaderId, name: "陈思远" },
        purgeAfter: row.purgeAfter!.toISOString(),
      });
      // Their notifications stay, but none of them opens the project any more.
      const page = (await call<NotificationPage>("/api/notifications", { token: p.token })).data;
      expect(page.items.length).toBeGreaterThan(0);
      expect(page.items.every((n) => !n.projectOpen)).toBe(true);
      expect(page.items[0]).toMatchObject({ type: "PROJECT_DELETED", projectTag: "CS302" });
    }
    expect(await notes(t.leader.user.id, "PROJECT_DELETED")).toHaveLength(0);
    const events = await testDb.activityEvent.findMany({ where: { projectId: t.projectId, type: "PROJECT_DELETED" } });
    expect(events.map((e) => [e.actorId, e.payload])).toEqual([[leaderId, { type: "PROJECT_DELETED" }]]);
  });

  it("people who already left hear nothing", async () => {
    const t = await activeWith(3);
    await call(`/api/projects/${t.projectId}/leave`, { method: "POST", token: t.members[1]!.token });
    await del(t.leader.token, t.projectId, "CS302");
    expect(await notes(t.members[0]!.user.id, "PROJECT_DELETED")).toHaveLength(1);
    expect(await notes(t.members[1]!.user.id, "PROJECT_DELETED")).toHaveLength(0);
  });
});

describe("POST /api/projects/:id/restore", () => {
  it("brings the project back for everyone and tells them", async () => {
    const t = await activeWith(3);
    await del(t.leader.token, t.projectId, "CS302");

    expect((await restore(t.leader.token, t.projectId)).status).toBe(200);
    const row = await testDb.project.findUniqueOrThrow({ where: { id: t.projectId } });
    expect(row).toMatchObject({ deletedAt: null, purgeAfter: null, deletedById: null });

    const leaderId = memberIdOf(t.view, t.leader.user.id);
    for (const p of [t.leader, ...t.members]) {
      expect((await viewAs(p.token, t.projectId)).basics.id).toBe(t.projectId);
      expect((await home(p.token)).projects.map((c) => c.id)).toEqual([t.projectId]);
    }
    expect((await home(t.leader.token)).deletedProjects).toEqual([]);
    for (const p of t.members) {
      const sent = await notes(p.user.id, "PROJECT_RESTORED");
      expect(sent.map((n) => [n.audience, n.payload])).toEqual([
        ["GROUP", { type: "PROJECT_RESTORED", leader: { memberId: leaderId, name: "陈思远" } }],
      ]);
      const page = (await call<NotificationPage>("/api/notifications", { token: p.token })).data;
      expect(page.items.every((n) => n.projectOpen)).toBe(true);
    }
    expect(await notes(t.leader.user.id, "PROJECT_RESTORED")).toHaveLength(0);
    const feed = await testDb.activityEvent.findMany({
      where: { projectId: t.projectId, type: { in: ["PROJECT_DELETED", "PROJECT_RESTORED"] } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    expect(feed.map((e) => e.type)).toEqual(["PROJECT_DELETED", "PROJECT_RESTORED"]);
    // The code works again, and it can be picked from.
    expect((await joinCode((await person(5)).token, t.view.inviteCode!)).status).toBe(200);
    expect((await pickAs(t.members[0]!.token, t.projectId, 1)).status).toBe(200);
  });

  it("is only for the leader who deleted it", async () => {
    const t = await activeWith(3);
    const stranger = await person(5);
    // Not deleted: the leader hears it isn't, anyone else that there's nothing to restore.
    expect((await restore(t.leader.token, t.projectId)).error?.code).toBe("CONFLICT");
    expect((await restore(t.members[0]!.token, t.projectId)).status).toBe(404);

    await del(t.leader.token, t.projectId, "CS302");
    expect((await restore(t.members[0]!.token, t.projectId)).status).toBe(404);
    expect((await restore(stranger.token, t.projectId)).status).toBe(404);
    expect((await restore("", t.projectId)).status).toBe(401);
    expect((await restore(t.leader.token, "nope")).status).toBe(404);
    expect((await testDb.project.findUniqueOrThrow({ where: { id: t.projectId } })).deletedAt).not.toBeNull();
    expect(await testDb.notification.count({ where: { type: "PROJECT_RESTORED" } })).toBe(0);
  });

  it("works until purgeAfter, not after", async () => {
    const t = await activeWith(2);
    await del(t.leader.token, t.projectId, "CS302");
    const { purgeAfter } = await testDb.project.findUniqueOrThrow({ where: { id: t.projectId } });

    await expect(restoreProject(testDb, t.projectId, t.leader.user.id, purgeAfter!)).rejects.toMatchObject({ status: 404 });
    await restoreProject(testDb, t.projectId, t.leader.user.id, new Date(purgeAfter!.getTime() - 1));
    expect((await testDb.project.findUniqueOrThrow({ where: { id: t.projectId } })).deletedAt).toBeNull();
  });
});

describe("purgeDeletedProjects", () => {
  it("deletes the rows and the files once purgeAfter has passed", async () => {
    const t = await withPackages(2);
    const task = taskOf(t.view, 0, 1);
    expect((await uploadEvidence(t.leader.token, t.projectId, task.id, fakeFile("报告.pdf", "pdf", 2048))).status).toBe(201);
    expect(await filesOf(t.projectId)).toHaveLength(1);
    const keep = await withPackages(2, { shortCode: "KEEP" });
    expect((await uploadEvidence(keep.leader.token, keep.projectId, taskOf(keep.view, 0, 1).id, fakeFile("a.pdf", "pdf"))).status).toBe(201);

    await del(t.leader.token, t.projectId, "CS302");
    const { purgeAfter } = await testDb.project.findUniqueOrThrow({ where: { id: t.projectId } });

    // Not yet: nothing happens.
    expect(await purgeDeletedProjects(testDb, new Date(purgeAfter!.getTime() - 1))).toEqual([]);
    expect(await testDb.project.count({ where: { id: t.projectId } })).toBe(1);

    expect(await purgeDeletedProjects(testDb, purgeAfter!)).toEqual([t.projectId]);
    expect(await testDb.project.count({ where: { id: t.projectId } })).toBe(0);
    for (const count of [
      testDb.member.count({ where: { projectId: t.projectId } }),
      testDb.task.count({ where: { projectId: t.projectId } }),
      testDb.evidence.count({ where: { taskId: task.id } }),
      testDb.attempt.count({ where: { taskId: task.id } }),
      testDb.notification.count({ where: { projectId: t.projectId } }),
      testDb.activityEvent.count({ where: { projectId: t.projectId } }),
    ]) {
      expect(await count).toBe(0);
    }
    expect(await filesOf(t.projectId)).toEqual([]);
    // Other projects keep everything; the people keep their accounts.
    expect(await filesOf(keep.projectId)).toHaveLength(1);
    expect(await testDb.project.count({ where: { id: keep.projectId } })).toBe(1);
    expect(await testDb.user.count({ where: { id: t.leader.user.id } })).toBe(1);
    // Running it again finds nothing.
    expect(await purgeDeletedProjects(testDb, purgeAfter!)).toEqual([]);
  });

  it("runs lazily on GET /api/home for the caller's projects", async () => {
    const t = await activeWith(2);
    // Led by someone else, with nobody from t in it.
    const otherLeader = await person(5);
    const other = (await createActive(otherLeader.token, { shortCode: "OTHER" })).basics.id;
    await del(t.leader.token, t.projectId, "CS302");
    await del(otherLeader.token, other, "OTHER");
    const past = new Date(Date.now() - 1000);
    await testDb.project.updateMany({ where: { id: { in: [t.projectId, other] } }, data: { purgeAfter: past } });

    // A stranger's home purges nothing of theirs.
    await home((await person(4)).token);
    expect(await testDb.project.count({ where: { id: { in: [t.projectId, other] } } })).toBe(2);

    // A member's home purges it (not only the leader's).
    const h = await home(t.members[0]!.token);
    expect(h.projects).toEqual([]);
    expect(await testDb.project.count({ where: { id: t.projectId } })).toBe(0);
    expect(await testDb.project.count({ where: { id: other } })).toBe(1);
  });

  it("leaves a project restored in time alone", async () => {
    const t = await activeWith(2);
    await del(t.leader.token, t.projectId, "CS302");
    await restore(t.leader.token, t.projectId);
    expect(await purgeDeletedProjects(testDb, new Date(Date.now() + 30 * DAY))).toEqual([]);
    expect(await testDb.project.count({ where: { id: t.projectId } })).toBe(1);
  });
});
