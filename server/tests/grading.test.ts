// The leader's side of grading (M4 spec §2, §13): grade, grade outside the app, override, undo, and what
// a grade does to a task whose owner left.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { NotificationPayload, TaskDetail } from "../../shared/types";
import type { ActivityType } from "../src/generated/prisma/client";
import { call, testDb } from "./helpers";
import {
  fakeFile,
  freshDb,
  gradeAs,
  linkEvidence,
  meetingDoneAs,
  outsideAs,
  overrideAs,
  startAs,
  submitAs,
  taskOf,
  uploadEvidence,
  viewAs,
  withPackages,
} from "./project-fixtures";

beforeEach(freshDb);
afterAll(() => testDb.$disconnect());

const memberRow = (projectId: string, userId: string) =>
  testDb.member.findFirstOrThrow({ where: { projectId, userId }, include: { user: true } });
const taskRow = (id: string) => testDb.task.findUniqueOrThrow({ where: { id } });
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

type Team = Awaited<ReturnType<typeof team>>;

/** The owner hands in one more attempt (a link, then 我做完了). */
async function handIn(t: Team, token: string, taskId: string) {
  expect((await linkEvidence(token, t.projectId, taskId, `https://example.com/${Math.random()}`)).status).toBe(201);
  expect((await submitAs(token, t.projectId, taskId)).status).toBe(200);
}

const undoAs = (token: string, projectId: string, taskId: string) =>
  call<TaskDetail>(`/api/projects/${projectId}/tasks/${taskId}/undo-override`, { method: "POST", token });
const moveAs = (token: string, projectId: string, taskId: string, packageId: string) =>
  call(`/api/projects/${projectId}/tasks/${taskId}/move`, { method: "POST", token, body: { packageId } });
const earned = async (t: Team, taskId: string) => (await viewAs(t.leader.token, t.projectId)).tasks.find((x) => x.id === taskId)!.earnedPoints;

describe("POST /api/projects/:id/tasks/:taskId/grade", () => {
  it("is the leader's, for a task waiting for review", async () => {
    const t = await team();
    const none = await gradeAs(t.leader.token, t.projectId, t.aTask.id, "PASS");
    expect([none.status, none.error?.code]).toEqual([409, "NOT_REVIEWING"]);
    await handIn(t, t.a.token, t.aTask.id);
    expect((await gradeAs(t.a.token, t.projectId, t.aTask.id, "PASS")).status).toBe(403);
    expect((await gradeAs(t.b.token, t.projectId, t.aTask.id, "PASS")).status).toBe(403);
    const self = await call(`/api/projects/${t.projectId}/tasks/${t.aTask.id}/grade`, {
      method: "POST",
      token: t.leader.token,
      body: { grade: "SELF" },
    });
    expect(self.status).toBe(400);
    expect((await gradeAs(t.leader.token, t.projectId, "nope", "PASS")).status).toBe(404);
    expect(await taskRow(t.aTask.id)).toMatchObject({ status: "REVIEWING", grade: null });
  });

  it("grades PASS: full points, DONE, GRADED to the owner, feed", async () => {
    const t = await team();
    await handIn(t, t.a.token, t.aTask.id);
    const res = await gradeAs(t.leader.token, t.projectId, t.aTask.id, "PASS", "  做得好  ");
    expect(res.status).toBe(200);
    const [attempt] = await attemptsOf(t.aTask.id);
    expect(attempt).toMatchObject({ status: "GRADED", grade: "PASS", gradeNote: "做得好", gradedById: t.rows.leader.id });
    const task = await taskRow(t.aTask.id);
    expect(task).toMatchObject({ status: "DONE", grade: "PASS" });
    expect(task.finishedAt).toEqual(attempt!.gradedAt);
    expect(res.data.task.earnedPoints).toBe(task.points);
    const sent = await testDb.notification.findMany({ where: { type: "GRADED" } });
    expect(sent.map((n) => [n.userId, n.audience])).toEqual([[t.a.user.id, "ONLY_YOU"]]);
    expect(sent[0]!.payload).toEqual({
      type: "GRADED",
      taskId: t.aTask.id,
      title: t.aTask.title,
      attemptNo: 1,
      grade: "PASS",
      points: task.points,
      earned: task.points,
      counting: true,
    });
    const [event] = await eventsOf(t.projectId, "GRADED");
    expect(event).toMatchObject({
      actorId: t.rows.leader.id,
      payload: {
        type: "GRADED",
        taskId: t.aTask.id,
        owner: { memberId: t.rows.a.id, name: t.rows.a.user.name },
        grade: "PASS",
        attemptNo: 1,
        selfGraded: false,
        outsideApp: false,
      },
    });
  });

  it("needs a reason for HALF and FAIL; HALF earns half and is finished, FAIL earns 0 and can be handed in again", async () => {
    const t = await team();
    await handIn(t, t.a.token, t.aTask.id);
    for (const grade of ["HALF", "FAIL"] as const) {
      const res = await gradeAs(t.leader.token, t.projectId, t.aTask.id, grade, "   ");
      expect([res.status, res.error?.code]).toEqual([400, "GRADE_REASON_REQUIRED"]);
    }
    expect((await gradeAs(t.leader.token, t.projectId, t.aTask.id, "HALF", "少了竞品分析")).status).toBe(200);
    const half = await taskRow(t.aTask.id);
    const [attempt] = await attemptsOf(t.aTask.id);
    expect(half).toMatchObject({ status: "HALF", grade: "HALF" });
    expect(half.finishedAt).toEqual(attempt!.gradedAt);
    expect(await earned(t, t.aTask.id)).toBe(Math.round(half.points / 2));

    await handIn(t, t.b.token, t.bTask.id);
    expect((await gradeAs(t.leader.token, t.projectId, t.bTask.id, "FAIL", "没有交问卷")).status).toBe(200);
    expect(await taskRow(t.bTask.id)).toMatchObject({ status: "FAIL", grade: "FAIL", finishedAt: null });
    expect(await earned(t, t.bTask.id)).toBe(0);
    // Fail: the owner may hand in again.
    await handIn(t, t.b.token, t.bTask.id);
    expect(await taskRow(t.bTask.id)).toMatchObject({ status: "REVIEWING", grade: "FAIL" });
    expect((await notificationsOf(t.b.user.id, "GRADED"))[0]!.payload).toMatchObject({ grade: "FAIL", earned: 0, counting: true });
  });

  it("lets only one of two simultaneous grades through (one GRADED notification)", async () => {
    const t = await team();
    await handIn(t, t.a.token, t.aTask.id);
    const results = await Promise.all([
      gradeAs(t.leader.token, t.projectId, t.aTask.id, "PASS"),
      gradeAs(t.leader.token, t.projectId, t.aTask.id, "HALF", "一半"),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)!.error!.code).toBe("NOT_REVIEWING");
    expect(await notificationsOf(t.a.user.id, "GRADED")).toHaveLength(1);
    expect(await eventsOf(t.projectId, "GRADED")).toHaveLength(1);
  });

  it("HALF → resubmit: still finished and half while re-reviewed, can't move, then PASS gives full points", async () => {
    const t = await team();
    const pkgs = await testDb.package.findMany({ where: { projectId: t.projectId }, orderBy: { index: "asc" } });
    await handIn(t, t.a.token, t.aTask.id);
    expect((await gradeAs(t.leader.token, t.projectId, t.aTask.id, "HALF", "少了图表")).status).toBe(200);
    await handIn(t, t.a.token, t.aTask.id);

    const reviewing = await taskRow(t.aTask.id);
    expect(reviewing).toMatchObject({ status: "REVIEWING", grade: "HALF" });
    expect(reviewing.finishedAt).not.toBeNull();
    expect(await earned(t, t.aTask.id)).toBe(Math.round(reviewing.points / 2));
    const move = await moveAs(t.leader.token, t.projectId, t.aTask.id, pkgs[2]!.id);
    expect([move.status, move.error?.code]).toEqual([409, "TASK_FINISHED"]);
    expect((await viewAs(t.a.token, t.projectId)).packages.find((p) => p.index === 2)!.started).toBe(true);

    expect((await gradeAs(t.leader.token, t.projectId, t.aTask.id, "PASS")).status).toBe(200);
    const done = await taskRow(t.aTask.id);
    const attempts = await attemptsOf(t.aTask.id);
    expect(done).toMatchObject({ status: "DONE", grade: "PASS" });
    expect(done.finishedAt).toEqual(attempts[1]!.gradedAt);
    expect(await earned(t, t.aTask.id)).toBe(done.points);
    expect((await notificationsOf(t.a.user.id, "GRADED")).map((n) => n.payload)).toEqual([
      expect.objectContaining({ attemptNo: 1, grade: "HALF", counting: true }),
      expect.objectContaining({ attemptNo: 2, grade: "PASS", earned: done.points, counting: true }),
    ]);
  });

  it("HALF → resubmit → FAIL keeps the better attempt (grade HALF, half the points; counting: false)", async () => {
    const t = await team();
    await handIn(t, t.a.token, t.aTask.id);
    expect((await gradeAs(t.leader.token, t.projectId, t.aTask.id, "HALF", "少了图表")).status).toBe(200);
    const firstFinishedAt = (await taskRow(t.aTask.id)).finishedAt;
    await handIn(t, t.a.token, t.aTask.id);
    expect((await gradeAs(t.leader.token, t.projectId, t.aTask.id, "FAIL", "改坏了")).status).toBe(200);
    const task = await taskRow(t.aTask.id);
    expect(task).toMatchObject({ status: "HALF", grade: "HALF", finishedAt: firstFinishedAt });
    const half = Math.round(task.points / 2);
    expect(await earned(t, t.aTask.id)).toBe(half);
    const [, second] = await notificationsOf(t.a.user.id, "GRADED");
    expect(second!.payload).toMatchObject({ attemptNo: 2, grade: "FAIL", earned: half, counting: false });
  });

  it("refuses more evidence once the task has full points (TASK_DONE)", async () => {
    const t = await team();
    await handIn(t, t.a.token, t.aTask.id);
    expect((await gradeAs(t.leader.token, t.projectId, t.aTask.id, "EXCELLENT")).status).toBe(200);
    const res = await uploadEvidence(t.a.token, t.projectId, t.aTask.id, fakeFile("more.pdf", "pdf"));
    expect([res.status, res.error?.code]).toEqual([409, "TASK_DONE"]);
    expect(await taskRow(t.aTask.id)).toMatchObject({ status: "DONE", grade: "EXCELLENT" });
  });
});

describe("POST /api/projects/:id/tasks/:taskId/grade-outside", () => {
  it("finishes a TODO task handed in outside the app: starts it, an outsideApp attempt, GRADED_OUTSIDE", async () => {
    const t = await team();
    const res = await outsideAs(t.leader.token, t.projectId, t.aTask.id, "PASS", undefined, "  WhatsApp 发给我了  ");
    expect(res.status).toBe(200);
    const [attempt] = await attemptsOf(t.aTask.id);
    expect(attempt).toMatchObject({
      no: 1,
      status: "GRADED",
      grade: "PASS",
      outsideApp: true,
      outsideNote: "WhatsApp 发给我了",
      submittedById: null,
      gradedById: t.rows.leader.id,
      late: false,
    });
    expect(attempt!.submittedAt).not.toBeNull();
    const task = await taskRow(t.aTask.id);
    expect(task).toMatchObject({ status: "DONE", grade: "PASS", startedById: t.rows.a.id });
    expect(task.startedAt).not.toBeNull();
    const [n] = await notificationsOf(t.a.user.id, "GRADED_OUTSIDE");
    expect(n!.payload).toEqual({
      type: "GRADED_OUTSIDE",
      taskId: t.aTask.id,
      title: t.aTask.title,
      grade: "PASS",
      points: task.points,
      earned: task.points,
      counting: true,
      outsideNote: "WhatsApp 发给我了",
    });
    const [event] = await eventsOf(t.projectId, "GRADED");
    expect(event).toMatchObject({ actorId: t.rows.leader.id, payload: { outsideApp: true, selfGraded: false, grade: "PASS" } });
    expect((await eventsOf(t.projectId, "TASK_STARTED"))[0]).toMatchObject({ actorId: t.rows.a.id });

    // The leader's own task only ever gets 合格（组长自评） by handing it in (A7).
    const own = await outsideAs(t.leader.token, t.projectId, t.leaderTask.id, "HALF", "只做了一半");
    expect([own.status, own.error?.code]).toEqual([403, "SELF_GRADE_NOT_ALLOWED"]);
    expect(await taskRow(t.leaderTask.id)).toMatchObject({ status: "TODO", grade: null });
  });

  it("keeps someone else's start and the draft's evidence", async () => {
    const t = await team();
    const pkgs = await testDb.package.findMany({ where: { projectId: t.projectId }, orderBy: { index: "asc" } });
    expect((await startAs(t.b.token, t.projectId, t.bTask.id)).status).toBe(200);
    const started = await taskRow(t.bTask.id);
    expect((await moveAs(t.leader.token, t.projectId, t.bTask.id, pkgs[1]!.id)).status).toBe(200);
    expect((await outsideAs(t.leader.token, t.projectId, t.bTask.id, "PASS")).status).toBe(200);
    expect(await taskRow(t.bTask.id)).toMatchObject({
      ownerId: t.rows.a.id,
      status: "DONE",
      startedById: t.rows.b.id,
      startedAt: started.startedAt,
    });

    expect((await linkEvidence(t.a.token, t.projectId, t.aTask.id, "https://example.com")).status).toBe(201);
    expect((await outsideAs(t.leader.token, t.projectId, t.aTask.id, "FAIL", "不完整")).status).toBe(200);
    const attempts = await attemptsOf(t.aTask.id);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ outsideApp: true, grade: "FAIL" });
    expect(await testDb.evidence.count({ where: { attemptId: attempts[0]!.id } })).toBe(1);
  });

  it("refuses a waiting submission, a task without an owner, a full-points task and non-leaders", async () => {
    const t = await team();
    await handIn(t, t.a.token, t.aTask.id);
    const pending = await outsideAs(t.leader.token, t.projectId, t.aTask.id, "PASS");
    expect([pending.status, pending.error?.code]).toEqual([409, "ALREADY_REVIEWING"]);
    expect((await gradeAs(t.leader.token, t.projectId, t.aTask.id, "PASS")).status).toBe(200);
    const done = await outsideAs(t.leader.token, t.projectId, t.aTask.id, "PASS");
    expect([done.status, done.error?.code]).toEqual([409, "TASK_DONE"]);

    await testDb.task.update({ where: { id: t.bTask.id }, data: { ownerId: null } });
    const noOwner = await outsideAs(t.leader.token, t.projectId, t.bTask.id, "PASS");
    expect([noOwner.status, noOwner.error?.code]).toEqual([409, "TASK_NO_OWNER"]);
    expect((await outsideAs(t.a.token, t.projectId, t.aTask2.id, "PASS")).status).toBe(403);
    const reason = await outsideAs(t.leader.token, t.projectId, t.aTask2.id, "HALF");
    expect([reason.status, reason.error?.code]).toEqual([400, "GRADE_REASON_REQUIRED"]);
    expect(await attemptsOf(t.aTask2.id)).toHaveLength(0);
  });
});

describe("POST /api/projects/:id/tasks/:taskId/override and /undo-override", () => {
  it("overrides PASS down to HALF and back by undoing it", async () => {
    const t = await team();
    await handIn(t, t.a.token, t.aTask.id);
    expect((await gradeAs(t.leader.token, t.projectId, t.aTask.id, "PASS")).status).toBe(200);
    const same = await overrideAs(t.leader.token, t.projectId, t.aTask.id, "PASS", "再看一遍");
    expect([same.status, same.error?.code]).toEqual([400, "VALIDATION"]);
    const noReason = await overrideAs(t.leader.token, t.projectId, t.aTask.id, "HALF", "   ");
    expect([noReason.status, noReason.error?.code]).toEqual([400, "REASON_REQUIRED"]);
    expect((await overrideAs(t.a.token, t.projectId, t.aTask.id, "EXCELLENT", "我觉得")).status).toBe(403);

    const res = await overrideAs(t.leader.token, t.projectId, t.aTask.id, "HALF", "数据是抄的");
    expect(res.status).toBe(200);
    const [attempt] = await attemptsOf(t.aTask.id);
    expect(attempt!.grade).toBe("HALF");
    const [change] = await testDb.gradeChange.findMany({ where: { attemptId: attempt!.id } });
    expect(change).toMatchObject({ fromGrade: "PASS", toGrade: "HALF", reason: "数据是抄的", byId: t.rows.leader.id, undoneAt: null });
    const task = await taskRow(t.aTask.id);
    expect(task).toMatchObject({ status: "HALF", grade: "HALF" });
    expect(task.finishedAt).toEqual(change!.createdAt);
    const half = Math.round(task.points / 2);
    expect(await earned(t, t.aTask.id)).toBe(half);
    const [n] = await notificationsOf(t.a.user.id, "OVERRIDDEN");
    expect(n!.payload).toEqual({
      type: "OVERRIDDEN",
      taskId: t.aTask.id,
      title: t.aTask.title,
      attemptNo: 1,
      fromGrade: "PASS",
      toGrade: "HALF",
      points: task.points,
      earned: half,
      counting: true,
      undone: false,
    });
    const [event] = await eventsOf(t.projectId, "OVERRIDDEN");
    expect(event).toMatchObject({
      actorId: t.rows.leader.id,
      payload: { owner: { memberId: t.rows.a.id }, attemptNo: 1, fromGrade: "PASS", toGrade: "HALF", undone: false },
    });

    expect((await undoAs(t.a.token, t.projectId, t.aTask.id)).status).toBe(403);
    const undo = await undoAs(t.leader.token, t.projectId, t.aTask.id);
    expect(undo.status).toBe(200);
    const back = await taskRow(t.aTask.id);
    expect(back).toMatchObject({ status: "DONE", grade: "PASS" });
    expect(back.finishedAt).toEqual(attempt!.gradedAt);
    expect(await earned(t, t.aTask.id)).toBe(back.points);
    expect((await testDb.gradeChange.findUniqueOrThrow({ where: { id: change!.id } })).undoneById).toBe(t.rows.leader.id);
    expect((await notificationsOf(t.a.user.id, "OVERRIDDEN"))[1]!.payload).toMatchObject({
      fromGrade: "HALF",
      toGrade: "PASS",
      earned: back.points,
      undone: true,
    });
    expect((await eventsOf(t.projectId, "OVERRIDDEN"))[1]!.payload).toMatchObject({ toGrade: "PASS", undone: true });
    const twice = await undoAs(t.leader.token, t.projectId, t.aTask.id);
    expect([twice.status, twice.error?.code]).toEqual([409, "NOTHING_TO_UNDO"]);
  });

  it("walks back several overrides one at a time", async () => {
    const t = await team();
    await handIn(t, t.a.token, t.aTask.id);
    expect((await gradeAs(t.leader.token, t.projectId, t.aTask.id, "PASS")).status).toBe(200);
    expect((await overrideAs(t.leader.token, t.projectId, t.aTask.id, "HALF", "一")).status).toBe(200);
    expect((await overrideAs(t.leader.token, t.projectId, t.aTask.id, "FAIL", "二")).status).toBe(200);
    expect(await taskRow(t.aTask.id)).toMatchObject({ status: "FAIL", grade: "FAIL", finishedAt: null });
    expect((await undoAs(t.leader.token, t.projectId, t.aTask.id)).status).toBe(200);
    expect(await taskRow(t.aTask.id)).toMatchObject({ grade: "HALF" });
    expect((await undoAs(t.leader.token, t.projectId, t.aTask.id)).status).toBe(200);
    expect(await taskRow(t.aTask.id)).toMatchObject({ grade: "PASS", status: "DONE" });
    expect((await undoAs(t.leader.token, t.projectId, t.aTask.id)).error?.code).toBe("NOTHING_TO_UNDO");
  });

  it("targets another graded attempt by id: raising the non-counting FAIL to PASS finishes the task", async () => {
    const t = await team();
    await handIn(t, t.a.token, t.aTask.id);
    expect((await gradeAs(t.leader.token, t.projectId, t.aTask.id, "HALF", "少了图表")).status).toBe(200);
    await handIn(t, t.a.token, t.aTask.id);
    expect((await gradeAs(t.leader.token, t.projectId, t.aTask.id, "FAIL", "改坏了")).status).toBe(200);
    const [first, second] = await attemptsOf(t.aTask.id);

    expect((await overrideAs(t.leader.token, t.projectId, t.aTask.id, "PASS", "看错了", "nope")).status).toBe(404);
    // An attempt of another task isn't reachable through this one.
    await handIn(t, t.b.token, t.bTask.id);
    expect((await gradeAs(t.leader.token, t.projectId, t.bTask.id, "FAIL", "没做完")).status).toBe(200);
    const [bAttempt] = await attemptsOf(t.bTask.id);
    expect((await overrideAs(t.leader.token, t.projectId, t.aTask.id, "PASS", "看错了", bAttempt!.id)).status).toBe(404);
    const res = await overrideAs(t.leader.token, t.projectId, t.aTask.id, "PASS", "第二次其实可以", second!.id);
    expect(res.status).toBe(200);
    expect(await taskRow(t.aTask.id)).toMatchObject({ status: "DONE", grade: "PASS" });
    expect((await attemptsOf(t.aTask.id)).map((a) => a.grade)).toEqual(["HALF", "PASS"]);
    expect((await notificationsOf(t.a.user.id, "OVERRIDDEN"))[0]!.payload).toMatchObject({ attemptNo: 2, counting: true });
    // By default the counting attempt (now the second).
    expect((await overrideAs(t.leader.token, t.projectId, t.aTask.id, "HALF", "还是一半")).status).toBe(200);
    expect((await attemptsOf(t.aTask.id)).map((a) => a.grade)).toEqual(["HALF", "HALF"]);
    // Lowering the first (no longer counting) HALF changes nothing the task earns.
    expect((await overrideAs(t.leader.token, t.projectId, t.aTask.id, "FAIL", "第一次不算", first!.id)).status).toBe(200);
    const task = await taskRow(t.aTask.id);
    expect(task).toMatchObject({ grade: "HALF" });
    expect((await notificationsOf(t.a.user.id, "OVERRIDDEN"))[2]!.payload).toMatchObject({
      attemptNo: 1,
      counting: false,
      earned: Math.round(task.points / 2),
    });
  });

  it("is refused while a submission waits (override and undo), and without any grade (NOT_GRADED)", async () => {
    const t = await team();
    const notGraded = await overrideAs(t.leader.token, t.projectId, t.aTask.id, "PASS", "先评");
    expect([notGraded.status, notGraded.error?.code]).toEqual([409, "NOT_GRADED"]);
    await handIn(t, t.a.token, t.aTask.id);
    expect((await gradeAs(t.leader.token, t.projectId, t.aTask.id, "HALF", "少了图表")).status).toBe(200);
    expect((await overrideAs(t.leader.token, t.projectId, t.aTask.id, "FAIL", "更差")).status).toBe(200);
    // A graded attempt that isn't waiting can't be targeted while it's a draft either.
    expect((await linkEvidence(t.a.token, t.projectId, t.aTask.id, "https://example.com/draft")).status).toBe(201);
    const draft = (await attemptsOf(t.aTask.id))[1]!;
    const notGradedAttempt = await overrideAs(t.leader.token, t.projectId, t.aTask.id, "PASS", "x", draft.id);
    expect([notGradedAttempt.status, notGradedAttempt.error?.code]).toEqual([400, "VALIDATION"]);
    expect((await submitAs(t.a.token, t.projectId, t.aTask.id)).status).toBe(200);

    const override = await overrideAs(t.leader.token, t.projectId, t.aTask.id, "PASS", "改主意了");
    expect([override.status, override.error?.code]).toEqual([409, "ALREADY_REVIEWING"]);
    const undo = await undoAs(t.leader.token, t.projectId, t.aTask.id);
    expect([undo.status, undo.error?.code]).toEqual([409, "ALREADY_REVIEWING"]);
  });

  it("can override a meeting marked done (SELF) to FAIL", async () => {
    const t = await team();
    await testDb.task.update({ where: { id: t.aTask.id }, data: { kind: "MEETING" } });
    expect((await meetingDoneAs(t.a.token, t.projectId, t.aTask.id, "定了分工", [])).status).toBe(200);
    expect((await overrideAs(t.leader.token, t.projectId, t.aTask.id, "FAIL", "其实没开")).status).toBe(200);
    expect(await taskRow(t.aTask.id)).toMatchObject({ status: "FAIL", grade: "FAIL", finishedAt: null });
    expect((await notificationsOf(t.a.user.id, "OVERRIDDEN"))[0]!.payload).toMatchObject({ fromGrade: "SELF", toGrade: "FAIL", earned: 0 });
  });
});

describe("grading a task whose owner left", () => {
  it("releases it when graded FAIL, so the leader can move it (no 「from」 package)", async () => {
    const t = await team();
    const pkgs = await testDb.package.findMany({ where: { projectId: t.projectId }, orderBy: { index: "asc" } });
    await handIn(t, t.b.token, t.bTask.id);
    expect((await call(`/api/projects/${t.projectId}/leave`, { method: "POST", token: t.b.token })).status).toBe(200);
    expect(await taskRow(t.bTask.id)).toMatchObject({ ownerId: t.rows.b.id, packageId: null, status: "REVIEWING" });

    expect((await gradeAs(t.leader.token, t.projectId, t.bTask.id, "FAIL", "没做完")).status).toBe(200);
    expect(await taskRow(t.bTask.id)).toMatchObject({
      ownerId: null,
      packageId: null,
      status: "FAIL",
      grade: "FAIL",
      startedAt: null,
      startedById: null,
    });
    // Nothing reaches someone who left; the feed still says it happened.
    expect(await notificationsOf(t.b.user.id, "GRADED")).toHaveLength(0);
    expect(await eventsOf(t.projectId, "GRADED")).toHaveLength(1);

    const moved = await moveAs(t.leader.token, t.projectId, t.bTask.id, pkgs[1]!.id);
    expect(moved.status).toBe(200);
    expect(await taskRow(t.bTask.id)).toMatchObject({ ownerId: t.rows.a.id, packageId: pkgs[1]!.id });
    const [movedIn] = await notificationsOf(t.a.user.id, "TASK_MOVED_IN");
    expect(movedIn!.payload).toMatchObject({ from: null, fromPackageIndex: null, toPackageIndex: 2, hasEvidence: true });
    expect(await testDb.notification.count({ where: { type: "TASK_MOVED_OUT" } })).toBe(0);
    expect((await eventsOf(t.projectId, "TASK_MOVED"))[0]!.payload).toMatchObject({ fromPackageIndex: null, toPackageIndex: 2 });
    // The new owner can hand it in again (attempt 2).
    await handIn(t, t.a.token, t.bTask.id);
    expect((await attemptsOf(t.bTask.id)).map((a) => [a.no, a.status])).toEqual([
      [1, "GRADED"],
      [2, "PENDING"],
    ]);
  });

  it("keeps a passed task credited to the leaver, without telling them", async () => {
    const t = await team();
    await handIn(t, t.b.token, t.bTask.id);
    expect((await call(`/api/projects/${t.projectId}/leave`, { method: "POST", token: t.b.token })).status).toBe(200);
    expect((await gradeAs(t.leader.token, t.projectId, t.bTask.id, "PASS")).status).toBe(200);
    const task = await taskRow(t.bTask.id);
    expect(task).toMatchObject({ ownerId: t.rows.b.id, status: "DONE", grade: "PASS" });
    expect(await notificationsOf(t.b.user.id)).toHaveLength(0);
    // Overridden down to FAIL later: unfinished now, so released.
    expect((await overrideAs(t.leader.token, t.projectId, t.bTask.id, "FAIL", "抄的")).status).toBe(200);
    expect(await taskRow(t.bTask.id)).toMatchObject({ ownerId: null, status: "FAIL" });
    expect(await notificationsOf(t.b.user.id)).toHaveLength(0);
    // Tasks where the owner left can't be graded outside the app: nobody is responsible any more.
    const outside = await outsideAs(t.leader.token, t.projectId, t.bTask.id, "PASS");
    expect([outside.status, outside.error?.code]).toEqual([409, "TASK_NO_OWNER"]);
    expect((await uploadEvidence(t.a.token, t.projectId, t.bTask.id, fakeFile("x.pdf", "pdf"))).status).toBe(403);
  });
});
