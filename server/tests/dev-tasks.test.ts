// The development status tool through the real services (M4 spec §12 srv-evidence): DONE / HALF grade as
// the leader, TODO wipes the attempts and their files, DOING only starts. The M3 cases stay in packages.test.ts.
import { readdir } from "node:fs/promises";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { ActivityType } from "../src/generated/prisma/client";
import { testDb } from "./helpers";
import {
  devStatus,
  fakeFile,
  freshDb,
  linkEvidence,
  submitAs,
  taskOf,
  uploadDir,
  uploadEvidence,
  viewAs,
  withPackages,
} from "./project-fixtures";

beforeEach(freshDb);
afterAll(() => testDb.$disconnect());

const memberRow = (projectId: string, userId: string) =>
  testDb.member.findFirstOrThrow({ where: { projectId, userId }, include: { user: true } });
const taskRow = (id: string) => testDb.task.findUniqueOrThrow({ where: { id } });
const version = async (projectId: string) => (await testDb.project.findUniqueOrThrow({ where: { id: projectId } })).packagesVersion;
const eventsOf = (projectId: string, type: ActivityType) =>
  testDb.activityEvent.findMany({ where: { projectId, type }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
const attemptsOf = (taskId: string) => testDb.attempt.findMany({ where: { taskId }, orderBy: { no: "asc" } });

async function fileCount(): Promise<number> {
  try {
    return (await readdir(uploadDir(), { recursive: true, withFileTypes: true })).filter((e) => e.isFile()).length;
  } catch {
    return 0;
  }
}

async function team() {
  const t = await withPackages(3);
  const [a, b] = t.members;
  return {
    ...t,
    a: a!,
    b: b!,
    rows: {
      leader: await memberRow(t.projectId, t.leader.user.id),
      a: await memberRow(t.projectId, a!.user.id),
      b: await memberRow(t.projectId, b!.user.id),
    },
    aTask: taskOf(t.view, 0, 2),
  };
}

const earned = async (token: string, projectId: string, taskId: string) =>
  (await viewAs(token, projectId)).tasks.find((x) => x.id === taskId)!.earnedPoints;

describe("POST /api/dev/tasks/:taskId/status through the services", () => {
  it("DONE / HALF on a task without attempts: 组长代为完成 as the leader, whoever calls it", async () => {
    const t = await team();
    const before = await version(t.projectId);
    expect((await devStatus(t.b.token, t.aTask.id, "HALF")).status).toBe(200);
    const [attempt] = await attemptsOf(t.aTask.id);
    expect(attempt).toMatchObject({ status: "GRADED", grade: "HALF", outsideApp: true, gradedById: t.rows.leader.id, gradeNote: "开发测试" });
    const task = await taskRow(t.aTask.id);
    expect(task).toMatchObject({ status: "HALF", grade: "HALF", startedById: t.rows.a.id });
    expect(await earned(t.b.token, t.projectId, t.aTask.id)).toBe(Math.round(task.points / 2));
    expect((await eventsOf(t.projectId, "GRADED"))[0]).toMatchObject({ actorId: t.rows.leader.id, payload: { outsideApp: true } });
    expect(await testDb.notification.count({ where: { userId: t.a.user.id, type: "GRADED_OUTSIDE" } })).toBe(1);
    expect(await version(t.projectId)).toBe(before + 1);
  });

  it("DONE → HALF → DONE overrides the counting attempt and back; the same status again only bumps", async () => {
    const t = await team();
    expect((await devStatus(t.a.token, t.aTask.id, "DONE")).status).toBe(200);
    expect(await taskRow(t.aTask.id)).toMatchObject({ status: "DONE", grade: "PASS" });
    expect((await devStatus(t.a.token, t.aTask.id, "HALF")).status).toBe(200);
    expect(await taskRow(t.aTask.id)).toMatchObject({ status: "HALF", grade: "HALF" });
    const before = await version(t.projectId);
    expect((await devStatus(t.a.token, t.aTask.id, "DONE")).status).toBe(200);
    const task = await taskRow(t.aTask.id);
    expect(task).toMatchObject({ status: "DONE", grade: "PASS" });
    expect(await earned(t.a.token, t.projectId, t.aTask.id)).toBe(task.points);
    expect(await version(t.projectId)).toBe(before + 1);

    const attempts = await attemptsOf(t.aTask.id);
    expect(attempts).toHaveLength(1);
    const changes = await testDb.gradeChange.findMany({ where: { attemptId: attempts[0]!.id }, orderBy: { createdAt: "asc" } });
    expect(changes.map((c) => [c.fromGrade, c.toGrade, c.reason, c.byId])).toEqual([
      ["PASS", "HALF", "开发测试", t.rows.leader.id],
      ["HALF", "PASS", "开发测试", t.rows.leader.id],
    ]);
    expect((await eventsOf(t.projectId, "OVERRIDDEN")).map((e) => e.actorId)).toEqual([t.rows.leader.id, t.rows.leader.id]);

    expect((await devStatus(t.a.token, t.aTask.id, "DONE")).status).toBe(200);
    expect(await version(t.projectId)).toBe(before + 2);
    expect(await testDb.gradeChange.count()).toBe(2);
  });

  it("grades a waiting submission as the leader", async () => {
    const t = await team();
    expect((await linkEvidence(t.a.token, t.projectId, t.aTask.id, "https://example.com")).status).toBe(201);
    expect((await submitAs(t.a.token, t.projectId, t.aTask.id)).status).toBe(200);
    expect((await devStatus(t.a.token, t.aTask.id, "DONE")).status).toBe(200);
    const [attempt] = await attemptsOf(t.aTask.id);
    expect(attempt).toMatchObject({ status: "GRADED", grade: "PASS", outsideApp: false, submittedById: t.rows.a.id, gradedById: t.rows.leader.id });
    expect(await taskRow(t.aTask.id)).toMatchObject({ status: "DONE", grade: "PASS" });
    expect(await testDb.notification.count({ where: { userId: t.a.user.id, type: "GRADED" } })).toBe(1);
  });

  it("TODO removes the attempts, their evidence and files; DOING is refused while attempts exist", async () => {
    const t = await team();
    expect((await uploadEvidence(t.a.token, t.projectId, t.aTask.id, fakeFile("a.pdf", "pdf"))).status).toBe(201);
    expect((await submitAs(t.a.token, t.projectId, t.aTask.id)).status).toBe(200);
    expect((await devStatus(t.a.token, t.aTask.id, "HALF")).status).toBe(200);
    expect(await fileCount()).toBe(1);

    const doing = await devStatus(t.a.token, t.aTask.id, "DOING");
    expect([doing.status, doing.error?.code]).toEqual([409, "CONFLICT"]);

    const before = await version(t.projectId);
    expect((await devStatus(t.a.token, t.aTask.id, "TODO")).status).toBe(200);
    expect(await taskRow(t.aTask.id)).toMatchObject({ status: "TODO", grade: null, finishedAt: null, startedAt: null, startedById: null });
    expect(await testDb.attempt.count({ where: { taskId: t.aTask.id } })).toBe(0);
    expect(await testDb.evidence.count({ where: { taskId: t.aTask.id } })).toBe(0);
    expect(await fileCount()).toBe(0);
    expect(await version(t.projectId)).toBe(before + 1);

    // Now DOING starts it as its owner, even when someone else calls it.
    expect((await devStatus(t.b.token, t.aTask.id, "DOING")).status).toBe(200);
    expect(await taskRow(t.aTask.id)).toMatchObject({ status: "DOING", startedById: t.rows.a.id });
    expect(await version(t.projectId)).toBe(before + 2);
  });
});
