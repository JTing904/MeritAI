// The task page's data (TaskDetail) and the M4 fields of the project view (M4 spec §7, §13 srv-tasks).
// Attempts, evidence and grade changes are written through Prisma (tests/attempt-rows.ts).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { BriefResult, DraftView, ProjectView, TaskDetail } from "../../shared/types";
import { MAX_EVIDENCE_FILE_BYTES, MAX_EVIDENCE_ITEMS, MAX_PROJECT_STORAGE_BYTES } from "../../shared/constants";
import { loadTaskDetail } from "../src/services/task-views";
import { addAttempt, gradedAttempt, recompute } from "./attempt-rows";
import { call, testDb } from "./helpers";
import {
  createDraft,
  DAY,
  detailAs,
  freshDb,
  person,
  startAs,
  taskOf,
  upload,
  viewAs,
  withPackages,
  type ActiveTeam,
} from "./project-fixtures";

beforeEach(freshDb);
afterAll(() => testDb.$disconnect());

const HOUR = 60 * 60 * 1000;
const FIXTURES = fileURLToPath(new URL("./fixtures/briefs/", import.meta.url));

const memberOf = (t: ActiveTeam, userId: string) => t.view.members.find((m) => m.userId === userId)!;

/** 陈思远 leads 「任务包 1」, 林晓雯 「任务包 2」, 王子杰 「任务包 3」. */
async function team() {
  const t = await withPackages(3);
  const [lin, wang] = t.members as [ActiveTeam["leader"], ActiveTeam["leader"]];
  return { t, lin, wang, leaderId: memberOf(t, t.leader.user.id).id, linId: memberOf(t, lin.user.id).id, wangId: memberOf(t, wang.user.id).id };
}

async function detail(token: string, projectId: string, taskId: string): Promise<TaskDetail> {
  const res = await detailAs(token, projectId, taskId);
  if (res.status !== 200) throw new Error(`detail failed: ${res.status} ${JSON.stringify(res.error)}`);
  return res.data;
}

describe("GET /api/projects/:id/tasks/:taskId", () => {
  it("shows a TODO task the same to its owner, another member and the leader, apart from who is looking", async () => {
    const { t, lin, wang, leaderId, linId, wangId } = await team();
    const task = taskOf(t.view, 0, 3);

    const mine = await detail(wang.token, t.projectId, task.id);
    expect(mine).toMatchObject({
      task: { id: task.id, status: "TODO", grade: null, attemptCount: 0, evidenceCount: 0, hasEvidence: false, late: false },
      project: {
        id: t.projectId,
        tag: "CS302",
        viewerMemberId: wangId,
        viewerRole: "MEMBER",
        leaderMemberId: leaderId,
        leaderName: "陈思远",
      },
      owner: { memberId: wangId, name: "王子杰", active: true },
      packageIndex: 3,
      attempts: [],
      current: null,
      countingAttemptId: null,
      checklist: [],
      prereq: null,
      waitedBy: [],
      briefSiblings: [],
      undoStartUntil: null,
      storage: {
        usedBytes: 0,
        capBytes: MAX_PROJECT_STORAGE_BYTES,
        maxFileBytes: MAX_EVIDENCE_FILE_BYTES,
        maxItems: MAX_EVIDENCE_ITEMS,
      },
      finishedAt: null,
    });
    // Everyone of the project, the leader first (attendees / absentees are picked from these).
    expect(mine.members.map((m) => [m.memberId, m.name, m.active])).toEqual([
      [leaderId, "陈思远", true],
      [linId, "林晓雯", true],
      [wangId, "王子杰", true],
    ]);

    const other = await detail(lin.token, t.projectId, task.id);
    const lead = await detail(t.leader.token, t.projectId, task.id);
    expect(other.project).toMatchObject({ viewerMemberId: linId, viewerRole: "MEMBER" });
    expect(lead.project).toMatchObject({ viewerMemberId: leaderId, viewerRole: "LEADER" });
    const { project: _a, ...restMine } = mine;
    const { project: _b, ...restOther } = other;
    const { project: _c, ...restLead } = lead;
    expect(restOther).toEqual(restMine);
    expect(restLead).toEqual(restMine);
  });

  it("answers 404 for an unknown task, a task of another project and someone outside the project", async () => {
    const { t, wang } = await team();
    const task = taskOf(t.view, 0, 3);
    const other = await withPackagesElsewhere();
    const foreign = taskOf(other.view, 0);

    expect((await detailAs(wang.token, t.projectId, "nope")).status).toBe(404);
    expect((await detailAs(wang.token, t.projectId, foreign.id)).status).toBe(404);
    const outsider = await person(5);
    expect((await detailAs(outsider.token, t.projectId, task.id)).status).toBe(404);
  });

  it("offers the owner 24 hours to undo 「开始做」, and only while nothing was handed in", async () => {
    const { t, lin, wang, wangId } = await team();
    const task = taskOf(t.view, 0, 3);
    expect((await startAs(wang.token, t.projectId, task.id)).status).toBe(200);
    const row = await testDb.task.findUniqueOrThrow({ where: { id: task.id } });
    const until = new Date(row.startedAt!.getTime() + 24 * HOUR).toISOString();

    expect((await detail(wang.token, t.projectId, task.id)).undoStartUntil).toBe(until);
    expect((await detail(wang.token, t.projectId, task.id)).task.status).toBe("DOING");
    // Nobody else may undo it.
    expect((await detail(lin.token, t.projectId, task.id)).undoStartUntil).toBeNull();
    expect((await detail(t.leader.token, t.projectId, task.id)).undoStartUntil).toBeNull();

    const me = await testDb.member.findUniqueOrThrow({ where: { id: wangId } });
    const at = (ms: number) => loadTaskDetail(testDb, t.projectId, task.id, me, new Date(row.startedAt!.getTime() + ms));
    expect((await at(24 * HOUR)).undoStartUntil).toBe(until);
    expect((await at(24 * HOUR + 60_000)).undoStartUntil).toBeNull();

    // Any attempt row (even an empty draft) ends it.
    await addAttempt(task.id, { no: 1, status: "DRAFT" });
    expect((await detail(wang.token, t.projectId, task.id)).undoStartUntil).toBeNull();
  });

  it("offers no undo on a task someone else started", async () => {
    const { t, wang, linId } = await team();
    const task = taskOf(t.view, 0, 3);
    await testDb.task.update({ where: { id: task.id }, data: { status: "DOING", startedAt: new Date(), startedById: linId } });
    expect((await detail(wang.token, t.projectId, task.id)).undoStartUntil).toBeNull();
  });

  it("lists the attempts oldest first, the current one, the counting one and their grade changes", async () => {
    const { t, lin, wang, leaderId, wangId } = await team();
    const task = taskOf(t.view, 0, 3);
    await testDb.task.update({ where: { id: task.id }, data: { dueAt: new Date(Date.now() - DAY), startedAt: new Date(), startedById: wangId } });
    const graded = await gradedAttempt(task.id, 1, "HALF", {
      gradeNote: "少了定价分析",
      gradedById: leaderId,
      submittedById: wangId,
      links: 0,
      files: [1000, 2000],
    });
    // One override that was undone, then one that stands (both on attempt 1; newest first in the view).
    const first = await testDb.gradeChange.create({
      data: { attemptId: graded.attempt.id, fromGrade: "HALF", toGrade: "FAIL", reason: "看错了", byId: leaderId, createdAt: new Date(Date.now() - 2 * HOUR), undoneAt: new Date(Date.now() - HOUR), undoneById: leaderId },
    });
    const second = await testDb.gradeChange.create({
      data: { attemptId: graded.attempt.id, fromGrade: "FAIL", toGrade: "HALF", reason: "改回来", byId: leaderId, createdAt: new Date(Date.now() - 30 * 60_000) },
    });
    const pending = await addAttempt(task.id, { no: 2, status: "PENDING", late: true, submittedById: wangId, links: 2 });
    await recompute(task.id);

    const d = await detail(lin.token, t.projectId, task.id);
    expect(d.task).toMatchObject({
      status: "REVIEWING",
      grade: "HALF",
      earnedPoints: Math.round(task.points / 2),
      late: true,
      attemptCount: 2,
      evidenceCount: 2,
      hasEvidence: true,
      overdue: false,
    });
    expect(d.attempts.map((a) => [a.no, a.status, a.grade, a.counting, a.evidence.length])).toEqual([
      [1, "GRADED", "HALF", true, 2],
      [2, "PENDING", null, false, 2],
    ]);
    expect(d.countingAttemptId).toBe(graded.attempt.id);
    expect(d.current).toEqual(d.attempts[1]);
    expect(d.current!.id).toBe(pending.id);
    expect(d.attempts[0]).toMatchObject({
      gradeNote: "少了定价分析",
      gradedByMemberId: leaderId,
      submittedByMemberId: wangId,
      selfGraded: false,
      outsideApp: false,
      meeting: null,
    });
    expect(d.attempts[0]!.evidence[0]).toMatchObject({ kind: "FILE", sizeBytes: 1000, mimeType: "application/pdf", url: null, addedByMemberId: wangId });
    expect(d.attempts[1]!.evidence[0]).toMatchObject({ kind: "LINK", url: "https://example.com/2/0", sizeBytes: null });
    expect(d.attempts[0]!.changes.map((c) => [c.id, c.fromGrade, c.toGrade, c.reason, c.byMemberId, c.undoneAt !== null])).toEqual([
      [second.id, "FAIL", "HALF", "改回来", leaderId, false],
      [first.id, "HALF", "FAIL", "看错了", leaderId, true],
    ]);
    // The HALF is finished work, earned when the live change produced it.
    expect(d.finishedAt).toBe(second.createdAt.toISOString());
    expect(d.task.finishedAt).toBe(d.finishedAt);
    expect(d.storage.usedBytes).toBe(3000);
  });

  it("does not count an empty draft as an attempt, and the best grade counts (a later FAIL does not)", async () => {
    const { t, wang, leaderId } = await team();
    const task = taskOf(t.view, 1, 3);
    const half = await gradedAttempt(task.id, 1, "HALF", { gradedById: leaderId });
    await gradedAttempt(task.id, 2, "FAIL", { gradedById: leaderId });
    await addAttempt(task.id, { no: 3, status: "DRAFT" });

    const d = await detail(wang.token, t.projectId, task.id);
    expect(d.task).toMatchObject({ status: "HALF", grade: "HALF", attemptCount: 2, evidenceCount: 0, hasEvidence: true });
    expect(d.countingAttemptId).toBe(half.attempt.id);
    expect(d.attempts.map((a) => a.counting)).toEqual([true, false, false]);
    expect(d.current).toMatchObject({ no: 3, status: "DRAFT", evidence: [] });
  });

  it("shows a finished meeting with who came and who didn't", async () => {
    const { t, lin, leaderId, linId, wangId } = await team();
    const task = taskOf(t.view, 0, 3);
    await testDb.task.update({ where: { id: task.id }, data: { kind: "MEETING" } });
    await gradedAttempt(task.id, 1, "SELF", {
      links: 0,
      gradedAt: null,
      meetingSummary: "定了问卷题目",
      attendeeIds: [wangId, linId],
      absentIds: [leaderId],
    });
    const d = await detail(lin.token, t.projectId, task.id);
    expect(d.task).toMatchObject({ status: "DONE", grade: "SELF", earnedPoints: task.points, attemptCount: 1 });
    expect(d.attempts[0]!.meeting).toEqual({ summary: "定了问卷题目", attendeeMemberIds: [wangId, linId], absentMemberIds: [leaderId] });
  });

  it("describes the prerequisite and the tasks waiting for this one", async () => {
    const { t, lin, wang, linId, wangId } = await team();
    const prereq = taskOf(t.view, 0, 2); // 林晓雯's
    const task = taskOf(t.view, 0, 3); // 王子杰's
    const other = taskOf(t.view, 1, 3);
    const due = new Date(Date.now() + 3 * DAY);
    await testDb.task.update({ where: { id: prereq.id }, data: { dueAt: due, status: "REVIEWING", startedAt: new Date(), startedById: linId } });
    await addAttempt(prereq.id, { no: 1, status: "PENDING", late: true, links: 1 });
    await testDb.task.updateMany({ where: { id: { in: [task.id, other.id] } }, data: { prereqTaskId: prereq.id } });

    const d = await detail(wang.token, t.projectId, task.id);
    expect(d.prereq).toEqual({
      taskId: prereq.id,
      title: prereq.title,
      ownerMemberId: linId,
      ownerName: "林晓雯",
      finished: false,
      finishedAt: null,
      dueAt: due.toISOString(),
      status: "REVIEWING",
      late: true,
    });
    expect(d.task.prereqTaskId).toBe(prereq.id);

    const waited = await detail(lin.token, t.projectId, prereq.id);
    expect(waited.waitedBy).toEqual([
      { taskId: task.id, title: task.title, ownerMemberId: wangId, ownerName: "王子杰" },
      { taskId: other.id, title: other.title, ownerMemberId: wangId, ownerName: "王子杰" },
    ]);

    // Finished (graded HALF): finished, with when; the effective due falls back to the deadline.
    await testDb.attempt.deleteMany({ where: { taskId: prereq.id } });
    await testDb.task.update({ where: { id: prereq.id }, data: { dueAt: null } });
    const at = new Date(Date.now() - HOUR);
    await gradedAttempt(prereq.id, 1, "HALF", { gradedAt: at });
    const after = await detail(wang.token, t.projectId, task.id);
    expect(after.prereq).toMatchObject({ finished: true, finishedAt: at.toISOString(), status: "HALF", late: false, dueAt: t.view.basics.deadline });
  });

  it("counts every FILE of the project (all tasks, all attempts) and nothing of other projects", async () => {
    const { t, wang } = await team();
    const a = taskOf(t.view, 0, 3);
    const b = taskOf(t.view, 0, 2);
    await gradedAttempt(a.id, 1, "FAIL", { files: [100, 200] });
    await addAttempt(a.id, { no: 2, status: "DRAFT", files: [300], links: 1 });
    await addAttempt(b.id, { no: 1, status: "DRAFT", files: [400] });
    const elsewhere = await withPackagesElsewhere();
    await addAttempt(taskOf(elsewhere.view, 0).id, { no: 1, status: "DRAFT", files: [5000] });

    expect((await detail(wang.token, t.projectId, a.id)).storage.usedBytes).toBe(1000);
  });
});

/** A second ACTIVE project (led by 张博文) that 王子杰 is not in. */
async function withPackagesElsewhere() {
  const zhang = await person(3);
  const draft = await createDraft(zhang.token, { shortCode: "MKT201", teamSize: 2 });
  await call(`/api/projects/${draft.basics.id}/tasks`, {
    method: "PUT",
    token: zhang.token,
    body: { tasks: [{ title: "别的任务", kind: "DOC", points: 1000 }] },
  });
  const view = (await call<ProjectView>(`/api/projects/${draft.basics.id}/confirm`, { method: "POST", token: zhang.token })).data;
  return { view, token: zhang.token };
}

describe("brief siblings", () => {
  async function fromBrief(fixture: string, teamSize: number, split: boolean) {
    const leader = await person(0);
    const draft = await createDraft(leader.token, { teamSize });
    const file = new File([readFileSync(FIXTURES + fixture)], fixture, { type: "text/plain" });
    const res = await upload(`/api/projects/${draft.basics.id}/brief`, leader.token, file);
    if (!(res.data as BriefResult).ok) throw new Error(`brief failed: ${JSON.stringify(res)}`);
    if (split) await call<DraftView>(`/api/projects/${draft.basics.id}/split-large`, { method: "POST", token: leader.token });
    const view = (await call<ProjectView>(`/api/projects/${draft.basics.id}/confirm`, { method: "POST", token: leader.token })).data;
    return { leader, view };
  }

  it("names the other parts of a split brief item, in plan order, and nothing for unsplit tasks", async () => {
    const { leader, view } = await fromBrief("zh-mkt201-marketing.txt", 5, true);
    const parts = view.tasks.filter((x) => x.title.startsWith("书面报告"));
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.briefSplit).toBe(true);
    // The quoted lines come with the task page only (lib/db.ts OMIT); every part carries the item's.
    for (const p of parts) {
      expect((await detail(leader.token, view.basics.id, p.id)).task.briefExcerpt).toBe("书面报告（40 分）：不少于 3000 字，须包含本地化与定价分析。");
    }

    const d = await detail(leader.token, view.basics.id, parts[1]!.id);
    expect(d.briefSiblings.map((s) => s.taskId)).toEqual(parts.filter((p) => p.id !== parts[1]!.id).map((p) => p.id));
    expect(d.briefSiblings.map((s) => s.title)).toEqual(parts.filter((p) => p.id !== parts[1]!.id).map((p) => p.title));

    const meeting = view.tasks.find((x) => x.title === "小组会议记录")!;
    expect(meeting.briefSplit).toBe(false);
    expect((await detail(leader.token, view.basics.id, meeting.id)).briefSiblings).toEqual([]);
  });

  it("gives items an inline list put on one line no siblings, though they share the line", async () => {
    const { leader, view } = await fromBrief("zh-typed-inline-numbered.txt", 2, false);
    expect(view.tasks.map((x) => x.title)).toEqual(["做一个订餐小程序", "写使用说明书", "做 PPT 上台展示", "每周开一次组会"]);
    const rows = await testDb.task.findMany({ where: { projectId: view.basics.id }, orderBy: { order: "asc" } });
    expect(rows.map((r) => [r.briefFrom, r.briefTo, r.briefSplit])).toEqual(Array(4).fill([0, 1, false]));
    expect((await detail(leader.token, view.basics.id, view.tasks[0]!.id)).briefSiblings).toEqual([]);
  });
});

describe("GET /api/projects/:id (M4 fields)", () => {
  it("lists the PENDING attempts for the leader only, oldest submitted first, with late and the effective due", async () => {
    const { t, lin, wang, linId, wangId } = await team();
    const a = taskOf(t.view, 0, 3);
    const b = taskOf(t.view, 0, 2);
    const c = taskOf(t.view, 1, 2);
    const due = new Date(Date.now() - DAY);
    await testDb.task.update({ where: { id: a.id }, data: { dueAt: due } });
    const now = Date.now();
    await addAttempt(a.id, { no: 1, status: "PENDING", late: true, submittedAt: new Date(now - HOUR), submittedById: wangId, links: 2 });
    await gradedAttempt(b.id, 1, "FAIL");
    await addAttempt(b.id, { no: 2, status: "PENDING", submittedAt: new Date(now - 3 * HOUR), submittedById: linId, files: [10], links: 2 });
    // Withdrawn: back to a draft, so not waiting for review.
    await addAttempt(c.id, { no: 1, status: "DRAFT", links: 1 });
    for (const id of [a.id, b.id, c.id]) await recompute(id);

    const lead = await viewAs(t.leader.token, t.projectId);
    expect(lead.pendingReviews).toEqual([
      { taskId: b.id, title: b.title, ownerMemberId: linId, attemptNo: 2, submittedAt: new Date(now - 3 * HOUR).toISOString(), evidenceCount: 3, late: false, dueAt: t.view.basics.deadline, aiFailReason: null },
      { taskId: a.id, title: a.title, ownerMemberId: wangId, attemptNo: 1, submittedAt: new Date(now - HOUR).toISOString(), evidenceCount: 2, late: true, dueAt: due.toISOString(), aiFailReason: null },
    ]);
    expect((await viewAs(lin.token, t.projectId)).pendingReviews).toEqual([]);
    expect((await viewAs(wang.token, t.projectId)).pendingReviews).toEqual([]);

    // Waiting for review isn't overdue; the view's task rows carry the attempt figures.
    const row = lead.tasks.find((x) => x.id === a.id)!;
    expect(row).toMatchObject({ status: "REVIEWING", overdue: false, late: true, attemptCount: 1, evidenceCount: 2, hasEvidence: true });
    const pkg3 = lead.packages.find((p) => p.index === 3)!;
    expect(pkg3.taskIds).toContain(a.id);
    expect(pkg3.overdueCount).toBe(0);
  });

  it("keeps a HALF task under re-review finished: its package stays started and nothing becomes unfinished", async () => {
    const { t, wang, wangId } = await team();
    const task = taskOf(t.view, 0, 3);
    await testDb.task.update({ where: { id: task.id }, data: { startedAt: new Date(), startedById: wangId } });
    await gradedAttempt(task.id, 1, "HALF");
    const before = await viewAs(wang.token, t.projectId);
    const wangBefore = before.members.find((m) => m.id === wangId)!;

    await addAttempt(task.id, { no: 2, status: "PENDING", links: 1 });
    await recompute(task.id);
    const after = await viewAs(wang.token, t.projectId);
    const wangAfter = after.members.find((m) => m.id === wangId)!;
    expect(after.tasks.find((x) => x.id === task.id)).toMatchObject({ status: "REVIEWING", grade: "HALF", earnedPoints: Math.round(task.points / 2) });
    expect(after.packages.find((p) => p.index === 3)!.started).toBe(true);
    expect(wangAfter.unfinishedCount).toBe(wangBefore.unfinishedCount);
    expect(wangAfter.earnedPoints).toBe(wangBefore.earnedPoints);
  });

  it("says whether the project keeps the brief's text, and the brief's file name", async () => {
    const { t } = await team();
    expect(t.view).toMatchObject({ briefAvailable: false, briefFileName: null });
    await testDb.project.update({ where: { id: t.projectId }, data: { briefText: "1. 书面报告（40 分）", briefBytes: 28, briefFileName: "MKT201 作业.pdf" } });
    expect(await viewAs(t.leader.token, t.projectId)).toMatchObject({ briefAvailable: true, briefFileName: "MKT201 作业.pdf" });
  });
});
