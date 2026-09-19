// 我的任务 (M4 spec §2, §7): GET /api/tasks/mine.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { MyTasksView, ProjectView } from "../../shared/types";
import { addAttempt, gradedAttempt, recompute } from "./attempt-rows";
import { call, testDb } from "./helpers";
import { createDraft, DAY, freshDb, joinCode, person, pickAs, taskOf, withPackages, type ActiveTeam } from "./project-fixtures";

beforeEach(freshDb);
afterAll(() => testDb.$disconnect());

const HOUR = 60 * 60 * 1000;
const mine = (token: string) => call<MyTasksView>("/api/tasks/mine", { token });

/** An ACTIVE project led by `leader` with `n` equal tasks, confirmed for `teamSize` people. */
async function project(leaderToken: string, shortCode: string, teamSize: number, n: number) {
  const draft = await createDraft(leaderToken, { shortCode, teamSize });
  const tasks = Array.from({ length: n }, (_, i) => ({ title: `${shortCode} 任务 ${i + 1}`, kind: "DOC" as const, points: 100 }));
  await call(`/api/projects/${draft.basics.id}/tasks`, { method: "PUT", token: leaderToken, body: { tasks } });
  return (await call<ProjectView>(`/api/projects/${draft.basics.id}/confirm`, { method: "POST", token: leaderToken })).data;
}

describe("GET /api/tasks/mine", () => {
  it("requires sign-in", async () => {
    expect((await call("/api/tasks/mine")).status).toBe(401);
  });

  it("lists my open tasks by effective due and my finished ones newest first, with how they were graded", async () => {
    // 王子杰 holds 「任务包 3」 with 8 tasks.
    const tasks = Array.from({ length: 24 }, (_, i) => ({ title: `任务 ${i + 1}`, kind: "DOC" as const, points: 100 }));
    const t = await withPackages(3, { tasks });
    const wang = (t.members as ActiveTeam["leader"][])[1]!;
    const wangId = t.view.members.find((m) => m.userId === wang.user.id)!.id;
    const leaderId = t.view.members.find((m) => m.role === "LEADER")!.id;
    const w = Array.from({ length: 8 }, (_, i) => taskOf(t.view, i, 3));
    const now = Date.now();
    const due = (days: number) => new Date(now + days * DAY);
    const setTask = (i: number, data: Parameters<typeof testDb.task.update>[0]["data"]) => testDb.task.update({ where: { id: w[i]!.id }, data });

    await setTask(0, { dueAt: due(-2), status: "DOING", startedAt: new Date(now - 3 * DAY), startedById: wangId }); // overdue
    await setTask(1, { dueAt: due(-1), startedAt: new Date(now - 3 * DAY), startedById: wangId }); // waiting for review, late
    await addAttempt(w[1]!.id, { no: 1, status: "PENDING", late: true, links: 1 });
    await recompute(w[1]!.id);
    await setTask(2, { dueAt: due(-3) }); // 拿一半
    await gradedAttempt(w[2]!.id, 1, "HALF", { gradedById: leaderId });
    await setTask(3, { dueAt: null }); // TODO, due with the project
    await setTask(4, { dueAt: due(4) }); // FAIL
    await gradedAttempt(w[4]!.id, 1, "FAIL", { gradedById: leaderId });
    // Finished: self-graded (the leader's own flow shape), outside the app, and overridden up.
    const self = await gradedAttempt(w[5]!.id, 1, "PASS", { selfGraded: true, gradedAt: new Date(now - 5 * HOUR) });
    const outside = await gradedAttempt(w[6]!.id, 1, "EXCELLENT", { outsideApp: true, submittedById: null, gradedAt: new Date(now - HOUR) });
    const raised = await gradedAttempt(w[7]!.id, 1, "HALF", { gradedAt: new Date(now - 10 * HOUR) });
    const change = await testDb.gradeChange.create({
      data: { attemptId: raised.attempt.id, fromGrade: "HALF", toGrade: "PASS", reason: "补交了", byId: leaderId, createdAt: new Date(now - 3 * HOUR) },
    });
    await testDb.attempt.update({ where: { id: raised.attempt.id }, data: { grade: "PASS" } });
    await recompute(w[7]!.id);

    const res = await mine(wang.token);
    expect(res.status).toBe(200);
    const { open, done, withoutPackage } = res.data;
    expect(withoutPackage).toEqual([]);
    expect(open.map((r) => [r.id, r.status, r.overdue, r.late])).toEqual([
      [w[2]!.id, "HALF", false, false],
      [w[0]!.id, "DOING", true, false],
      [w[1]!.id, "REVIEWING", false, true],
      [w[4]!.id, "FAIL", false, false],
      [w[3]!.id, "TODO", false, false],
    ]);
    expect(open[0]).toEqual({
      id: w[2]!.id,
      projectId: t.projectId,
      projectTag: "CS302",
      projectColor: t.view.basics.color,
      title: w[2]!.title,
      kind: "DOC",
      points: w[2]!.points,
      status: "HALF",
      grade: "HALF",
      overdue: false,
      late: false,
      dueAt: due(-3).toISOString(),
      earnedPoints: Math.round(w[2]!.points / 2),
      finishedAt: expect.any(String),
      selfGraded: false,
      outsideApp: false,
      overridden: false,
    });
    expect(open.find((r) => r.id === w[4]!.id)).toMatchObject({ grade: "FAIL", earnedPoints: 0, finishedAt: null });
    // No due of its own: the project deadline.
    expect(open.find((r) => r.id === w[3]!.id)!.dueAt).toBe(t.view.basics.deadline);

    expect(done.map((r) => [r.id, r.grade, r.selfGraded, r.outsideApp, r.overridden, r.finishedAt])).toEqual([
      [w[6]!.id, "EXCELLENT", false, true, false, outside.attempt.gradedAt!.toISOString()],
      [w[7]!.id, "PASS", false, false, true, change.createdAt.toISOString()],
      [w[5]!.id, "PASS", true, false, false, self.attempt.gradedAt!.toISOString()],
    ]);
    for (const r of done) expect(r).toMatchObject({ status: "DONE", earnedPoints: r.points, overdue: false });

    // Only my tasks.
    const lin = (t.members as ActiveTeam["leader"][])[0]!;
    const linRows = (await mine(lin.token)).data;
    expect(linRows.open).toHaveLength(8);
    expect(linRows.open.every((r) => !w.some((x) => x.id === r.id))).toBe(true);
  });

  it("keeps the counting attempt's facts after a later, worse attempt (overridden = a live change on it)", async () => {
    const t = await withPackages(2);
    const lin = (t.members as ActiveTeam["leader"][])[0]!;
    const task = taskOf(t.view, 0, 2);
    const first = await gradedAttempt(task.id, 1, "HALF", { outsideApp: true });
    // An undone override doesn't count as overridden.
    await testDb.gradeChange.create({ data: { attemptId: first.attempt.id, fromGrade: "HALF", toGrade: "FAIL", reason: "x", undoneAt: new Date() } });
    await gradedAttempt(task.id, 2, "FAIL", { late: true });
    const row = (await mine(lin.token)).data.open.find((r) => r.id === task.id)!;
    expect(row).toMatchObject({ status: "HALF", grade: "HALF", outsideApp: true, overridden: false, late: true });
  });

  it("covers ACTIVE projects only, and names the ones where I still need a package", async () => {
    const t = await withPackages(2);
    const lin = (t.members as ActiveTeam["leader"][])[0]!;
    const zhang = await person(3);

    // Joined, nothing picked yet.
    const waiting = await project(zhang.token, "MKT201", 3, 3);
    await joinCode(lin.token, waiting.inviteCode!);
    // Picked, then the project ended.
    const ended = await project(zhang.token, "ENDED1", 2, 2);
    await joinCode(lin.token, ended.inviteCode!);
    await pickAs(lin.token, ended.basics.id, 2);
    await testDb.project.update({ where: { id: ended.basics.id }, data: { status: "ENDED" } });
    // Picked, then left.
    const left = await project(zhang.token, "LEFT1", 2, 2);
    await joinCode(lin.token, left.inviteCode!);
    await pickAs(lin.token, left.basics.id, 2);
    await testDb.member.updateMany({ where: { projectId: left.basics.id, userId: lin.user.id }, data: { leftAt: new Date() } });

    const res = (await mine(lin.token)).data;
    expect(res.withoutPackage).toEqual([{ projectId: waiting.basics.id, projectTag: "MKT201" }]);
    expect(new Set(res.open.map((r) => r.projectId))).toEqual(new Set([t.projectId]));
    expect(res.done).toEqual([]);
  });
});
