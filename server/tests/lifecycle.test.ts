// The project lifecycle (M5 spec §3, §4): deadline → AWAITING_CONFIRM, the auto-end, 结束项目, the freeze,
// 重新打开, the deletion warnings, the purge, and 一键延后.
import { readdir } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { HomeData, NotificationPayload, ProjectView, TaskDetail } from "../../shared/types";
import { reopenProject } from "../src/services/lifecycle";
import { deleteProject } from "../src/services/project-delete";
import { updateProject } from "../src/services/projects";
import { autoEndProjects, markProjectsDue, purgeProjects, warnAutoEnd, warnDeletion } from "../src/services/tick";
import { call, testApp, testDb } from "./helpers";
import {
  DAY,
  fakeFile,
  finishTask,
  freshDb,
  joinCode,
  linkEvidence,
  person,
  submitAs,
  taskOf,
  uploadDir,
  uploadEvidence,
  viewAs,
  withPackages,
} from "./project-fixtures";

beforeEach(freshDb);
afterAll(() => testDb.$disconnect());

const MIN = 60 * 1000;
type Kind = NotificationPayload["type"];

const notes = (type: Kind) => testDb.notification.findMany({ where: { type }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
const payloadOf = <T extends Kind>(n: { payload: unknown }) => n.payload as Extract<NotificationPayload, { type: T }>;
const row = (id: string) => testDb.project.findUniqueOrThrow({ where: { id } });
const memberId = (view: ProjectView, userId: string) => view.members.find((m) => m.userId === userId)!.id;
const end = (token: string, projectId: string) => call<ProjectView>(`/api/projects/${projectId}/end`, { method: "POST", token });

async function filesOf(projectId: string): Promise<string[]> {
  try {
    const entries = await readdir(path.join(uploadDir(), projectId), { recursive: true, withFileTypes: true });
    return entries.filter((e) => e.isFile()).map((e) => e.name);
  } catch {
    return [];
  }
}

describe("the deadline passes", () => {
  it("moves the project to AWAITING_CONFIRM and tells the leader once; +6 days warns, +7 days ends it", async () => {
    const t = await withPackages(3);
    const { deadline } = await row(t.projectId);
    expect(await markProjectsDue(testDb, new Date(deadline.getTime() - MIN))).toBe(0);

    expect(await markProjectsDue(testDb, new Date(deadline.getTime() + MIN))).toBe(1);
    expect(await row(t.projectId)).toMatchObject({ status: "AWAITING_CONFIRM", awaitingSince: deadline });
    const [due] = await notes("PROJECT_DUE");
    expect(due).toMatchObject({ userId: t.leader.user.id, audience: "ONLY_LEADER" });
    expect(payloadOf<"PROJECT_DUE">(due!)).toEqual({
      type: "PROJECT_DUE",
      deadline: deadline.toISOString(),
      autoEndAt: new Date(deadline.getTime() + 7 * DAY).toISOString(),
    });
    expect(await markProjectsDue(testDb, new Date(deadline.getTime() + 2 * MIN))).toBe(0);
    expect(await notes("PROJECT_DUE")).toHaveLength(1);

    // The views say so.
    const view = await viewAs(t.members[0]!.token, t.projectId);
    expect(view.lifecycle).toEqual({
      status: "AWAITING_CONFIRM",
      awaitingSince: deadline.toISOString(),
      autoEndAt: new Date(deadline.getTime() + 7 * DAY).toISOString(),
      endedAt: null,
      endedAuto: false,
      endedBy: null,
      purgeAfter: null,
    });
    const card = (await call<HomeData>("/api/home", { token: t.leader.token })).data.projects.find((p) => p.id === t.projectId)!;
    expect(card.lifecycle.status).toBe("AWAITING_CONFIRM");

    // Day 5: nothing. Day 6: the leader hears it ends tomorrow, once.
    expect(await warnAutoEnd(testDb, new Date(deadline.getTime() + 5 * DAY))).toBe(0);
    expect(await warnAutoEnd(testDb, new Date(deadline.getTime() + 6 * DAY + MIN))).toBe(1);
    expect(await warnAutoEnd(testDb, new Date(deadline.getTime() + 6 * DAY + 20 * MIN))).toBe(0);
    const [soon] = await notes("PROJECT_AUTO_END_SOON");
    expect(soon).toMatchObject({ userId: t.leader.user.id, audience: "ONLY_LEADER" });

    // Day 7: ended automatically; everyone (the leader too) hears it.
    expect(await autoEndProjects(testDb, new Date(deadline.getTime() + 7 * DAY - MIN))).toBe(0);
    const at = new Date(deadline.getTime() + 7 * DAY + MIN);
    expect(await autoEndProjects(testDb, at)).toBe(1);
    expect(await row(t.projectId)).toMatchObject({
      status: "ENDED",
      endedAt: at,
      endedAuto: true,
      endedById: null,
      awaitingSince: null,
      purgeAfter: new Date(at.getTime() + 14 * DAY),
    });
    const ended = await notes("PROJECT_ENDED");
    expect(ended.map((n) => n.userId).sort()).toEqual([t.leader.user.id, ...t.members.map((m) => m.user.id)].sort());
    expect(payloadOf<"PROJECT_ENDED">(ended[0]!)).toEqual({
      type: "PROJECT_ENDED",
      auto: true,
      leader: null,
      purgeAfter: new Date(at.getTime() + 14 * DAY).toISOString(),
    });
    const feed = await testDb.activityEvent.findFirstOrThrow({ where: { projectId: t.projectId, type: "PROJECT_ENDED" } });
    expect(feed).toMatchObject({ actorId: null, payload: { type: "PROJECT_ENDED", auto: true } });
    expect(await autoEndProjects(testDb, new Date(at.getTime() + MIN))).toBe(0);
  });

  it("keeps everything working while AWAITING_CONFIRM, except joining", async () => {
    const t = await withPackages(3);
    const { deadline } = await row(t.projectId);
    await markProjectsDue(testDb, new Date(deadline.getTime() + MIN));
    const [a] = t.members;
    expect((await call(`/api/projects/${t.projectId}/tasks/${taskOf(t.view, 0, 2).id}/start`, { method: "POST", token: a!.token })).status).toBe(200);
    expect((await linkEvidence(a!.token, t.projectId, taskOf(t.view, 1, 2).id, "https://example.com/x")).status).toBe(201);
    expect((await call(`/api/projects/${t.projectId}`, { method: "PATCH", token: t.leader.token, body: { name: "改个名字" } })).status).toBe(200);
    const view = await viewAs(t.leader.token, t.projectId);
    expect((await joinCode((await person(5)).token, view.inviteCode!)).error?.code).toBe("PROJECT_ENDED");
  });

  it("goes back to ACTIVE when the leader pushes the deadline later, and reminds again at the new one", async () => {
    const t = await withPackages(2);
    const { deadline } = await row(t.projectId);
    await markProjectsDue(testDb, new Date(deadline.getTime() + MIN));
    const now = new Date(deadline.getTime() + DAY);
    const later = new Date(deadline.getTime() + 5 * DAY);
    await updateProject(testDb, t.projectId, t.leader.user.id, { deadline: later.toISOString() }, now);
    expect(await row(t.projectId)).toMatchObject({ status: "ACTIVE", awaitingSince: null, deadline: later });

    expect(await markProjectsDue(testDb, new Date(later.getTime() + MIN))).toBe(1);
    expect(await notes("PROJECT_DUE")).toHaveLength(2);
  });

  it("moves the ETag of the home screen and the project", async () => {
    const t = await withPackages(2);
    const get = (p: string, etag?: string) =>
      testApp.request(p, { headers: { Authorization: `Bearer ${t.leader.token}`, ...(etag ? { "If-None-Match": etag } : {}) } });
    const home = await get("/api/home");
    const project = await get(`/api/projects/${t.projectId}`);
    const notif = await get("/api/notifications");
    expect((await get("/api/home", home.headers.get("ETag")!)).status).toBe(304);

    const { deadline } = await row(t.projectId);
    await markProjectsDue(testDb, new Date(deadline.getTime() + MIN));
    for (const [p, res] of [["/api/home", home], [`/api/projects/${t.projectId}`, project], ["/api/notifications", notif]] as const) {
      expect((await get(p, res.headers.get("ETag")!)).status).toBe(200);
    }
  });
});

describe("POST /api/projects/:id/end", () => {
  it("ends it for everyone: ENDED, 14 days to purge, swaps void, the others told", async () => {
    const t = await withPackages(3);
    const [a, b] = t.members;
    const pkg3 = t.view.packages.find((p) => p.index === 3)!;
    expect((await call(`/api/projects/${t.projectId}/swaps`, { method: "POST", token: a!.token, body: { packageId: pkg3.id } })).status).toBe(200);

    expect((await end(a!.token, t.projectId)).error?.code).toBe("FORBIDDEN");
    const res = await end(t.leader.token, t.projectId);
    expect(res.status).toBe(200);
    const r = await row(t.projectId);
    expect(r).toMatchObject({ status: "ENDED", endedAuto: false, endedById: memberId(t.view, t.leader.user.id) });
    expect(r.purgeAfter!.getTime() - r.endedAt!.getTime()).toBe(14 * DAY);
    expect(res.data.lifecycle).toEqual({
      status: "ENDED",
      awaitingSince: null,
      autoEndAt: null,
      endedAt: r.endedAt!.toISOString(),
      endedAuto: false,
      endedBy: { memberId: memberId(t.view, t.leader.user.id), name: "陈思远" },
      purgeAfter: r.purgeAfter!.toISOString(),
    });

    expect(await testDb.swapRequest.findFirstOrThrow({ where: { projectId: t.projectId } })).toMatchObject({ status: "VOID", voidReason: "PROJECT_ENDED" });
    expect(await notes("SWAP_VOID")).toEqual([]);
    const ended = await notes("PROJECT_ENDED");
    expect(ended.map((n) => n.userId).sort()).toEqual([a!.user.id, b!.user.id].sort());
    expect(payloadOf<"PROJECT_ENDED">(ended[0]!)).toMatchObject({ auto: false, leader: { name: "陈思远" } });
    expect(await testDb.activityEvent.count({ where: { projectId: t.projectId, type: "PROJECT_ENDED", actorId: memberId(t.view, t.leader.user.id) } })).toBe(1);

    const card = (await call<HomeData>("/api/home", { token: a!.token })).data.projects.find((p) => p.id === t.projectId)!;
    expect(card.lifecycle).toMatchObject({ status: "ENDED", purgeAfter: r.purgeAfter!.toISOString() });
    expect((await end(t.leader.token, t.projectId)).error?.code).toBe("PROJECT_ENDED");
  });

  it("freezes every write except grading what was handed in, leaving and deleting", async () => {
    const t = await withPackages(3);
    const [a, b] = t.members;
    const pid = t.projectId;
    const aPending = taskOf(t.view, 0, 2);
    const aOther = taskOf(t.view, 1, 2);
    const bTask = taskOf(t.view, 0, 3);
    expect((await linkEvidence(a!.token, pid, aPending.id, "https://example.com/done")).status).toBe(201);
    expect((await submitAs(a!.token, pid, aPending.id)).status).toBe(200);
    expect((await linkEvidence(a!.token, pid, aOther.id, "https://example.com/draft")).status).toBe(201);
    const draftEvidence = await testDb.evidence.findFirstOrThrow({ where: { taskId: aOther.id } });
    const code = (await viewAs(t.leader.token, pid)).inviteCode!;
    expect((await end(t.leader.token, pid)).status).toBe(200);

    const tp = (taskId: string, rest = "") => `/api/projects/${pid}/tasks/${taskId}${rest}`;
    const L = t.leader.token;
    const A = a!.token;
    const pkg = (i: number) => t.view.packages.find((p) => p.index === i)!.id;
    const writes: [string, string, string, unknown?][] = [
      [A, "POST", tp(aOther.id, "/start")],
      [A, "POST", tp(aOther.id, "/evidence/link"), { url: "https://example.com/more" }],
      [A, "DELETE", tp(aOther.id, `/evidence/${draftEvidence.id}`)],
      [A, "POST", tp(aOther.id, "/submit")],
      [A, "POST", tp(aPending.id, "/withdraw")],
      [A, "POST", tp(aOther.id, "/undo-start")],
      [L, "POST", tp(bTask.id, "/grade-outside"), { grade: "PASS" }],
      [L, "POST", tp(bTask.id, "/override"), { grade: "PASS", reason: "x" }],
      [L, "POST", tp(bTask.id, "/undo-override")],
      [A, "POST", tp(aOther.id, "/meeting-done"), { summary: "x", attendeeMemberIds: [] }],
      [L, "POST", tp(bTask.id, "/move"), { packageId: pkg(2) }],
      [L, "POST", tp(bTask.id, "/delay"), { dueAt: new Date(Date.now() + DAY).toISOString() }],
      [L, "PATCH", tp(bTask.id), { title: "新标题" }],
      [A, "PUT", tp(aOther.id, "/checklist"), { items: [{ text: "一条" }] }],
      [A, "PUT", tp(aOther.id, "/prereq"), { prereqTaskId: bTask.id }],
      [L, "POST", `/api/projects/${pid}/tasks`, { title: "加一个", kind: "DOC", points: 50 }],
      [L, "PATCH", `/api/projects/${pid}`, { name: "新名字" }],
      [L, "POST", `/api/projects/${pid}/invite-code/reset`],
      [A, "POST", `/api/projects/${pid}/invites`, { targets: "someone@example.com" }],
      [A, "POST", `/api/projects/${pid}/swaps`, { packageId: pkg(3) }],
      [L, "POST", `/api/projects/${pid}/packages/${pkg(3)}/assign`, { memberId: memberId(t.view, a!.user.id) }],
      [A, "POST", `/api/projects/${pid}/packages/${pkg(3)}/pick`],
      [L, "POST", `/api/projects/${pid}/resplit/preview`, { count: 3 }],
      [L, "POST", `/api/projects/${pid}/resplit`, { count: 3, version: 0 }],
      [L, "POST", `/api/projects/${pid}/members/${memberId(t.view, b!.user.id)}/remove`],
      [L, "POST", `/api/projects/${pid}/members/${memberId(t.view, b!.user.id)}/transfer`],
      [A, "POST", `/api/dev/tasks/${aOther.id}/status`, { status: "DONE" }],
    ];
    for (const [token, method, p, body] of writes) {
      const res = await call(p, { method, token, body });
      expect([p, method, res.status, res.error?.code]).toEqual([p, method, 409, "PROJECT_ENDED"]);
    }
    const outsider = await person(5);
    expect((await joinCode(outsider.token, code)).error?.code).toBe("PROJECT_ENDED");

    // Reading works.
    expect((await call(`/api/projects/${pid}`, { token: A })).status).toBe(200);
    expect((await call<TaskDetail>(tp(aPending.id), { token: A })).data.project.lifecycle.status).toBe("ENDED");
    expect((await call(`/api/projects/${pid}/feed`, { token: A })).status).toBe(200);
    // What was handed in can still be graded.
    const graded = await call<TaskDetail>(tp(aPending.id, "/grade"), { method: "POST", token: L, body: { grade: "EXCELLENT" } });
    expect(graded.status).toBe(200);
    expect(graded.data.task.status).toBe("DONE");
    expect((await call(tp(bTask.id, "/grade"), { method: "POST", token: L, body: { grade: "PASS" } })).error?.code).toBe("NOT_REVIEWING");
    // Leaving works.
    expect((await call(`/api/projects/${pid}/leave`, { method: "POST", token: b!.token })).status).toBe(200);
    expect(await notes("MEMBER_NEEDS_PACKAGE")).toEqual([]);
    // So does deleting it for everyone.
    expect((await call(`/api/projects/${pid}/delete`, { method: "POST", token: L, body: { confirm: "CS302" } })).status).toBe(200);
  });
});

describe("POST /api/projects/:id/reopen", () => {
  it("reopens an ended project whose deadline is still ahead, without a new one", async () => {
    const t = await withPackages(3);
    await end(t.leader.token, t.projectId);
    expect((await call(`/api/projects/${t.projectId}/reopen`, { method: "POST", token: t.members[0]!.token })).error?.code).toBe("FORBIDDEN");
    const res = await call<ProjectView>(`/api/projects/${t.projectId}/reopen`, { method: "POST", token: t.leader.token });
    expect(res.status).toBe(200);
    const r = await row(t.projectId);
    expect(r).toMatchObject({ status: "ACTIVE", endedAt: null, endedById: null, endedAuto: false, purgeAfter: null });
    expect(res.data.lifecycle.status).toBe("ACTIVE");
    const reopened = await notes("PROJECT_REOPENED");
    expect(reopened.map((n) => n.userId).sort()).toEqual(t.members.map((m) => m.user.id).sort());
    expect(payloadOf<"PROJECT_REOPENED">(reopened[0]!)).toEqual({
      type: "PROJECT_REOPENED",
      leader: { memberId: memberId(t.view, t.leader.user.id), name: "陈思远" },
      deadline: r.deadline.toISOString(),
    });
    expect(await testDb.activityEvent.count({ where: { projectId: t.projectId, type: "PROJECT_REOPENED" } })).toBe(1);
    // Not ended any more.
    expect((await call(`/api/projects/${t.projectId}/reopen`, { method: "POST", token: t.leader.token })).error?.code).toBe("CONFLICT");
  });

  it("needs a new deadline after now when the old one has passed; the reminders run again after it", async () => {
    const t = await withPackages(2);
    const { deadline } = await row(t.projectId);
    await markProjectsDue(testDb, new Date(deadline.getTime() + MIN));
    await autoEndProjects(testDb, new Date(deadline.getTime() + 7 * DAY + MIN));
    const now = new Date(deadline.getTime() + 8 * DAY);
    const reopen = (input: { deadline?: string }, at = now) => reopenProject(testDb, t.projectId, t.leader.user.id, input, at);

    await expect(reopen({})).rejects.toMatchObject({ status: 400, code: "DEADLINE_REQUIRED" });
    await expect(reopen({ deadline: new Date(now.getTime() - MIN).toISOString() })).rejects.toMatchObject({ code: "DEADLINE_IN_PAST" });
    const { purgeAfter } = await row(t.projectId);
    await expect(reopen({ deadline: new Date(now.getTime() + 30 * DAY).toISOString() }, purgeAfter!)).rejects.toMatchObject({ code: "CONFLICT" });

    const next = new Date(now.getTime() + 10 * DAY);
    await reopen({ deadline: next.toISOString() });
    expect(await row(t.projectId)).toMatchObject({ status: "ACTIVE", deadline: next, endedAuto: false, purgeAfter: null });
    expect(payloadOf<"PROJECT_REOPENED">((await notes("PROJECT_REOPENED"))[0]!).deadline).toBe(next.toISOString());

    // The deadline passes again: PROJECT_DUE again, and 7 days later it ends again.
    expect(await markProjectsDue(testDb, new Date(next.getTime() + MIN))).toBe(1);
    expect(await notes("PROJECT_DUE")).toHaveLength(2);
    expect(await autoEndProjects(testDb, new Date(next.getTime() + 7 * DAY + MIN))).toBe(1);
  });

  it("takes a date-only deadline (23:59 in the project zone)", async () => {
    const t = await withPackages(2);
    const { deadline } = await row(t.projectId);
    await markProjectsDue(testDb, new Date(deadline.getTime() + MIN));
    await autoEndProjects(testDb, new Date(deadline.getTime() + 7 * DAY + MIN));
    const now = new Date(deadline.getTime() + 8 * DAY);
    const ymd = new Date(now.getTime() + 5 * DAY).toISOString().slice(0, 10);
    await reopenProject(testDb, t.projectId, t.leader.user.id, { deadline: ymd }, now);
    const r = await row(t.projectId);
    expect(r.deadline.toISOString().slice(0, 10)).toBe(ymd);
    expect(r.deadline.getUTCHours()).toBe(15); // 23:59 in Kuala Lumpur (UTC+8)
  });
});

describe("deletion warnings and the purge", () => {
  it("warns everyone 3 days and 1 day before, then deletes the project with its files", async () => {
    const t = await withPackages(3);
    const task = taskOf(t.view, 0, 1);
    expect((await uploadEvidence(t.leader.token, t.projectId, task.id, fakeFile("报告.pdf", "pdf", 2048))).status).toBe(201);
    expect(await filesOf(t.projectId)).toHaveLength(1);
    await end(t.leader.token, t.projectId);
    const { purgeAfter } = await row(t.projectId);
    const at = (ms: number) => new Date(purgeAfter!.getTime() + ms);

    expect(await warnDeletion(testDb, at(-4 * DAY))).toBe(0);
    expect(await warnDeletion(testDb, at(-3 * DAY + MIN))).toBe(3);
    expect(await warnDeletion(testDb, at(-3 * DAY + 20 * MIN))).toBe(0);
    expect(await warnDeletion(testDb, at(-DAY + MIN))).toBe(3);
    expect(await warnDeletion(testDb, at(-DAY + 20 * MIN))).toBe(0);
    const rows = await notes("PROJECT_DELETE_SOON");
    expect(rows.map((n) => payloadOf<"PROJECT_DELETE_SOON">(n).days)).toEqual([3, 3, 3, 1, 1, 1]);
    expect(rows[0]).toMatchObject({ audience: "GROUP" });
    expect(payloadOf<"PROJECT_DELETE_SOON">(rows[0]!).purgeAfter).toBe(purgeAfter!.toISOString());

    // GET /api/home's lazy purge only takes projects deleted for everyone, as before.
    await testDb.project.update({ where: { id: t.projectId }, data: { purgeAfter: new Date(Date.now() - MIN) } });
    await call("/api/home", { token: t.leader.token });
    expect(await testDb.project.count({ where: { id: t.projectId } })).toBe(1);
    await testDb.project.update({ where: { id: t.projectId }, data: { purgeAfter } });

    expect(await purgeProjects(testDb, at(-1))).toBe(0);
    expect(await purgeProjects(testDb, at(0))).toBe(1);
    expect(await testDb.project.count({ where: { id: t.projectId } })).toBe(0);
    expect(await testDb.reminderLog.count({ where: { projectId: t.projectId } })).toBe(0);
    expect(await filesOf(t.projectId)).toEqual([]);
    expect(await purgeProjects(testDb, at(0))).toBe(0);
  });

  it("purges an ended project that is also deleted for everyone at the earlier date; restoring gives the ended date back", async () => {
    const t = await withPackages(2);
    await end(t.leader.token, t.projectId);
    const ended = await row(t.projectId);
    expect((await call(`/api/projects/${t.projectId}/delete`, { method: "POST", token: t.leader.token, body: { confirm: "CS302" } })).status).toBe(200);
    const deleted = await row(t.projectId);
    expect(deleted.purgeAfter!.getTime()).toBe(deleted.deletedAt!.getTime() + 7 * DAY);
    // Hidden: no deletion warnings for it.
    expect(await warnDeletion(testDb, new Date(deleted.purgeAfter!.getTime() - DAY + MIN))).toBe(0);

    expect((await call(`/api/projects/${t.projectId}/restore`, { method: "POST", token: t.leader.token })).status).toBe(200);
    expect(await row(t.projectId)).toMatchObject({ status: "ENDED", deletedAt: null, purgeAfter: ended.purgeAfter });

    // An ended project deleted 13 days after it ended keeps its own (earlier) date.
    const late = new Date(ended.endedAt!.getTime() + 13 * DAY);
    await deleteProject(testDb, t.projectId, t.leader.user.id, "CS302", late);
    expect((await row(t.projectId)).purgeAfter).toEqual(ended.purgeAfter);
    expect(await purgeProjects(testDb, ended.purgeAfter!)).toBe(1);
  });
});

describe("POST /api/projects/:id/tasks/:taskId/delay (一键延后)", () => {
  it("moves a blocked task later, tells its owner with what it waits for", async () => {
    const t = await withPackages(3);
    const [a] = t.members;
    const waiting = taskOf(t.view, 0, 2);
    const prereq = taskOf(t.view, 0, 3);
    const from = new Date(Date.now() + 2 * DAY);
    await testDb.task.update({ where: { id: waiting.id }, data: { prereqTaskId: prereq.id, dueAt: from } });
    const to = new Date(from.getTime() + 3 * DAY);
    const path_ = `/api/projects/${t.projectId}/tasks/${waiting.id}/delay`;

    expect((await call(path_, { method: "POST", token: a!.token, body: { dueAt: to.toISOString() } })).error?.code).toBe("FORBIDDEN");
    expect((await call(path_, { method: "POST", token: t.leader.token, body: { dueAt: from.toISOString() } })).error?.code).toBe("DELAY_NOT_LATER");
    const { deadline } = await row(t.projectId);
    const tooLate = { dueAt: new Date(deadline.getTime() + DAY).toISOString() };
    expect((await call(path_, { method: "POST", token: t.leader.token, body: tooLate })).error?.code).toBe("DUE_AFTER_DEADLINE");

    const res = await call<TaskDetail>(path_, { method: "POST", token: t.leader.token, body: { dueAt: to.toISOString() } });
    expect(res.status).toBe(200);
    expect(res.data.task.dueAt).toBe(to.toISOString());
    expect(await testDb.task.findUniqueOrThrow({ where: { id: waiting.id } })).toMatchObject({ dueAt: to, leaderDueAt: to });
    const [n] = await notes("TASK_DELAYED");
    expect(n).toMatchObject({ userId: a!.user.id, audience: "ONLY_YOU" });
    expect(payloadOf<"TASK_DELAYED">(n!)).toEqual({
      type: "TASK_DELAYED",
      taskId: waiting.id,
      title: waiting.title,
      dueAt: to.toISOString(),
      fromDueAt: from.toISOString(),
      prereq: { taskId: prereq.id, title: prereq.title },
    });
    expect(await testDb.activityEvent.count({ where: { projectId: t.projectId, type: "TASK_DELAYED" } })).toBe(1);

    // Up to the deadline itself is fine (a date-only deadline day too); the leader's own task: no notice.
    const own = taskOf(t.view, 0, 1);
    await testDb.task.update({ where: { id: own.id }, data: { dueAt: from } });
    const ownRes = await call(`/api/projects/${t.projectId}/tasks/${own.id}/delay`, {
      method: "POST",
      token: t.leader.token,
      body: { dueAt: deadline.toISOString() },
    });
    expect(ownRes.status).toBe(200);
    expect(await notes("TASK_DELAYED")).toHaveLength(1);

    // A finished task isn't delayed.
    await finishTask(prereq.id, "PASS");
    const done = await call(`/api/projects/${t.projectId}/tasks/${prereq.id}/delay`, {
      method: "POST",
      token: t.leader.token,
      body: { dueAt: new Date(Date.now() + 5 * DAY).toISOString() },
    });
    expect(done.error?.code).toBe("TASK_FINISHED");
  });
});
