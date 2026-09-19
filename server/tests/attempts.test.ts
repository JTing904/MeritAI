// The owner's side of an attempt (M4 spec §2, §13): submit, withdraw, undo 开始做, and 我开完了 for meetings.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { NotificationPayload, TaskDetail } from "../../shared/types";
import type { ActivityType } from "../src/generated/prisma/client";
import { call, testDb } from "./helpers";
import {
  DAY,
  fakeFile,
  freshDb,
  gradeAs,
  joinCode,
  linkEvidence,
  meetingDoneAs,
  person,
  startAs,
  submitAs,
  taskOf,
  uploadEvidence,
  viewAs,
  withPackages,
} from "./project-fixtures";

beforeEach(freshDb);
afterAll(() => testDb.$disconnect());

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;

const memberRow = (projectId: string, userId: string) =>
  testDb.member.findFirstOrThrow({ where: { projectId, userId }, include: { user: true } });
const taskRow = (id: string) => testDb.task.findUniqueOrThrow({ where: { id } });
const version = async (projectId: string) => (await testDb.project.findUniqueOrThrow({ where: { id: projectId } })).packagesVersion;
const eventsOf = (projectId: string, type: ActivityType) =>
  testDb.activityEvent.findMany({ where: { projectId, type }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
const notificationsOf = (userId: string, type?: NotificationPayload["type"]) =>
  testDb.notification.findMany({ where: { userId, ...(type ? { type } : {}) }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
const attemptsOf = (taskId: string) => testDb.attempt.findMany({ where: { taskId }, orderBy: { no: "asc" } });

/** Three people, everyone with a package: the leader 「任务包 1」, A 「任务包 2」, B 「任务包 3」. */
async function team() {
  const t = await withPackages(3);
  const [a, b] = t.members;
  const rows = {
    leader: await memberRow(t.projectId, t.leader.user.id),
    a: await memberRow(t.projectId, a!.user.id),
    b: await memberRow(t.projectId, b!.user.id),
  };
  return {
    ...t,
    a: a!,
    b: b!,
    rows,
    aTask: taskOf(t.view, 0, 2),
    aTask2: taskOf(t.view, 1, 2),
    bTask: taskOf(t.view, 0, 3),
    leaderTask: taskOf(t.view, 0, 1),
  };
}

const path = (projectId: string, taskId: string, action: string) => `/api/projects/${projectId}/tasks/${taskId}/${action}`;
const withdrawAs = (token: string, projectId: string, taskId: string) =>
  call<TaskDetail>(path(projectId, taskId, "withdraw"), { method: "POST", token });
const undoStartAs = (token: string, projectId: string, taskId: string) =>
  call<TaskDetail>(path(projectId, taskId, "undo-start"), { method: "POST", token });

describe("POST /api/projects/:id/tasks/:taskId/submit", () => {
  it("needs at least one piece of evidence in the draft", async () => {
    const t = await team();
    const none = await submitAs(t.a.token, t.projectId, t.aTask.id);
    expect([none.status, none.error?.code]).toEqual([409, "NO_EVIDENCE"]);
    // A draft emptied again is still not enough.
    expect((await linkEvidence(t.a.token, t.projectId, t.aTask.id, "https://example.com")).status).toBe(201);
    const [ev] = await testDb.evidence.findMany({ where: { taskId: t.aTask.id } });
    expect((await call(`${path(t.projectId, t.aTask.id, "evidence")}/${ev!.id}`, { method: "DELETE", token: t.a.token })).status).toBe(200);
    const empty = await submitAs(t.a.token, t.projectId, t.aTask.id);
    expect([empty.status, empty.error?.code]).toEqual([409, "NO_EVIDENCE"]);
    expect(await notificationsOf(t.leader.user.id, "SUBMITTED")).toHaveLength(0);
  });

  it("hands the draft in: REVIEWING, SUBMITTED to the leader only, feed and bump", async () => {
    const t = await team();
    expect((await uploadEvidence(t.a.token, t.projectId, t.aTask.id, fakeFile("报告.pdf", "pdf"))).status).toBe(201);
    expect((await uploadEvidence(t.a.token, t.projectId, t.aTask.id, fakeFile("图.png", "png"))).status).toBe(201);
    const other = await submitAs(t.b.token, t.projectId, t.aTask.id);
    expect([other.status, other.error?.code]).toEqual([403, "FORBIDDEN"]);
    expect((await submitAs(t.leader.token, t.projectId, t.aTask.id)).status).toBe(403);
    const before = await version(t.projectId);

    const res = await submitAs(t.a.token, t.projectId, t.aTask.id);
    expect(res.status).toBe(200);
    expect(res.data.task.status).toBe("REVIEWING");
    const task = await taskRow(t.aTask.id);
    expect(task).toMatchObject({ status: "REVIEWING", grade: null, finishedAt: null });
    const [attempt] = await attemptsOf(t.aTask.id);
    expect(attempt).toMatchObject({ no: 1, status: "PENDING", submittedById: t.rows.a.id, late: false, grade: null });
    expect(attempt!.submittedAt).not.toBeNull();

    const sent = await testDb.notification.findMany({ where: { type: "SUBMITTED" } });
    expect(sent.map((n) => n.userId)).toEqual([t.leader.user.id]);
    expect(sent[0]).toMatchObject({ audience: "ONLY_LEADER", projectId: t.projectId });
    expect(sent[0]!.payload).toEqual({
      type: "SUBMITTED",
      taskId: t.aTask.id,
      title: t.aTask.title,
      submitter: { memberId: t.rows.a.id, name: t.rows.a.user.name },
      attemptNo: 1,
      evidenceCount: 2,
      allFiles: true,
      dueAt: (task.dueAt ?? (await testDb.project.findUniqueOrThrow({ where: { id: t.projectId } })).deadline).toISOString(),
      late: false,
    });
    const events = await eventsOf(t.projectId, "SUBMITTED");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actorId: t.rows.a.id, payload: { type: "SUBMITTED", taskId: t.aTask.id, title: t.aTask.title, attemptNo: 1 } });
    expect(await version(t.projectId)).toBe(before + 1);

    const again = await submitAs(t.a.token, t.projectId, t.aTask.id);
    expect([again.status, again.error?.code]).toEqual([409, "ALREADY_REVIEWING"]);
  });

  it("grades the leader's own task PASS at once (组长自评), without SUBMITTED", async () => {
    const t = await team();
    expect((await linkEvidence(t.leader.token, t.projectId, t.leaderTask.id, "https://github.com/cs302/app")).status).toBe(201);
    const res = await submitAs(t.leader.token, t.projectId, t.leaderTask.id);
    expect(res.status).toBe(200);
    const [attempt] = await attemptsOf(t.leaderTask.id);
    expect(attempt).toMatchObject({
      status: "GRADED",
      grade: "PASS",
      selfGraded: true,
      gradedById: t.rows.leader.id,
      submittedById: t.rows.leader.id,
    });
    const task = await taskRow(t.leaderTask.id);
    expect(task).toMatchObject({ status: "DONE", grade: "PASS" });
    expect(task.finishedAt).toEqual(attempt!.gradedAt);
    expect(res.data.task.earnedPoints).toBe(task.points);
    expect(await testDb.notification.count({ where: { type: { in: ["SUBMITTED", "GRADED"] } } })).toBe(0);
    expect(await eventsOf(t.projectId, "SUBMITTED")).toHaveLength(0);
    const [graded] = await eventsOf(t.projectId, "GRADED");
    expect(graded!.payload).toEqual({
      type: "GRADED",
      taskId: t.leaderTask.id,
      title: t.leaderTask.title,
      owner: { memberId: t.rows.leader.id, name: t.rows.leader.user.name },
      grade: "PASS",
      attemptNo: 1,
      selfGraded: true,
      outsideApp: false,
    });
  });

  it("marks a submission after the effective due as late (the task's due, else the project deadline)", async () => {
    const t = await team();
    await testDb.task.update({ where: { id: t.aTask.id }, data: { dueAt: new Date(Date.now() - HOUR) } });
    expect((await linkEvidence(t.a.token, t.projectId, t.aTask.id, "https://example.com")).status).toBe(201);
    expect((await submitAs(t.a.token, t.projectId, t.aTask.id)).status).toBe(200);
    expect((await attemptsOf(t.aTask.id))[0]!.late).toBe(true);
    expect((await notificationsOf(t.leader.user.id, "SUBMITTED"))[0]!.payload).toMatchObject({ late: true });

    // No due of its own: the project deadline decides.
    await testDb.task.update({ where: { id: t.bTask.id }, data: { dueAt: null } });
    await testDb.project.update({ where: { id: t.projectId }, data: { deadline: new Date(Date.now() - MINUTE) } });
    expect((await linkEvidence(t.b.token, t.projectId, t.bTask.id, "https://example.com")).status).toBe(201);
    expect((await submitAs(t.b.token, t.projectId, t.bTask.id)).status).toBe(200);
    expect((await attemptsOf(t.bTask.id))[0]!.late).toBe(true);

    // Before the due: not late.
    await testDb.task.update({ where: { id: t.aTask2.id }, data: { dueAt: new Date(Date.now() + DAY) } });
    expect((await linkEvidence(t.a.token, t.projectId, t.aTask2.id, "https://example.com")).status).toBe(201);
    expect((await submitAs(t.a.token, t.projectId, t.aTask2.id)).status).toBe(200);
    expect((await attemptsOf(t.aTask2.id))[0]!.late).toBe(false);
  });

  it("lets only one of two simultaneous submits through (one attempt row, no index: the lock)", async () => {
    const t = await team();
    expect((await uploadEvidence(t.a.token, t.projectId, t.aTask.id, fakeFile("a.pdf", "pdf"))).status).toBe(201);
    const results = await Promise.all([submitAs(t.a.token, t.projectId, t.aTask.id), submitAs(t.a.token, t.projectId, t.aTask.id)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(["ALREADY_REVIEWING", "NO_EVIDENCE"]).toContain(results.find((r) => r.status === 409)!.error!.code);
    expect(await attemptsOf(t.aTask.id)).toHaveLength(1);
    expect(await notificationsOf(t.leader.user.id, "SUBMITTED")).toHaveLength(1);
  });

  it("names a resubmission's attempt number (第 2 次)", async () => {
    const t = await team();
    expect((await linkEvidence(t.a.token, t.projectId, t.aTask.id, "https://example.com/1")).status).toBe(201);
    expect((await submitAs(t.a.token, t.projectId, t.aTask.id)).status).toBe(200);
    expect((await gradeAs(t.leader.token, t.projectId, t.aTask.id, "FAIL", "不完整")).status).toBe(200);
    expect(await taskRow(t.aTask.id)).toMatchObject({ status: "FAIL" });
    expect((await linkEvidence(t.a.token, t.projectId, t.aTask.id, "https://example.com/2")).status).toBe(201);
    // Adding to a resubmission draft keeps the status until it is handed in.
    expect(await taskRow(t.aTask.id)).toMatchObject({ status: "FAIL", grade: "FAIL" });
    expect((await submitAs(t.a.token, t.projectId, t.aTask.id)).status).toBe(200);
    expect((await attemptsOf(t.aTask.id)).map((a) => [a.no, a.status])).toEqual([
      [1, "GRADED"],
      [2, "PENDING"],
    ]);
    const sent = await notificationsOf(t.leader.user.id, "SUBMITTED");
    expect(sent.map((n) => (n.payload as { attemptNo: number }).attemptNo)).toEqual([1, 2]);
    expect((await eventsOf(t.projectId, "SUBMITTED")).map((e) => (e.payload as { attemptNo: number }).attemptNo)).toEqual([1, 2]);
  });
});

describe("POST /api/projects/:id/tasks/:taskId/withdraw", () => {
  it("takes the submission back to a draft with its files; the status goes back", async () => {
    const t = await team();
    expect((await uploadEvidence(t.a.token, t.projectId, t.aTask.id, fakeFile("a.pdf", "pdf"))).status).toBe(201);
    const none = await withdrawAs(t.a.token, t.projectId, t.aTask.id);
    expect([none.status, none.error?.code]).toEqual([409, "NOT_REVIEWING"]);
    expect((await submitAs(t.a.token, t.projectId, t.aTask.id)).status).toBe(200);
    expect((await withdrawAs(t.b.token, t.projectId, t.aTask.id)).status).toBe(403);
    expect((await withdrawAs(t.leader.token, t.projectId, t.aTask.id)).status).toBe(403);
    const before = await version(t.projectId);

    const res = await withdrawAs(t.a.token, t.projectId, t.aTask.id);
    expect(res.status).toBe(200);
    expect(await taskRow(t.aTask.id)).toMatchObject({ status: "DOING" });
    const [attempt] = await attemptsOf(t.aTask.id);
    expect(attempt).toMatchObject({ status: "DRAFT", submittedAt: null, submittedById: null, late: false });
    expect(await testDb.evidence.count({ where: { attemptId: attempt!.id } })).toBe(1);
    const [event] = await eventsOf(t.projectId, "WITHDRAWN");
    expect(event).toMatchObject({ actorId: t.rows.a.id, payload: { type: "WITHDRAWN", taskId: t.aTask.id, attemptNo: 1 } });
    expect(await version(t.projectId)).toBe(before + 1);
    // The leader's SUBMITTED stays (history); grading now finds nothing waiting.
    expect(await notificationsOf(t.leader.user.id, "SUBMITTED")).toHaveLength(1);
    const grade = await gradeAs(t.leader.token, t.projectId, t.aTask.id, "PASS");
    expect([grade.status, grade.error?.code]).toEqual([409, "NOT_REVIEWING"]);
    // Handing it in again reuses the same attempt.
    expect((await submitAs(t.a.token, t.projectId, t.aTask.id)).status).toBe(200);
    expect((await attemptsOf(t.aTask.id)).map((a) => [a.no, a.status])).toEqual([[1, "PENDING"]]);
  });

  it("goes back to HALF when an earlier attempt was graded HALF", async () => {
    const t = await team();
    expect((await linkEvidence(t.a.token, t.projectId, t.aTask.id, "https://example.com/1")).status).toBe(201);
    expect((await submitAs(t.a.token, t.projectId, t.aTask.id)).status).toBe(200);
    expect((await gradeAs(t.leader.token, t.projectId, t.aTask.id, "HALF", "少了图表")).status).toBe(200);
    expect((await linkEvidence(t.a.token, t.projectId, t.aTask.id, "https://example.com/2")).status).toBe(201);
    expect((await submitAs(t.a.token, t.projectId, t.aTask.id)).status).toBe(200);
    expect(await taskRow(t.aTask.id)).toMatchObject({ status: "REVIEWING", grade: "HALF" });
    expect((await withdrawAs(t.a.token, t.projectId, t.aTask.id)).status).toBe(200);
    expect(await taskRow(t.aTask.id)).toMatchObject({ status: "HALF", grade: "HALF" });
    expect((await attemptsOf(t.aTask.id)).map((a) => [a.no, a.status])).toEqual([
      [1, "GRADED"],
      [2, "DRAFT"],
    ]);
  });

  it("isn't overdue while waiting for review, and is again after withdrawing", async () => {
    const t = await team();
    await testDb.task.update({ where: { id: t.aTask.id }, data: { dueAt: new Date(Date.now() - HOUR) } });
    const overdue = async () => (await viewAs(t.a.token, t.projectId)).tasks.find((x) => x.id === t.aTask.id)!.overdue;
    expect(await overdue()).toBe(true);
    expect((await linkEvidence(t.a.token, t.projectId, t.aTask.id, "https://example.com")).status).toBe(201);
    expect((await submitAs(t.a.token, t.projectId, t.aTask.id)).status).toBe(200);
    expect(await overdue()).toBe(false);
    expect((await withdrawAs(t.a.token, t.projectId, t.aTask.id)).status).toBe(200);
    expect(await overdue()).toBe(true);
  });
});

describe("POST /api/projects/:id/tasks/:taskId/undo-start", () => {
  it("clears the owner's start within 24 hours while the task has no attempt", async () => {
    const t = await team();
    const notStarted = await undoStartAs(t.a.token, t.projectId, t.aTask.id);
    expect([notStarted.status, notStarted.error?.code]).toEqual([409, "CONFLICT"]);
    expect((await startAs(t.a.token, t.projectId, t.aTask.id)).status).toBe(200);
    expect((await undoStartAs(t.b.token, t.projectId, t.aTask.id)).status).toBe(403);
    expect((await undoStartAs(t.leader.token, t.projectId, t.aTask.id)).status).toBe(403);
    const before = await version(t.projectId);

    const res = await undoStartAs(t.a.token, t.projectId, t.aTask.id);
    expect(res.status).toBe(200);
    expect(await taskRow(t.aTask.id)).toMatchObject({ status: "TODO", startedAt: null, startedById: null });
    const [event] = await eventsOf(t.projectId, "START_UNDONE");
    expect(event).toMatchObject({ actorId: t.rows.a.id, payload: { type: "START_UNDONE", taskId: t.aTask.id, title: t.aTask.title } });
    expect(await version(t.projectId)).toBe(before + 1);
    expect((await viewAs(t.a.token, t.projectId)).packages.find((p) => p.index === 2)!.started).toBe(false);
  });

  it("refuses after 24 hours (UNDO_START_EXPIRED)", async () => {
    const t = await team();
    expect((await startAs(t.a.token, t.projectId, t.aTask.id)).status).toBe(200);
    await testDb.task.update({ where: { id: t.aTask.id }, data: { startedAt: new Date(Date.now() - DAY - MINUTE) } });
    const res = await undoStartAs(t.a.token, t.projectId, t.aTask.id);
    expect([res.status, res.error?.code]).toEqual([409, "UNDO_START_EXPIRED"]);
    // Just inside the window it still works.
    await testDb.task.update({ where: { id: t.aTask.id }, data: { startedAt: new Date(Date.now() - DAY + MINUTE) } });
    expect((await undoStartAs(t.a.token, t.projectId, t.aTask.id)).status).toBe(200);
  });

  it("refuses once evidence was added, even after it was deleted (HAS_EVIDENCE)", async () => {
    const t = await team();
    expect((await uploadEvidence(t.a.token, t.projectId, t.aTask.id, fakeFile("a.pdf", "pdf"))).status).toBe(201);
    const withFile = await undoStartAs(t.a.token, t.projectId, t.aTask.id);
    expect([withFile.status, withFile.error?.code]).toEqual([409, "HAS_EVIDENCE"]);
    const [ev] = await testDb.evidence.findMany({ where: { taskId: t.aTask.id } });
    expect((await call(`${path(t.projectId, t.aTask.id, "evidence")}/${ev!.id}`, { method: "DELETE", token: t.a.token })).status).toBe(200);
    const deleted = await undoStartAs(t.a.token, t.projectId, t.aTask.id);
    expect([deleted.status, deleted.error?.code]).toEqual([409, "HAS_EVIDENCE"]);
    expect(await taskRow(t.aTask.id)).toMatchObject({ status: "DOING", startedById: t.rows.a.id });
  });
});

describe("POST /api/projects/:id/tasks/:taskId/meeting-done", () => {
  async function meetingTeam() {
    const t = await team();
    await testDb.task.update({ where: { id: t.aTask.id }, data: { kind: "MEETING" } });
    return t;
  }

  it("checks the kind, the summary and the attendees", async () => {
    const t = await meetingTeam();
    const doc = await meetingDoneAs(t.a.token, t.projectId, t.aTask2.id, "定了分工", []);
    expect([doc.status, doc.error?.code]).toEqual([409, "NOT_A_MEETING"]);
    const empty = await meetingDoneAs(t.a.token, t.projectId, t.aTask.id, "   ", []);
    expect([empty.status, empty.error?.code]).toEqual([400, "SUMMARY_REQUIRED"]);
    const tooLong = await meetingDoneAs(t.a.token, t.projectId, t.aTask.id, "x".repeat(501), []);
    expect(tooLong.status).toBe(400);
    const unknown = await meetingDoneAs(t.a.token, t.projectId, t.aTask.id, "定了分工", ["nope"]);
    expect([unknown.status, unknown.error?.code]).toEqual([400, "VALIDATION"]);
    // Someone who left can't be ticked as present.
    expect((await call(`/api/projects/${t.projectId}/leave`, { method: "POST", token: t.b.token })).status).toBe(200);
    const left = await meetingDoneAs(t.a.token, t.projectId, t.aTask.id, "定了分工", [t.rows.b.id]);
    expect([left.status, left.error?.code]).toEqual([400, "VALIDATION"]);
    expect((await meetingDoneAs(t.leader.token, t.projectId, t.aTask.id, "定了分工", [])).status).toBe(403);
    expect(await attemptsOf(t.aTask.id)).toHaveLength(0);
  });

  it("marks the meeting done (SELF, full points), the owner always present, absentees snapshotted", async () => {
    const t = await meetingTeam();
    const pkgs = await testDb.package.findMany({ where: { projectId: t.projectId }, orderBy: { index: "asc" } });
    const now = Date.now();
    const swap = await testDb.swapRequest.create({
      data: {
        projectId: t.projectId,
        requesterId: t.rows.b.id,
        targetId: t.rows.a.id,
        requesterPackageId: pkgs[2]!.id,
        targetPackageId: pkgs[1]!.id,
        createdAt: new Date(now - HOUR),
        expiresAt: new Date(now + 71 * HOUR),
      },
    });
    const before = await version(t.projectId);

    const res = await meetingDoneAs(t.a.token, t.projectId, t.aTask.id, "  定了分工和下周的时间  ", [t.rows.leader.id]);
    expect(res.status).toBe(200);
    const [attempt] = await attemptsOf(t.aTask.id);
    expect(attempt).toMatchObject({
      no: 1,
      status: "GRADED",
      grade: "SELF",
      meetingSummary: "定了分工和下周的时间",
      submittedById: t.rows.a.id,
      gradedById: null,
      late: false,
    });
    expect([...attempt!.attendeeIds].sort()).toEqual([t.rows.leader.id, t.rows.a.id].sort());
    expect(attempt!.absentIds).toEqual([t.rows.b.id]);
    const task = await taskRow(t.aTask.id);
    expect(task).toMatchObject({ status: "DONE", grade: "SELF", startedById: t.rows.a.id });
    expect(task.finishedAt).toEqual(attempt!.gradedAt);
    expect(res.data.task.earnedPoints).toBe(task.points);
    const [event] = await eventsOf(t.projectId, "MEETING_DONE");
    expect(event).toMatchObject({ actorId: t.rows.a.id, payload: { type: "MEETING_DONE", taskId: t.aTask.id, attendeeCount: 2 } });
    expect(await testDb.swapRequest.findUniqueOrThrow({ where: { id: swap.id } })).toMatchObject({ status: "VOID", voidReason: "STARTED" });
    expect(await version(t.projectId)).toBe(before + 1);
    // Nobody is notified about a meeting (only the swap requester hears the swap ended).
    expect(await testDb.notification.count({ where: { type: { in: ["GRADED", "SUBMITTED"] } } })).toBe(0);

    // Done means done; and someone joining later is not 没来 for last week's meeting.
    const again = await meetingDoneAs(t.a.token, t.projectId, t.aTask.id, "再开一次", []);
    expect([again.status, again.error?.code]).toEqual([409, "TASK_DONE"]);
    const late = await person(3);
    expect((await joinCode(late.token, t.view.inviteCode!)).status).toBe(200);
    expect((await attemptsOf(t.aTask.id))[0]!.absentIds).toEqual([t.rows.b.id]);
  });

  it("ticking the owner changes nothing, and nobody ticked means only the owner came", async () => {
    const t = await meetingTeam();
    expect((await linkEvidence(t.a.token, t.projectId, t.aTask.id, "https://example.com/minutes")).status).toBe(201);
    expect((await meetingDoneAs(t.a.token, t.projectId, t.aTask.id, "定了分工", [t.rows.a.id, t.rows.a.id])).status).toBe(200);
    const attempts = await attemptsOf(t.aTask.id);
    // The draft with the minutes is the attempt that got marked done.
    expect(attempts).toHaveLength(1);
    expect(await testDb.evidence.count({ where: { attemptId: attempts[0]!.id } })).toBe(1);
    expect(attempts[0]!.attendeeIds).toEqual([t.rows.a.id]);
    expect([...attempts[0]!.absentIds].sort()).toEqual([t.rows.leader.id, t.rows.b.id].sort());
    expect((await eventsOf(t.projectId, "MEETING_DONE"))[0]!.payload).toMatchObject({ attendeeCount: 1 });
  });
});
