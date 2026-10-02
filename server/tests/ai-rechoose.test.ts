// M6 spec §4–§5: 改选 after the plan is confirmed (locked / unlocked options, totals stay 1000, where the new
// tasks go, notifications), and 怎么做 (the HOWTO job for an added task, edits clearing 「✨ AI 写的」).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { DraftView, ProjectView, RechoosePreview, TaskDetail } from "../../shared/types";
import { call, testDb } from "./helpers";
import { drain, mockAi, resetMock, setKey } from "./ai-fixtures";
import { createDraft, detailAs, freshDb, joinCode, person, pickAs, startAs, viewAs } from "./project-fixtures";

beforeEach(async () => {
  await freshDb();
  resetMock();
});
afterAll(() => testDb.$disconnect());

const BRIEF = ["1. 市场调研报告", "2. 从 5 个二手平台中任选 2 个做案例分析", "3. 用户访谈记录"].join("\n");

/** An ACTIVE 3-person project planned by the AI with picks B + D; everyone picked a package in order. */
async function aiProject() {
  const leader = await person(0);
  await setKey(leader.token);
  const draft = await createDraft(leader.token, { teamSize: 3 });
  const id = draft.basics.id;
  await call(`/api/projects/${id}/brief`, { method: "POST", token: leader.token, body: { text: BRIEF } });
  await drain();
  const analysed = (await call<DraftView>(`/api/projects/${id}/draft`, { token: leader.token })).data;
  const q = analysed.questions[0]!;
  await call(`/api/projects/${id}/choices`, { method: "PUT", token: leader.token, body: { answers: { [q.id]: ["B", "D"] } } });
  const confirmed = await call<ProjectView>(`/api/projects/${id}/confirm`, { method: "POST", token: leader.token });
  expect(confirmed.status).toBe(200);
  const members = [await person(1), await person(2)];
  for (const m of members) expect((await joinCode(m.token, confirmed.data.inviteCode!)).status).toBe(200);
  for (const [i, p] of [leader, ...members].entries()) expect((await pickAs(p.token, id, i + 1)).status).toBe(200);
  const view = await viewAs(leader.token, id);
  return { id, leader, members, view, question: view.choices[0]! };
}

const optionTasks = (view: ProjectView, key: string) => {
  const o = view.choices[0]!.options.find((x) => x.key === key)!;
  return view.tasks.filter((t) => o.taskIds.includes(t.id));
};
const preview = (token: string, id: string, qid: string, picks: string[]) =>
  call<RechoosePreview>(`/api/projects/${id}/choices/${qid}/preview`, { method: "POST", token, body: { picks } });
const rechoose = (token: string, id: string, qid: string, picks: string[], version?: number) =>
  call<ProjectView>(`/api/projects/${id}/choices/${qid}`, { method: "POST", token, body: { picks, version } });

describe("改选 (POST /api/projects/:id/choices/:questionId)", () => {
  it("previews, then swaps an unstarted option's tasks in place; the total stays 1000; the group hears it", async () => {
    const p = await aiProject();
    const dTasks = optionTasks(p.view, "D");
    expect(dTasks.map((t) => t.title)).toEqual(["Mudah.my 案例分析", "Mudah.my 流程截图"]);
    const where = dTasks.map((t) => [t.packageId, t.ownerMemberId]);

    const pre = await preview(p.leader.token, p.id, p.question.id, ["B", "A"]);
    expect(pre.status).toBe(200);
    expect(pre.data).toMatchObject({ from: ["B", "D"], to: ["B", "A"], unchanged: false });
    expect(pre.data.removeTasks.map((t) => t.title)).toEqual(["Mudah.my 案例分析", "Mudah.my 流程截图"]);
    expect(pre.data.addTasks.map((t) => [t.title, t.ownerMemberId])).toEqual([
      ["Carousell 案例分析", where[0]![1]],
      ["Carousell 流程截图", where[1]![1]],
    ]);
    // A preview writes nothing.
    expect(optionTasks(await viewAs(p.leader.token, p.id), "D")).toHaveLength(2);

    const res = await rechoose(p.leader.token, p.id, p.question.id, ["B", "A"], pre.data.version);
    expect(res.status).toBe(200);
    const view = res.data;
    expect(view.tasks.reduce((s, t) => s + t.points, 0)).toBe(1000);
    expect(view.tasks.some((t) => t.title.startsWith("Mudah.my"))).toBe(false);
    const aTasks = optionTasks(view, "A");
    expect(aTasks.map((t) => [t.packageId, t.ownerMemberId])).toEqual(where);
    expect(view.choices[0]!.options.filter((o) => o.picked).map((o) => o.key)).toEqual(["A", "B"]);
    // The new tasks come with their 怎么做 and checklist.
    const rows = await testDb.task.findMany({ where: { id: { in: aTasks.map((t) => t.id) } }, include: { checklist: true } });
    expect(rows.every((r) => r.howtoByAi && r.checklist.length === 2)).toBe(true);

    for (const m of p.members) {
      const [n] = await testDb.notification.findMany({ where: { userId: m.user.id, type: "CHOICE_CHANGED" } });
      expect(n!.payload).toMatchObject({ prompt: p.question.prompt, from: ["Mudah.my"], to: ["Carousell"], addedTitles: ["Carousell 案例分析", "Carousell 流程截图"] });
      expect(n!.audience).toBe("GROUP");
    }
    expect(await testDb.notification.count({ where: { userId: p.leader.user.id, type: "CHOICE_CHANGED" } })).toBe(0);
    expect(await testDb.activityEvent.count({ where: { projectId: p.id, type: "CHOICE_CHANGED" } })).toBe(1);
    // A stale preview is refused.
    const stale = await rechoose(p.leader.token, p.id, p.question.id, ["C", "B"], pre.data.version);
    expect([stale.status, stale.error?.code]).toEqual([409, "STALE_PREVIEW"]);
  });

  it("can't drop an option someone started (CHOICE_LOCKED), and shows who", async () => {
    const p = await aiProject();
    const bTask = optionTasks(p.view, "B")[0]!;
    const owner = [p.leader, ...p.members].find((x) => p.view.members.find((m) => m.id === bTask.ownerMemberId)?.userId === x.user.id)!;
    expect((await startAs(owner.token, p.id, bTask.id)).status).toBe(200);
    const view = await viewAs(p.leader.token, p.id);
    expect(view.choices[0]!.options.find((o) => o.key === "B")!.lockedBy).toEqual({ memberId: bTask.ownerMemberId, name: owner.user.name });

    const res = await rechoose(p.leader.token, p.id, p.question.id, ["A", "D"]);
    expect([res.status, res.error?.code]).toEqual([409, "CHOICE_LOCKED"]);
    expect((res.error as { details?: unknown }).details).toEqual({ optionKeys: ["B"] });
    expect((await preview(p.leader.token, p.id, p.question.id, ["A", "D"])).error?.code).toBe("CHOICE_LOCKED");
    // Keeping B and swapping D is fine.
    expect((await rechoose(p.leader.token, p.id, p.question.id, ["B", "E"])).status).toBe(200);
  });

  it("checks the count and who asks", async () => {
    const p = await aiProject();
    const wrong = await rechoose(p.leader.token, p.id, p.question.id, ["A"]);
    expect([wrong.status, wrong.error?.code]).toEqual([400, "CHOICE_COUNT"]);
    const member = await rechoose(p.members[0]!.token, p.id, p.question.id, ["A", "B"]);
    expect(member.status).toBe(403);
    const same = await rechoose(p.leader.token, p.id, p.question.id, ["D", "B"]);
    expect(same.status).toBe(200);
    expect(await testDb.notification.count({ where: { type: "CHOICE_CHANGED" } })).toBe(0);
  });
});

describe("怎么做", () => {
  it("the AI writes steps and a checklist for a task the leader adds", async () => {
    const p = await aiProject();
    const add = await call<ProjectView>(`/api/projects/${p.id}/tasks`, { method: "POST", token: p.leader.token, body: { title: "海报设计", kind: "DESIGN", points: 50 } });
    expect(add.status).toBe(201);
    const task = add.data.tasks.find((t) => t.title === "海报设计")!;
    await drain();
    expect(mockAi.calls().at(-1)).toMatchObject({ purpose: "howto", tier: "light" });
    const detail = (await detailAs(p.leader.token, p.id, task.id)).data;
    expect(detail.howto.length).toBeGreaterThanOrEqual(2);
    expect([detail.howtoByAi, detail.checklistByAi, detail.checklist.length]).toEqual([true, true, 2]);
  });

  it("an edit by the leader or the owner clears 「✨ AI 写的」; others can't", async () => {
    const p = await aiProject();
    const task = p.view.tasks.find((t) => t.title === "市场调研报告")!;
    const ownerLogin = [p.leader, ...p.members].find((x) => p.view.members.find((m) => m.id === task.ownerMemberId)?.userId === x.user.id)!;
    const stranger = [p.leader, ...p.members].find((x) => x !== ownerLogin && x !== p.leader)!;
    const put = (token: string, steps: string[]) => call<TaskDetail>(`/api/projects/${p.id}/tasks/${task.id}/howto`, { method: "PUT", token, body: { steps } });

    expect((await put(stranger.token, ["x"])).status).toBe(403);
    const tooMany = await put(ownerLogin.token, Array.from({ length: 9 }, (_, i) => `step ${i}`));
    expect([tooMany.status, tooMany.error?.code]).toEqual([400, "VALIDATION"]);
    const edited = await put(ownerLogin.token, [" 先访谈 ", "", "再写报告"]);
    expect(edited.status).toBe(200);
    expect([edited.data.howto, edited.data.howtoByAi, edited.data.checklistByAi]).toEqual([["先访谈", "再写报告"], false, true]);

    const list = await call<TaskDetail>(`/api/projects/${p.id}/tasks/${task.id}/checklist`, { method: "PUT", token: p.leader.token, body: { items: [{ text: "至少 5 人" }] } });
    expect(list.data.checklistByAi).toBe(false);
  });
});
