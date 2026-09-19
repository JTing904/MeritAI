// The leader adds a task to an ACTIVE project (spec §2): lightest package, typed points, total stays 1000.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { apportion } from "../../shared/planning";
import type { NotificationPayload, ProjectView, TaskInput } from "../../shared/types";
import { endOfLocalDay, localDate } from "../src/lib/plan/dates";
import { call, testDb } from "./helpers";
import { activeWith, DAY, devStatus, freshDb, KL, pickAs } from "./project-fixtures";

beforeEach(freshDb);
afterAll(() => testDb.$disconnect());

const packagesOf = (projectId: string) => testDb.package.findMany({ where: { projectId }, orderBy: { index: "asc" } });
const tasksOf = (projectId: string) => testDb.task.findMany({ where: { projectId }, orderBy: { number: "asc" } });
const notificationsOf = (userId: string, type?: NotificationPayload["type"]) =>
  testDb.notification.findMany({ where: { userId, ...(type ? { type } : {}) }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });

const add = (token: string, projectId: string, body: Partial<TaskInput> & Record<string, unknown>) =>
  call<ProjectView>(`/api/projects/${projectId}/tasks`, {
    method: "POST",
    token,
    body: { title: "补充访谈：学生消费者", kind: "RESEARCH", points: 40, ...body },
  });

const plan = (...points: number[]) => points.map((p, i) => ({ title: `任务 ${i + 1}`, kind: "DOC" as const, points: p }));

/** The package with the smallest total (lowest number on a tie). */
async function lightest(projectId: string) {
  const pkgs = await packagesOf(projectId);
  const tasks = await tasksOf(projectId);
  const total = (id: string) => tasks.filter((t) => t.packageId === id).reduce((s, t) => s + t.points, 0);
  return pkgs.reduce((best, p) => (total(p.id) < total(best.id) ? p : best));
}

describe("POST /api/projects/:id/tasks on an ACTIVE project", () => {
  it("puts the task in the lightest package with exactly the typed points; everything else rescales to 1000", async () => {
    const t = await activeWith(3, { tasks: plan(500, 300, 150, 50) });
    const [a, b] = t.members;
    await pickAs(t.leader.token, t.projectId, 1);
    await pickAs(a!.token, t.projectId, 2);
    await pickAs(b!.token, t.projectId, 3);
    const before = await tasksOf(t.projectId);
    // Finished work is rescaled too.
    await devStatus(t.leader.token, before[0]!.id, "DONE");
    const target = await lightest(t.projectId);
    const owner = await testDb.member.findUniqueOrThrow({ where: { id: target.ownerId! } });
    const version = (await testDb.project.findUniqueOrThrow({ where: { id: t.projectId } })).packagesVersion;

    const res = await add(t.leader.token, t.projectId, {});
    expect(res.status).toBe(201);
    expect(res.data.viewerRole).toBe("LEADER");

    const after = await tasksOf(t.projectId);
    expect(after).toHaveLength(5);
    const created = after.find((x) => !before.some((y) => y.id === x.id))!;
    expect(created).toMatchObject({
      title: "补充访谈：学生消费者",
      kind: "RESEARCH",
      points: 40,
      number: 5,
      order: Math.max(...before.map((x) => x.order)) + 1,
      packageId: target.id,
      ownerId: target.ownerId,
      status: "TODO",
      dueAt: null,
      leaderDueAt: null,
    });
    const expected = apportion(before.map((x) => x.points), 960);
    expect(before.map((x) => after.find((y) => y.id === x.id)!.points)).toEqual(expected);
    expect(expected).toEqual([480, 288, 144, 48]);
    expect(after.reduce((s, x) => s + x.points, 0)).toBe(1000);
    expect(after.find((x) => x.id === before[0]!.id)).toMatchObject({ status: "DONE", points: 480 });
    expect((await testDb.project.findUniqueOrThrow({ where: { id: t.projectId } })).packagesVersion).toBe(version + 1);

    const packagePoints = after.filter((x) => x.packageId === target.id).reduce((s, x) => s + x.points, 0);
    const told = await notificationsOf(owner.userId, "TASK_ADDED");
    expect(told).toHaveLength(1);
    expect(told[0]).toMatchObject({ audience: "ONLY_YOU" });
    expect(told[0]!.payload).toEqual({
      type: "TASK_ADDED",
      taskId: created.id,
      title: "补充访谈：学生消费者",
      packageIndex: target.index,
      packagePoints,
    });
    expect(await notificationsOf(t.leader.user.id)).toHaveLength(0);
    const events = await testDb.activityEvent.findMany({ where: { projectId: t.projectId, type: "TASK_ADDED" } });
    expect(events.map((e) => e.payload)).toEqual([
      { type: "TASK_ADDED", taskId: created.id, title: "补充访谈：学生消费者", packageIndex: target.index },
    ]);
  });

  it("rescales the finished work of people who left (no package) too", async () => {
    const t = await activeWith(2, { tasks: plan(400, 300, 300) });
    const tasks = await tasksOf(t.projectId);
    await testDb.task.update({ where: { id: tasks[0]!.id }, data: { packageId: null, status: "DONE", startedAt: new Date() } });

    expect((await add(t.leader.token, t.projectId, { points: 100 })).status).toBe(201);
    const after = await tasksOf(t.projectId);
    expect(after.map((x) => x.points)).toEqual([...apportion([400, 300, 300], 900), 100]);
    expect(after[0]!.packageId).toBeNull();
    expect(after[3]!.packageId).not.toBeNull();
  });

  it("goes to nobody in a free package, and tells nobody when the package is the leader's", async () => {
    const t = await activeWith(2, { tasks: plan(600, 400) });
    const free = await lightest(t.projectId);
    expect((await add(t.leader.token, t.projectId, { title: "甲" })).status).toBe(201);
    const first = (await tasksOf(t.projectId)).find((x) => x.title === "甲")!;
    expect(first).toMatchObject({ packageId: free.id, ownerId: null });
    expect(await testDb.notification.count({ where: { type: "TASK_ADDED" } })).toBe(0);

    await pickAs(t.leader.token, t.projectId, free.index);
    expect((await add(t.leader.token, t.projectId, { title: "乙" })).status).toBe(201);
    const leaderRow = await testDb.member.findFirstOrThrow({ where: { projectId: t.projectId, userId: t.leader.user.id } });
    const second = (await tasksOf(t.projectId)).find((x) => x.title === "乙")!;
    expect(second).toMatchObject({ packageId: free.id, ownerId: leaderRow.id });
    expect(await testDb.notification.count({ where: { type: "TASK_ADDED" } })).toBe(0);
    expect((await tasksOf(t.projectId)).reduce((s, x) => s + x.points, 0)).toBe(1000);
  });

  it("keeps the leader's due date as leaderDueAt and refuses one after the deadline", async () => {
    const t = await activeWith(2);
    const date = localDate(new Date(Date.now() + 10 * DAY), KL);
    expect((await add(t.leader.token, t.projectId, { dueAt: date })).status).toBe(201);
    const created = (await tasksOf(t.projectId)).at(-1)!;
    expect(created.dueAt).toEqual(endOfLocalDay(date, KL));
    expect(created.leaderDueAt).toEqual(created.dueAt);
    expect(created.suggestedDueAt).toBeNull();

    const late = await add(t.leader.token, t.projectId, { dueAt: localDate(new Date(Date.now() + 90 * DAY), KL) });
    expect([late.status, late.error!.code]).toEqual([400, "DUE_AFTER_DEADLINE"]);
    expect(await tasksOf(t.projectId)).toHaveLength(5);
  });

  it("is for the leader only, with 0.1–99.9 分, known features, and a running project", async () => {
    const t = await activeWith(2);
    const [a] = t.members;
    expect((await add(a!.token, t.projectId, {})).status).toBe(403);
    for (const points of [0, 1000, 12.5]) {
      const res = await add(t.leader.token, t.projectId, { points });
      expect([res.status, res.error!.code]).toEqual([400, "VALIDATION"]);
    }
    const unknown = await add(t.leader.token, t.projectId, { featureId: "nope" });
    expect([unknown.status, unknown.error!.code]).toEqual([400, "VALIDATION"]);
    expect(await tasksOf(t.projectId)).toHaveLength(4);

    await testDb.project.update({ where: { id: t.projectId }, data: { status: "ENDED" } });
    const ended = await add(t.leader.token, t.projectId, {});
    expect([ended.status, ended.error!.code]).toEqual([409, "PROJECT_ENDED"]);
  });
});
