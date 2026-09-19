// PATCH /api/projects/:id/tasks/:taskId on an ACTIVE project (M4 spec §2 updateActiveTask).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { apportion } from "../../shared/planning";
import type { ProjectView, TaskPatchInput } from "../../shared/types";
import { addAttempt, gradedAttempt } from "./attempt-rows";
import { call, testDb } from "./helpers";
import { DAY, freshDb, person, startAs, taskOf, withPackages, type ActiveTeam } from "./project-fixtures";

beforeEach(freshDb);
afterAll(() => testDb.$disconnect());

const patch = (token: string, projectId: string, taskId: string, body: TaskPatchInput & Record<string, unknown>) =>
  call<ProjectView>(`/api/projects/${projectId}/tasks/${taskId}`, { method: "PATCH", token, body });
const tasksOf = (projectId: string) => testDb.task.findMany({ where: { projectId }, orderBy: [{ order: "asc" }, { number: "asc" }] });
const version = async (projectId: string) => (await testDb.project.findUniqueOrThrow({ where: { id: projectId } })).packagesVersion;

/** 王子杰 owns the task (「任务包 3」); 林晓雯 is another member. */
async function setup() {
  const t = await withPackages(3);
  const [lin, wang] = t.members as [ActiveTeam["leader"], ActiveTeam["leader"]];
  return { t, lin, wang, task: taskOf(t.view, 0, 3) };
}

describe("PATCH /api/projects/:id/tasks/:taskId (ACTIVE)", () => {
  it("lets the owner change the description only", async () => {
    const { t, wang, task } = await setup();
    const res = await patch(wang.token, t.projectId, task.id, { description: "  至少 50 份问卷  " });
    expect(res.status).toBe(200);
    expect(res.data.viewerRole).toBe("MEMBER");
    expect(res.data.tasks.find((x) => x.id === task.id)!.description).toBe("至少 50 份问卷");

    for (const body of [{ title: "改名" }, { points: 50 }, { dueAt: null }, { kind: "CODE" as const }, { description: "x", title: "y" }]) {
      const refused = await patch(wang.token, t.projectId, task.id, body);
      expect([JSON.stringify(body), refused.status, refused.error?.code]).toEqual([JSON.stringify(body), 403, "FORBIDDEN"]);
    }
    expect((await testDb.task.findUniqueOrThrow({ where: { id: task.id } })).title).toBe(task.title);
    const cleared = await patch(wang.token, t.projectId, task.id, { description: null });
    expect(cleared.data.tasks.find((x) => x.id === task.id)!.description).toBeNull();
  });

  it("refuses another member (403) and someone outside the project (404)", async () => {
    const { t, lin, task } = await setup();
    const res = await patch(lin.token, t.projectId, task.id, { description: "我来改" });
    expect([res.status, res.error?.code]).toEqual([403, "FORBIDDEN"]);
    const outsider = await person(5);
    expect((await patch(outsider.token, t.projectId, task.id, { description: "x" })).status).toBe(404);
    expect((await patch(t.leader.token, t.projectId, "nope", { title: "x" })).status).toBe(404);
  });

  it("lets the leader rename, re-describe and re-date; the date becomes the leader's and null clears both", async () => {
    const { t, task } = await setup();
    const before = await version(t.projectId);
    const res = await patch(t.leader.token, t.projectId, task.id, { title: "市场调研报告", description: "10 页", dueAt: "2026-10-01" });
    expect(res.status).toBe(200);
    const row = await testDb.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(row).toMatchObject({ title: "市场调研报告", description: "10 页" });
    // A date means 23:59:59.999 that day in the project's zone (KL, UTC+8).
    expect(row.dueAt!.toISOString()).toBe("2026-10-01T15:59:59.999Z");
    expect(row.leaderDueAt).toEqual(row.dueAt);
    expect(await version(t.projectId)).toBe(before + 1);
    expect(res.data.tasks.find((x) => x.id === task.id)!.dueAt).toBe("2026-10-01T15:59:59.999Z");

    await patch(t.leader.token, t.projectId, task.id, { dueAt: null });
    expect(await testDb.task.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({ dueAt: null, leaderDueAt: null });

    // A rename alone doesn't touch the packages version.
    const v = await version(t.projectId);
    await patch(t.leader.token, t.projectId, task.id, { title: "再改名" });
    expect(await version(t.projectId)).toBe(v);

    const late = await patch(t.leader.token, t.projectId, task.id, { dueAt: new Date(Date.parse(t.view.basics.deadline) + DAY).toISOString() });
    expect([late.status, late.error?.code]).toEqual([400, "DUE_AFTER_DEADLINE"]);
  });

  it("changes the points of an unlocked task and rescales every other task so the total stays 1000", async () => {
    const { t, wang, task } = await setup();
    const before = await tasksOf(t.projectId);
    const v = await version(t.projectId);
    const res = await patch(t.leader.token, t.projectId, task.id, { points: 250 });
    expect(res.status).toBe(200);
    const after = await tasksOf(t.projectId);
    const others = before.filter((x) => x.id !== task.id);
    expect(others.map((x) => after.find((y) => y.id === x.id)!.points)).toEqual(apportion(others.map((x) => x.points), 750));
    expect(after.find((x) => x.id === task.id)!.points).toBe(250);
    expect(after.reduce((s, x) => s + x.points, 0)).toBe(1000);
    expect(await version(t.projectId)).toBe(v + 1);

    // Started → locked.
    await startAs(wang.token, t.projectId, task.id);
    const locked = await patch(t.leader.token, t.projectId, task.id, { points: 300 });
    expect([locked.status, locked.error?.code]).toEqual([409, "TASK_LOCKED"]);
    // The same points isn't a change.
    expect((await patch(t.leader.token, t.projectId, task.id, { points: 250, title: "同分" })).status).toBe(200);
    // Out of range (1–999 tenths).
    expect((await patch(t.leader.token, t.projectId, taskOf(t.view, 1, 3).id, { points: 1000 })).error?.code).toBe("VALIDATION");
    expect((await patch(t.leader.token, t.projectId, taskOf(t.view, 1, 3).id, { points: 0 })).error?.code).toBe("VALIDATION");
  });

  it("locks the kind once an attempt was graded or holds evidence; an empty draft attempt is deleted instead", async () => {
    const { t, task } = await setup();
    const empty = await addAttempt(task.id, { no: 1, status: "DRAFT" });
    const ok = await patch(t.leader.token, t.projectId, task.id, { kind: "MEETING" });
    expect(ok.status).toBe(200);
    expect(await testDb.attempt.findUnique({ where: { id: empty.id } })).toBeNull();
    expect((await testDb.task.findUniqueOrThrow({ where: { id: task.id } })).kind).toBe("MEETING");

    const withEvidence = taskOf(t.view, 1, 3);
    await addAttempt(withEvidence.id, { no: 1, status: "DRAFT", links: 1 });
    const refused = await patch(t.leader.token, t.projectId, withEvidence.id, { kind: "MEETING" });
    expect([refused.status, refused.error?.code]).toEqual([409, "TASK_LOCKED"]);

    const graded = taskOf(t.view, 0, 2);
    await gradedAttempt(graded.id, 1, "SELF", { links: 0 });
    expect((await patch(t.leader.token, t.projectId, graded.id, { kind: "CODE" })).error?.code).toBe("TASK_LOCKED");
    // Keeping the kind it has is fine.
    expect((await patch(t.leader.token, t.projectId, graded.id, { kind: graded.kind, title: "会议" })).status).toBe(200);
    expect(await testDb.attempt.count({ where: { taskId: { in: [withEvidence.id, graded.id] } } })).toBe(2);
  });

  it("refuses unknown features and writes on an ended project", async () => {
    const { t, task } = await setup();
    expect((await patch(t.leader.token, t.projectId, task.id, { featureId: "nope" })).error?.code).toBe("VALIDATION");
    await testDb.project.update({ where: { id: t.projectId }, data: { status: "ENDED" } });
    expect((await patch(t.leader.token, t.projectId, task.id, { title: "x" })).status).toBe(409);
  });
});
