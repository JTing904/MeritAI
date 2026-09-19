// M4 end to end (spec §12 integrator, §13): the cases that need both the evidence / grading side and the
// task side. Everything goes through the HTTP routes, except the few states the app can't reach, which
// under-review.test.ts writes the same way (a submission on a task someone else started).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { MyTasksView, NotificationPayload, ProjectView, TaskDetail } from "../../shared/types";
import { addAttempt, recompute } from "./attempt-rows";
import { call, testDb } from "./helpers";
import {
  activeWith,
  DAY,
  detailAs,
  devStatus,
  freshDb,
  gradeAs,
  joinCode,
  linkEvidence,
  meetingDoneAs,
  outsideAs,
  overrideAs,
  person,
  pickAs,
  submitAs,
  taskOf,
  viewAs,
  withPackages,
  type ActiveTeam,
} from "./project-fixtures";

beforeEach(freshDb);
afterAll(() => testDb.$disconnect());

type Person = ActiveTeam["leader"];

const memberId = (view: ProjectView, userId: string) => view.members.find((m) => m.userId === userId)!.id;
const taskRow = (id: string) => testDb.task.findUniqueOrThrow({ where: { id } });
const attemptsOf = (taskId: string) => testDb.attempt.findMany({ where: { taskId }, orderBy: { no: "asc" } });
const notes = (userId: string, type: NotificationPayload["type"]) =>
  testDb.notification.findMany({ where: { userId, type }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
const version = async (projectId: string) => (await testDb.project.findUniqueOrThrow({ where: { id: projectId } })).packagesVersion;

const taskPath = (projectId: string, taskId: string) => `/api/projects/${projectId}/tasks/${taskId}`;
const prereqAs = (token: string, projectId: string, taskId: string, prereqTaskId: string | null) =>
  call<TaskDetail>(`${taskPath(projectId, taskId)}/prereq`, { method: "PUT", token, body: { prereqTaskId } });
const moveAs = (token: string, projectId: string, taskId: string, packageId: string) =>
  call<ProjectView>(`${taskPath(projectId, taskId)}/move`, { method: "POST", token, body: { packageId } });
const withdrawAs = (token: string, projectId: string, taskId: string) =>
  call<TaskDetail>(`${taskPath(projectId, taskId)}/withdraw`, { method: "POST", token });
const undoOverrideAs = (token: string, projectId: string, taskId: string) =>
  call<TaskDetail>(`${taskPath(projectId, taskId)}/undo-override`, { method: "POST", token });
const patchAs = (token: string, projectId: string, taskId: string, body: object) =>
  call<ProjectView>(taskPath(projectId, taskId), { method: "PATCH", token, body });
const taskView = async (token: string, projectId: string, taskId: string) =>
  (await viewAs(token, projectId)).tasks.find((x) => x.id === taskId)!;

/** Three people, everyone with a package: the leader 「任务包 1」, A (林晓雯) 「任务包 2」, B (王子杰) 「任务包 3」. */
async function team() {
  const t = await withPackages(3);
  const [a, b] = t.members as [Person, Person];
  return {
    ...t,
    a,
    b,
    ids: { leader: memberId(t.view, t.leader.user.id), a: memberId(t.view, a.user.id), b: memberId(t.view, b.user.id) },
    aTask: taskOf(t.view, 0, 2),
    aTask2: taskOf(t.view, 1, 2),
    bTask: taskOf(t.view, 0, 3),
    leaderTask: taskOf(t.view, 0, 1),
  };
}

type Team = Awaited<ReturnType<typeof team>>;

/** The owner hands in one more attempt: a link, then 我做完了. */
async function handIn(token: string, projectId: string, taskId: string) {
  expect((await linkEvidence(token, projectId, taskId, `https://example.com/${Math.random()}`)).status).toBe(201);
  const res = await submitAs(token, projectId, taskId);
  expect(res.status).toBe(200);
  return res.data;
}

/** B's task waits for A's (set by B through the route): A and the leader hear WAITING_ON_YOU. */
async function bWaitsForA(t: Team) {
  const res = await prereqAs(t.b.token, t.projectId, t.bTask.id, t.aTask.id);
  expect(res.status).toBe(200);
  expect(res.data.prereq).toMatchObject({ taskId: t.aTask.id, ownerMemberId: t.ids.a, finished: false });
  expect(await notes(t.a.user.id, "WAITING_ON_YOU")).toHaveLength(1);
  expect(await notes(t.leader.user.id, "WAITING_ON_YOU")).toHaveLength(1);
}

const prereqDone = (t: Team, who: Person = t.b) => notes(who.user.id, "PREREQ_DONE");

describe("PREREQ_DONE end to end", () => {
  it("grade: sent once when the prerequisite is graded HALF; the resubmission can't move and its PASS sends nothing more", async () => {
    const t = await team();
    await bWaitsForA(t);
    // The leader's own task waits too: the leader grades, so the leader (the actor) hears nothing.
    expect((await prereqAs(t.leader.token, t.projectId, t.leaderTask.id, t.aTask.id)).status).toBe(200);

    await handIn(t.a.token, t.projectId, t.aTask.id);
    const pkg3 = t.view.packages.find((p) => p.index === 3)!.id;
    // 交了就不换手: a first submission isn't finished, but it can't move while it waits (§15 #1).
    const underReview = await moveAs(t.leader.token, t.projectId, t.aTask.id, pkg3);
    expect([underReview.status, underReview.error?.code]).toEqual([409, "TASK_UNDER_REVIEW"]);

    expect((await gradeAs(t.leader.token, t.projectId, t.aTask.id, "HALF", "图表不够")).status).toBe(200);
    const [done] = await prereqDone(t);
    expect(await prereqDone(t)).toHaveLength(1);
    expect(done!.payload).toEqual({
      type: "PREREQ_DONE",
      prereqTaskId: t.aTask.id,
      prereqTitle: t.aTask.title,
      waitingTaskId: t.bTask.id,
      waitingTitle: t.bTask.title,
    });
    expect(await prereqDone(t, t.leader)).toHaveLength(0);
    expect(await prereqDone(t, t.a)).toHaveLength(0);
    expect((await detailAs(t.b.token, t.projectId, t.bTask.id)).data.prereq).toMatchObject({ finished: true, status: "HALF" });

    const halfMove = await moveAs(t.leader.token, t.projectId, t.aTask.id, pkg3);
    expect([halfMove.status, halfMove.error?.code]).toEqual([409, "TASK_FINISHED"]);

    // Resubmission (第 2 次): REVIEWING, but the HALF still counts and the task stays finished.
    const resubmitted = await handIn(t.a.token, t.projectId, t.aTask.id);
    expect(resubmitted.current).toMatchObject({ no: 2, status: "PENDING" });
    expect(await taskRow(t.aTask.id)).toMatchObject({ status: "REVIEWING", grade: "HALF" });
    const row = await taskView(t.leader.token, t.projectId, t.aTask.id);
    expect(row).toMatchObject({ status: "REVIEWING", earnedPoints: Math.round(row.points / 2) });
    expect((await viewAs(t.leader.token, t.projectId)).pendingReviews.map((r) => [r.taskId, r.attemptNo])).toEqual([[t.aTask.id, 2]]);
    expect((await detailAs(t.b.token, t.projectId, t.bTask.id)).data.prereq).toMatchObject({ finished: true, status: "REVIEWING" });
    const again = await moveAs(t.leader.token, t.projectId, t.aTask.id, pkg3);
    expect([again.status, again.error?.code]).toEqual([409, "TASK_FINISHED"]);
    // A's package stays started (no switching or swapping away from it).
    expect((await viewAs(t.a.token, t.projectId)).packages.find((p) => p.index === 2)).toMatchObject({ ownerMemberId: t.ids.a, started: true });
    const submitted = await notes(t.leader.user.id, "SUBMITTED");
    expect(submitted.map((n) => (n.payload as { attemptNo: number }).attemptNo)).toEqual([1, 2]);

    expect((await gradeAs(t.leader.token, t.projectId, t.aTask.id, "PASS")).status).toBe(200);
    const [, second] = await attemptsOf(t.aTask.id);
    const task = await taskRow(t.aTask.id);
    expect(task).toMatchObject({ status: "DONE", grade: "PASS", finishedAt: second!.gradedAt });
    expect((await taskView(t.a.token, t.projectId, t.aTask.id)).earnedPoints).toBe(task.points);
    // Already finished on HALF: no second PREREQ_DONE.
    expect(await prereqDone(t)).toHaveLength(1);
    const graded = await notes(t.a.user.id, "GRADED");
    expect(graded.map((n) => n.payload)).toMatchObject([
      { grade: "HALF", attemptNo: 1, counting: true, earned: Math.round(task.points / 2) },
      { grade: "PASS", attemptNo: 2, counting: true, earned: task.points },
    ]);
  });

  it("override up: sent when a FAIL is overridden to PASS, and again after an override down is undone", async () => {
    const t = await team();
    await bWaitsForA(t);
    await handIn(t.a.token, t.projectId, t.aTask.id);
    expect((await gradeAs(t.leader.token, t.projectId, t.aTask.id, "FAIL", "缺数据")).status).toBe(200);
    expect(await prereqDone(t)).toHaveLength(0);
    expect((await detailAs(t.b.token, t.projectId, t.bTask.id)).data.prereq).toMatchObject({ finished: false, status: "FAIL" });

    expect((await overrideAs(t.leader.token, t.projectId, t.aTask.id, "PASS", "数据在附录里")).status).toBe(200);
    expect(await prereqDone(t)).toHaveLength(1);
    expect(await taskRow(t.aTask.id)).toMatchObject({ status: "DONE", grade: "PASS" });

    // Down to FAIL: unfinished again (no un-notify); B's prerequisite is open again.
    expect((await overrideAs(t.leader.token, t.projectId, t.aTask.id, "FAIL", "附录是别组的")).status).toBe(200);
    expect(await taskRow(t.aTask.id)).toMatchObject({ status: "FAIL", grade: "FAIL", finishedAt: null });
    expect(await prereqDone(t)).toHaveLength(1);
    expect((await detailAs(t.b.token, t.projectId, t.bTask.id)).data.prereq).toMatchObject({ finished: false });

    // Undoing that override finishes it again: PREREQ_DONE once more.
    expect((await undoOverrideAs(t.leader.token, t.projectId, t.aTask.id)).status).toBe(200);
    expect(await taskRow(t.aTask.id)).toMatchObject({ status: "DONE", grade: "PASS" });
    expect(await prereqDone(t)).toHaveLength(2);
    const overridden = await notes(t.a.user.id, "OVERRIDDEN");
    expect(overridden.map((n) => n.payload)).toMatchObject([
      { fromGrade: "FAIL", toGrade: "PASS", undone: false },
      { fromGrade: "PASS", toGrade: "FAIL", undone: false },
      { fromGrade: "FAIL", toGrade: "PASS", undone: true },
    ]);
  });

  it("grade outside the app: sent to the waiter; the owner hears GRADED_OUTSIDE", async () => {
    const t = await team();
    await bWaitsForA(t);
    expect((await outsideAs(t.leader.token, t.projectId, t.aTask.id, "PASS", undefined, "纸质版交给我了")).status).toBe(200);
    expect(await prereqDone(t)).toHaveLength(1);
    expect(await prereqDone(t, t.leader)).toHaveLength(0);
    const [outside] = await notes(t.a.user.id, "GRADED_OUTSIDE");
    expect(outside!.payload).toMatchObject({ grade: "PASS", counting: true, outsideNote: "纸质版交给我了" });
    expect(await taskRow(t.aTask.id)).toMatchObject({ status: "DONE", grade: "PASS", startedById: t.ids.a });
  });

  it("meeting done: sent to every active waiter except the one who marked it (the leader waits too)", async () => {
    const t = await team();
    expect((await patchAs(t.leader.token, t.projectId, t.aTask.id, { kind: "MEETING" })).status).toBe(200);
    await bWaitsForA(t);
    expect((await prereqAs(t.leader.token, t.projectId, t.leaderTask.id, t.aTask.id)).status).toBe(200);
    // A's own second task waits for the meeting too: A marks it done, so A hears nothing.
    expect((await prereqAs(t.a.token, t.projectId, t.aTask2.id, t.aTask.id)).status).toBe(200);

    const res = await meetingDoneAs(t.a.token, t.projectId, t.aTask.id, "定了问卷的题目", [t.ids.b]);
    expect(res.status).toBe(200);
    expect(res.data.attempts[0]!.meeting).toEqual({
      summary: "定了问卷的题目",
      attendeeMemberIds: [t.ids.b, t.ids.a],
      absentMemberIds: [t.ids.leader],
    });
    expect(await prereqDone(t)).toHaveLength(1);
    expect(await prereqDone(t, t.leader)).toHaveLength(1);
    expect(await prereqDone(t, t.a)).toHaveLength(0);
    // Finished: nobody can set it as a prerequisite any more.
    const other = await prereqAs(t.b.token, t.projectId, taskOf(t.view, 1, 3).id, t.aTask.id);
    expect([other.status, other.error?.code]).toEqual([409, "PREREQ_FINISHED"]);
  });
});

describe("late submissions in the review queue", () => {
  it("shows late (task due and project deadline) after a real submit, and drops a withdrawn one", async () => {
    const t = await team();
    const aDue = new Date(Date.now() - DAY);
    await testDb.task.update({ where: { id: t.aTask.id }, data: { dueAt: aDue } });

    await handIn(t.a.token, t.projectId, t.aTask.id);
    await handIn(t.b.token, t.projectId, t.bTask.id);

    const queue = (await viewAs(t.leader.token, t.projectId)).pendingReviews;
    expect(queue.map((r) => r.taskId).sort()).toEqual([t.aTask.id, t.bTask.id].sort());
    expect(queue.find((r) => r.taskId === t.aTask.id)).toMatchObject({
      ownerMemberId: t.ids.a,
      attemptNo: 1,
      evidenceCount: 1,
      late: true,
      dueAt: aDue.toISOString(),
    });
    expect(queue.find((r) => r.taskId === t.bTask.id)).toMatchObject({ late: false, dueAt: t.view.basics.deadline });
    expect((await viewAs(t.a.token, t.projectId)).pendingReviews).toEqual([]);
    const [submitted] = (await notes(t.leader.user.id, "SUBMITTED")).filter((n) => (n.payload as { taskId: string }).taskId === t.aTask.id);
    expect(submitted!.payload).toMatchObject({ late: true, dueAt: aDue.toISOString(), evidenceCount: 1, allFiles: false });
    // Past due but handed in: late, not overdue.
    expect(await taskView(t.leader.token, t.projectId, t.aTask.id)).toMatchObject({ status: "REVIEWING", late: true, overdue: false });

    expect((await withdrawAs(t.a.token, t.projectId, t.aTask.id)).status).toBe(200);
    expect((await viewAs(t.leader.token, t.projectId)).pendingReviews.map((r) => r.taskId)).toEqual([t.bTask.id]);
    expect(await taskView(t.leader.token, t.projectId, t.aTask.id)).toMatchObject({ status: "DOING", late: false, overdue: true });

    // No task due: the project deadline decides.
    const deadline = new Date(Date.now() - 60 * 1000);
    await testDb.project.update({ where: { id: t.projectId }, data: { deadline } });
    await handIn(t.a.token, t.projectId, t.aTask2.id);
    expect((await viewAs(t.leader.token, t.projectId)).pendingReviews.find((r) => r.taskId === t.aTask2.id)).toMatchObject({
      late: true,
      dueAt: deadline.toISOString(),
    });
    // Late can still be graded for full points.
    expect((await gradeAs(t.leader.token, t.projectId, t.aTask2.id, "EXCELLENT")).status).toBe(200);
    const done = await taskView(t.a.token, t.projectId, t.aTask2.id);
    expect(done).toMatchObject({ status: "DONE", grade: "EXCELLENT", late: true, earnedPoints: done.points });
  });
});

describe("the development status tool, through the services", () => {
  it("DONE grades the waiting submission, HALF and DONE override it and back; the waiter hears PREREQ_DONE once", async () => {
    const t = await team();
    await bWaitsForA(t);
    await handIn(t.a.token, t.projectId, t.aTask.id);
    const points = (await taskRow(t.aTask.id)).points;

    let v = await version(t.projectId);
    expect((await devStatus(t.b.token, t.aTask.id, "DONE")).status).toBe(200);
    const [attempt] = await attemptsOf(t.aTask.id);
    expect(attempt).toMatchObject({
      status: "GRADED",
      grade: "PASS",
      outsideApp: false,
      submittedById: t.ids.a,
      gradedById: t.ids.leader,
      gradeNote: "开发测试",
    });
    expect(await version(t.projectId)).toBe(++v);
    expect(await prereqDone(t)).toHaveLength(1);
    expect((await notes(t.a.user.id, "GRADED")).map((n) => n.payload)).toMatchObject([{ grade: "PASS", counting: true, earned: points }]);

    expect((await devStatus(t.b.token, t.aTask.id, "HALF")).status).toBe(200);
    expect(await taskRow(t.aTask.id)).toMatchObject({ status: "HALF", grade: "HALF" });
    expect((await taskView(t.a.token, t.projectId, t.aTask.id)).earnedPoints).toBe(Math.round(points / 2));
    expect(await version(t.projectId)).toBe(++v);

    expect((await devStatus(t.b.token, t.aTask.id, "DONE")).status).toBe(200);
    expect(await taskRow(t.aTask.id)).toMatchObject({ status: "DONE", grade: "PASS" });
    expect((await taskView(t.a.token, t.projectId, t.aTask.id)).earnedPoints).toBe(points);
    expect(await version(t.projectId)).toBe(++v);
    // HALF is finished too: no second PREREQ_DONE on the way.
    expect(await prereqDone(t)).toHaveLength(1);
    expect((await notes(t.a.user.id, "OVERRIDDEN")).map((n) => n.payload)).toMatchObject([
      { fromGrade: "PASS", toGrade: "HALF", undone: false },
      { fromGrade: "HALF", toGrade: "PASS", undone: false },
    ]);

    const detail = (await detailAs(t.a.token, t.projectId, t.aTask.id)).data;
    expect(detail.attempts).toHaveLength(1);
    expect(detail.countingAttemptId).toBe(attempt!.id);
    expect(detail.attempts[0]!.changes.map((c) => [c.fromGrade, c.toGrade, c.byMemberId, c.undoneAt])).toEqual([
      ["HALF", "PASS", t.ids.leader, null],
      ["PASS", "HALF", t.ids.leader, null],
    ]);

    // The leader can walk the tool's overrides back like any other.
    expect((await undoOverrideAs(t.leader.token, t.projectId, t.aTask.id)).status).toBe(200);
    expect(await taskRow(t.aTask.id)).toMatchObject({ status: "HALF", grade: "HALF" });
  });
});

describe("交了就不换手 (§15 #1): the submitter keeps the task and gets the grade", () => {
  /** A submission on a task someone else started (so the package isn't started; not reachable in the app). */
  async function submittedNotStarted(taskId: string, ownerId: string, starterId: string) {
    await testDb.task.update({ where: { id: taskId }, data: { ownerId, startedAt: new Date(), startedById: starterId, status: "DOING" } });
    await addAttempt(taskId, { no: 1, status: "PENDING", submittedById: ownerId, links: 1 });
    await recompute(taskId);
  }

  it("switching packages: the task stays with the submitter, who is graded and credited", async () => {
    const t = await activeWith(3);
    const [lin, wang] = t.members as [Person, Person];
    await pickAs(t.leader.token, t.projectId, 1);
    expect((await pickAs(lin.token, t.projectId, 2)).status).toBe(200);
    const view = await viewAs(t.leader.token, t.projectId);
    const linId = memberId(view, lin.user.id);
    const [reviewing, other] = [taskOf(view, 0, 2), taskOf(view, 1, 2)];
    await submittedNotStarted(reviewing.id, linId, memberId(view, t.leader.user.id));

    expect((await pickAs(lin.token, t.projectId, 3)).status).toBe(200);
    expect((await pickAs(wang.token, t.projectId, 2)).status).toBe(200);
    const wangId = memberId(view, wang.user.id);
    expect(await taskRow(reviewing.id)).toMatchObject({ ownerId: linId, packageId: null, status: "REVIEWING" });
    expect(await taskRow(other.id)).toMatchObject({ ownerId: wangId });

    expect((await gradeAs(t.leader.token, t.projectId, reviewing.id, "PASS")).status).toBe(200);
    expect(await taskRow(reviewing.id)).toMatchObject({ ownerId: linId, status: "DONE", grade: "PASS" });
    expect((await notes(lin.user.id, "GRADED")).map((n) => n.payload)).toMatchObject([{ taskId: reviewing.id, grade: "PASS", counting: true }]);
    expect(await notes(wang.user.id, "GRADED")).toHaveLength(0);
    const row = await taskView(lin.token, t.projectId, reviewing.id);
    expect(row).toMatchObject({ ownerMemberId: linId, earnedPoints: row.points });
    const mine = await call<MyTasksView>("/api/tasks/mine", { token: lin.token });
    expect(mine.data.done.map((r) => r.id)).toEqual([reviewing.id]);
  });

  it("a swap: each side keeps its submission; a FAIL stays the submitter's and can then be moved", async () => {
    const t = await withPackages(3);
    const [lin, wang] = t.members as [Person, Person];
    const linId = memberId(t.view, lin.user.id);
    const wangId = memberId(t.view, wang.user.id);
    const leaderId = memberId(t.view, t.leader.user.id);
    const linReviewing = taskOf(t.view, 0, 2);
    const wangReviewing = taskOf(t.view, 0, 3);
    await submittedNotStarted(linReviewing.id, linId, leaderId);
    await submittedNotStarted(wangReviewing.id, wangId, leaderId);
    const pkg2 = t.view.packages.find((p) => p.index === 2)!.id;
    const pkg3 = t.view.packages.find((p) => p.index === 3)!.id;

    expect((await call(`/api/projects/${t.projectId}/swaps`, { method: "POST", token: lin.token, body: { packageId: pkg3 } })).status).toBe(200);
    const swap = await testDb.swapRequest.findFirstOrThrow({ where: { projectId: t.projectId, status: "PENDING" } });
    expect((await call(`/api/swaps/${swap.id}/accept`, { method: "POST", token: wang.token })).status).toBe(200);
    expect(await taskRow(linReviewing.id)).toMatchObject({ ownerId: linId, packageId: null });
    expect(await taskRow(wangReviewing.id)).toMatchObject({ ownerId: wangId, packageId: null });

    expect((await gradeAs(t.leader.token, t.projectId, wangReviewing.id, "PASS")).status).toBe(200);
    expect((await gradeAs(t.leader.token, t.projectId, linReviewing.id, "FAIL", "没有数据")).status).toBe(200);
    expect(await taskRow(wangReviewing.id)).toMatchObject({ ownerId: wangId, status: "DONE" });
    expect(await notes(wang.user.id, "GRADED")).toHaveLength(1);
    // An active submitter's FAIL isn't released: it stays theirs, outside any package.
    expect(await taskRow(linReviewing.id)).toMatchObject({ ownerId: linId, packageId: null, status: "FAIL", grade: "FAIL" });
    expect((await notes(lin.user.id, "GRADED")).map((n) => n.payload)).toMatchObject([{ grade: "FAIL", earned: 0 }]);

    // Graded, so the normal rules apply: an unfinished task can move (no 「from」 package).
    const moved = await moveAs(t.leader.token, t.projectId, linReviewing.id, pkg2);
    expect(moved.status).toBe(200);
    expect(await taskRow(linReviewing.id)).toMatchObject({ ownerId: wangId, packageId: pkg2, status: "FAIL" });
    const [movedIn] = await notes(wang.user.id, "TASK_MOVED_IN");
    expect(movedIn!.payload).toMatchObject({ fromPackageIndex: null, toPackageIndex: 2, hasEvidence: true });
  });

  it("a leaver's submission: a newcomer picking the free package doesn't get it; the grade credits the leaver", async () => {
    const t = await team();
    await handIn(t.a.token, t.projectId, t.aTask.id);
    expect((await call(`/api/projects/${t.projectId}/leave`, { method: "POST", token: t.a.token })).status).toBe(200);
    expect(await taskRow(t.aTask.id)).toMatchObject({ ownerId: t.ids.a, packageId: null, status: "REVIEWING" });

    const newcomer = await person(3);
    expect((await joinCode(newcomer.token, t.view.inviteCode!)).status).toBe(200);
    expect((await pickAs(newcomer.token, t.projectId, 2)).status).toBe(200);
    const newcomerId = memberId(await viewAs(newcomer.token, t.projectId), newcomer.user.id);
    expect(await taskRow(t.aTask2.id)).toMatchObject({ ownerId: newcomerId });
    expect(await taskRow(t.aTask.id)).toMatchObject({ ownerId: t.ids.a, packageId: null });
    expect((await viewAs(t.leader.token, t.projectId)).pendingReviews.map((r) => [r.taskId, r.ownerMemberId])).toEqual([[t.aTask.id, t.ids.a]]);

    expect((await gradeAs(t.leader.token, t.projectId, t.aTask.id, "PASS")).status).toBe(200);
    const task = await taskRow(t.aTask.id);
    expect(task).toMatchObject({ ownerId: t.ids.a, status: "DONE", grade: "PASS" });
    expect((await taskView(t.leader.token, t.projectId, t.aTask.id)).earnedPoints).toBe(task.points);
    // Nobody who left is told anything; the newcomer isn't either.
    expect(await notes(t.a.user.id, "GRADED")).toHaveLength(0);
    expect(await notes(newcomer.user.id, "GRADED")).toHaveLength(0);
  });
});
