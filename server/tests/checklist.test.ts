// 做到这些才算完成 (M4 spec §2): replace-all edits by the leader or the owner, ticks by the owner only.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { ChecklistInput, TaskDetail } from "../../shared/types";
import { call, testDb } from "./helpers";
import { freshDb, person, taskOf, withPackages, type ActiveTeam } from "./project-fixtures";

beforeEach(freshDb);
afterAll(() => testDb.$disconnect());

const put = (token: string, projectId: string, taskId: string, items: ChecklistInput["items"]) =>
  call<TaskDetail>(`/api/projects/${projectId}/tasks/${taskId}/checklist`, { method: "PUT", token, body: { items } });
const tick = (token: string, projectId: string, taskId: string, itemId: string, done: boolean) =>
  call<TaskDetail>(`/api/projects/${projectId}/tasks/${taskId}/checklist/${itemId}/tick`, { method: "POST", token, body: { done } });
const rows = (taskId: string) => testDb.checklistItem.findMany({ where: { taskId }, orderBy: { order: "asc" } });

/** 王子杰 owns the task (「任务包 3」); 林晓雯 is another member. */
async function setup() {
  const t = await withPackages(3);
  const [lin, wang] = t.members as [ActiveTeam["leader"], ActiveTeam["leader"]];
  return { t, lin, wang, task: taskOf(t.view, 0, 3) };
}

describe("PUT /api/projects/:id/tasks/:taskId/checklist", () => {
  it("lets the owner write the list, in order, unticked", async () => {
    const { t, wang, task } = await setup();
    const res = await put(wang.token, t.projectId, task.id, [{ text: " 至少 50 份问卷 " }, { text: "附数据分析" }]);
    expect(res.status).toBe(200);
    expect(res.data.checklist.map((c) => [c.text, c.done, c.order])).toEqual([
      ["至少 50 份问卷", false, 0],
      ["附数据分析", false, 1],
    ]);
    expect((await rows(task.id)).map((r) => r.text)).toEqual(["至少 50 份问卷", "附数据分析"]);
  });

  it("keeps ticks by id, reorders, adds new items unticked and deletes the ones left out (the leader edits)", async () => {
    const { t, wang, task } = await setup();
    const first = await put(wang.token, t.projectId, task.id, [{ text: "A" }, { text: "B" }, { text: "C" }]);
    const [a, b, c] = first.data.checklist;
    expect((await tick(wang.token, t.projectId, task.id, a!.id, true)).status).toBe(200);
    await tick(wang.token, t.projectId, task.id, c!.id, true);

    const res = await put(t.leader.token, t.projectId, task.id, [{ id: c!.id, text: "C 改过" }, { text: "D" }, { id: a!.id, text: "A" }]);
    expect(res.status).toBe(200);
    expect(res.data.checklist.map((x) => [x.id, x.text, x.done, x.order])).toEqual([
      [c!.id, "C 改过", true, 0],
      [expect.any(String), "D", false, 1],
      [a!.id, "A", true, 2],
    ]);
    expect(await testDb.checklistItem.findUnique({ where: { id: b!.id } })).toBeNull();

    // An empty list clears it.
    const cleared = await put(t.leader.token, t.projectId, task.id, []);
    expect(cleared.data.checklist).toEqual([]);
    expect(await rows(task.id)).toEqual([]);
  });

  it("refuses more than 20 items, an unknown or repeated id, and empty text (400 VALIDATION)", async () => {
    const { t, wang, task } = await setup();
    const many = Array.from({ length: 21 }, (_, i) => ({ text: `第 ${i + 1} 条` }));
    expect([(await put(wang.token, t.projectId, task.id, many)).error?.code]).toEqual(["VALIDATION"]);
    const twenty = await put(wang.token, t.projectId, task.id, many.slice(0, 20));
    expect(twenty.data.checklist).toHaveLength(20);

    const other = taskOf(t.view, 1, 3);
    const foreign = (await put(wang.token, t.projectId, other.id, [{ text: "别的" }])).data.checklist[0]!;
    const unknown = await put(wang.token, t.projectId, task.id, [{ id: foreign.id, text: "偷来的" }]);
    expect([unknown.status, unknown.error?.code]).toEqual([400, "VALIDATION"]);
    const id = twenty.data.checklist[0]!.id;
    const twice = await put(wang.token, t.projectId, task.id, [{ id, text: "一" }, { id, text: "二" }]);
    expect([twice.status, twice.error?.code]).toEqual([400, "VALIDATION"]);
    const blank = await put(wang.token, t.projectId, task.id, [{ text: "   " }]);
    expect([blank.status, blank.error?.code]).toEqual([400, "VALIDATION"]);
    expect(await rows(task.id)).toHaveLength(20);
  });

  it("refuses a member who is neither the leader nor the owner (403) and someone outside (404)", async () => {
    const { t, lin, task } = await setup();
    const res = await put(lin.token, t.projectId, task.id, [{ text: "A" }]);
    expect([res.status, res.error?.code]).toEqual([403, "FORBIDDEN"]);
    const outsider = await person(5);
    expect((await put(outsider.token, t.projectId, task.id, [{ text: "A" }])).status).toBe(404);
    expect((await put(lin.token, t.projectId, "nope", [{ text: "A" }])).status).toBe(404);
    expect(await rows(task.id)).toEqual([]);
  });

  it("works at any status, and not once the project ended", async () => {
    const { t, wang, task } = await setup();
    await testDb.task.update({ where: { id: task.id }, data: { status: "DONE", grade: "PASS", startedAt: new Date() } });
    expect((await put(wang.token, t.projectId, task.id, [{ text: "A" }])).status).toBe(200);
    await testDb.project.update({ where: { id: t.projectId }, data: { status: "ENDED" } });
    expect((await put(wang.token, t.projectId, task.id, [{ text: "B" }])).status).toBe(409);
  });
});

describe("POST /api/projects/:id/tasks/:taskId/checklist/:itemId/tick", () => {
  it("lets the owner tick and untick; everyone sees it", async () => {
    const { t, lin, wang, task } = await setup();
    const [item] = (await put(t.leader.token, t.projectId, task.id, [{ text: "A" }])).data.checklist;
    const res = await tick(wang.token, t.projectId, task.id, item!.id, true);
    expect(res.data.checklist[0]).toMatchObject({ id: item!.id, done: true });
    const seen = await call<TaskDetail>(`/api/projects/${t.projectId}/tasks/${task.id}`, { token: lin.token });
    expect(seen.data.checklist[0]!.done).toBe(true);
    expect((await tick(wang.token, t.projectId, task.id, item!.id, false)).data.checklist[0]!.done).toBe(false);
  });

  it("is the owner's job: the leader and other members get 403; an unknown item 404", async () => {
    const { t, lin, wang, task } = await setup();
    const [item] = (await put(wang.token, t.projectId, task.id, [{ text: "A" }])).data.checklist;
    expect((await tick(t.leader.token, t.projectId, task.id, item!.id, true)).status).toBe(403);
    expect((await tick(lin.token, t.projectId, task.id, item!.id, true)).status).toBe(403);
    expect((await tick(wang.token, t.projectId, task.id, "nope", true)).status).toBe(404);
    // An item of another task isn't this task's.
    const other = taskOf(t.view, 1, 3);
    const [foreign] = (await put(wang.token, t.projectId, other.id, [{ text: "B" }])).data.checklist;
    expect((await tick(wang.token, t.projectId, task.id, foreign!.id, true)).status).toBe(404);
    expect((await rows(task.id))[0]!.done).toBe(false);
  });

  it("lets the leader tick their own task, and nobody tick a task without an owner", async () => {
    const { t, task } = await setup();
    const own = taskOf(t.view, 0, 1);
    const [item] = (await put(t.leader.token, t.projectId, own.id, [{ text: "A" }])).data.checklist;
    expect((await tick(t.leader.token, t.projectId, own.id, item!.id, true)).data.checklist[0]!.done).toBe(true);

    const [other] = (await put(t.leader.token, t.projectId, task.id, [{ text: "A" }])).data.checklist;
    await testDb.task.update({ where: { id: task.id }, data: { ownerId: null } });
    expect((await tick(t.leader.token, t.projectId, task.id, other!.id, true)).status).toBe(403);
  });

  it("refuses a body without a boolean (400)", async () => {
    const { t, wang, task } = await setup();
    const [item] = (await put(wang.token, t.projectId, task.id, [{ text: "A" }])).data.checklist;
    const res = await call(`/api/projects/${t.projectId}/tasks/${task.id}/checklist/${item!.id}/tick`, {
      method: "POST",
      token: wang.token,
      body: { done: "yes" },
    });
    expect([res.status, res.error?.code]).toEqual([400, "VALIDATION"]);
  });
});
