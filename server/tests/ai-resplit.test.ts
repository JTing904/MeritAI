// 让 AI 重新拆 (docs/plan/m6-resplit-spec.md): the RESPLIT job, the proposal (kept / removed / added, the
// 选择题 matched or new), applying it (started work untouched, total 1000, copies in package n, notifications),
// discarding, and who may ask.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { placeResplit } from "../../shared/planning";
import type { AiResplitState, BriefView, DraftView, ProjectView } from "../../shared/types";
import { call, testDb } from "./helpers";
import { drain, mockAi, resetMock, setKey } from "./ai-fixtures";
import { createDraft, fakeFile, freshDb, joinCode, person, pickAs, startAs, upload, viewAs } from "./project-fixtures";

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
  const people = [leader, ...members];
  /** The login of whoever owns this task. */
  const ownerOf = (taskId: string) => {
    const t = view.tasks.find((x) => x.id === taskId)!;
    const userId = view.members.find((m) => m.id === t.ownerMemberId)!.userId;
    return people.find((p) => p.user.id === userId)!;
  };
  mockAi.reset();
  return { id, leader, members, view, ownerOf };
}

const path = (id: string) => `/api/projects/${id}/ai-resplit`;
const state = (token: string, id: string) => call<AiResplitState>(path(id), { token });
const start = (token: string, id: string, body?: unknown) => call<AiResplitState>(path(id), { method: "POST", token, body });
const apply = (token: string, id: string, body: unknown) => call<ProjectView>(`${path(id)}/apply`, { method: "POST", token, body });
const total = (view: ProjectView) => view.tasks.reduce((s, t) => s + t.points, 0);

/** Starts a run on the saved brief, lets the job answer, and returns the proposal. */
async function proposed(p: Awaited<ReturnType<typeof aiProject>>, body?: unknown) {
  const res = await start(p.leader.token, p.id, body);
  expect(res.status).toBe(200);
  expect(res.data.status).toBe("running");
  expect(await drain()).toBe(1);
  const done = await state(p.leader.token, p.id);
  expect(done.data.status).toBe("done");
  return done.data;
}

describe("让 AI 重新拆: the run and the proposal", () => {
  it("keeps the started task, replaces the rest, matches the 选择题 and drops kept titles", async () => {
    const p = await aiProject();
    const research = p.view.tasks.find((t) => t.title === "市场调研报告")!;
    expect((await startAs(p.ownerOf(research.id).token, p.id, research.id)).status).toBe(200);

    const before = await state(p.leader.token, p.id);
    expect(before.data).toMatchObject({ status: "none", keptCount: 1, replaceCount: p.view.tasks.length - 1, proposal: null });
    expect(before.data.savedBrief).toMatchObject({ fileName: null, fromResplit: false });

    const res = await start(p.leader.token, p.id);
    expect(res.data).toMatchObject({ status: "running", provider: "GEMINI", keptCount: 1, brief: { source: "SAVED", lines: 3 } });
    // Members still see the old tasks while it runs.
    expect((await viewAs(p.members[0]!.token, p.id)).tasks.map((t) => t.id).sort()).toEqual(p.view.tasks.map((t) => t.id).sort());

    expect(await drain()).toBe(1);
    // The kept task is listed for the model in its own fenced block.
    const brief = mockAi.calls().find((c) => c.purpose === "brief")!;
    expect(brief.text).toContain("KEPT TASKS");
    expect(brief.text).toContain("市场调研报告 = ");

    const s = (await state(p.leader.token, p.id)).data;
    expect(s.status).toBe("done");
    const pr = s.proposal!;
    expect(pr.version).toBe((await viewAs(p.leader.token, p.id)).packagesVersion);
    expect(pr.kept.map((t) => t.taskId)).toEqual([research.id]);
    expect(pr.removed.map((t) => t.taskId).sort()).toEqual(p.view.tasks.filter((t) => t.id !== research.id).map((t) => t.id).sort());
    // The kept title isn't made again; the picked options' tasks come from the AI's matching options.
    const titles = pr.added.map((t) => t.title);
    expect(titles).not.toContain("市场调研报告");
    expect(titles).toEqual(expect.arrayContaining(["用户访谈记录", "闲鱼 案例分析", "闲鱼 流程截图", "Mudah.my 案例分析", "Mudah.my 流程截图"]));
    expect(titles.some((t) => t.startsWith("Carousell"))).toBe(false);
    expect(pr.newQuestions).toEqual([]);
    expect(pr.keptQuestions).toEqual([{ questionId: p.view.choices[0]!.id, prompt: p.view.choices[0]!.prompt, pickedKeys: ["B", "D"], pickedLabels: ["闲鱼", "Mudah.my"] }]);
    // The new tasks share what the kept one leaves: nothing kept moves without edits.
    expect(pr.kept[0]!.pointsAfter).toBe(research.points);
    expect(pr.added.reduce((n, t) => n + t.points, 0)).toBe(1000 - research.points);
    expect(pr.packages.reduce((n, x) => n + x.pointsAfter, 0)).toBe(1000);
    expect(pr.added.every((t) => t.packageIndex !== null && t.dueAt && t.aiWritten)).toBe(true);
    // A proposal writes nothing.
    expect((await viewAs(p.leader.token, p.id)).tasks).toHaveLength(p.view.tasks.length);
  });

  it("applies: started work untouched, the rest replaced, total 1000, the group hears it", async () => {
    const p = await aiProject();
    const research = p.view.tasks.find((t) => t.title === "市场调研报告")!;
    const owner = p.ownerOf(research.id);
    expect((await startAs(owner.token, p.id, research.id)).status).toBe(200);
    // Something else in the unpicked option's saved tasks: the answer refreshes it.
    const optionA = await testDb.choiceOption.findFirstOrThrow({ where: { question: { projectId: p.id }, key: "A" } });
    await testDb.choiceOption.update({ where: { id: optionA.id }, data: { tasksJson: [{ title: "旧任务", kind: "DOC", points: 10 }] } });
    const startedRow = await testDb.task.findUniqueOrThrow({ where: { id: research.id } });

    const pr = (await proposed(p)).proposal!;
    const res = await apply(p.leader.token, p.id, { version: pr.version });
    expect(res.status).toBe(200);
    const view = res.data;
    expect(total(view)).toBe(1000);
    const kept = await testDb.task.findUniqueOrThrow({ where: { id: research.id } });
    expect([kept.title, kept.status, kept.ownerId, kept.packageId, kept.points, kept.startedAt?.getTime()]).toEqual([
      startedRow.title,
      "DOING",
      startedRow.ownerId,
      startedRow.packageId,
      startedRow.points,
      startedRow.startedAt?.getTime(),
    ]);
    const ids = new Set(view.tasks.map((t) => t.id));
    expect(pr.removed.every((t) => !ids.has(t.taskId))).toBe(true);
    expect(view.tasks.map((t) => t.title).sort()).toEqual(["市场调研报告", ...pr.added.map((t) => t.title)].sort());
    // Each new task sits where the proposal said, with that package's owner.
    for (const a of pr.added) {
      const t = view.tasks.find((x) => x.title === a.title)!;
      const pkg = view.packages.find((x) => x.index === a.packageIndex)!;
      expect([t.packageId, t.ownerMemberId, t.points]).toEqual([pkg.id, pkg.ownerMemberId, a.points]);
    }
    // The 选择题 keeps B + D; their tasks belong to the options; A's saved tasks are the AI's again.
    const q = view.choices[0]!;
    expect(q.options.filter((o) => o.picked).map((o) => o.key)).toEqual(["B", "D"]);
    const dTitles = view.tasks.filter((t) => q.options.find((o) => o.key === "D")!.taskIds.includes(t.id)).map((t) => t.title);
    expect(dTitles.sort()).toEqual(["Mudah.my 案例分析", "Mudah.my 流程截图"]);
    const refreshed = await testDb.choiceOption.findUniqueOrThrow({ where: { id: optionA.id } });
    expect((refreshed.tasksJson as { title: string }[]).map((t) => t.title)).toEqual(["Carousell 案例分析", "Carousell 流程截图"]);

    // Everyone but the leader hears it; 跟我有关 for the ones whose package changed.
    for (const m of p.members) {
      const [n] = await testDb.notification.findMany({ where: { userId: m.user.id, type: "TASKS_RESPLIT" } });
      expect(n!.audience).toBe("GROUP");
      expect(n!.payload).toMatchObject({ leader: { name: p.leader.user.name }, kept: 1, removed: pr.removed.length, added: pr.added.length });
      const mine = (n!.payload as { mine: { packageIndex: number; points: number } | null }).mine;
      expect(n!.mine).toBe(mine !== null);
      if (mine) expect(mine.points).toBe(view.tasks.filter((t) => t.packageId === view.packages.find((x) => x.index === mine.packageIndex)!.id).reduce((s, t) => s + t.points, 0));
    }
    expect(await testDb.notification.count({ where: { userId: p.leader.user.id, type: "TASKS_RESPLIT" } })).toBe(0);
    expect(await testDb.notification.count({ where: { userId: p.leader.user.id, type: "AI_RESPLIT_READY", audience: "ONLY_LEADER" } })).toBe(1);
    expect(await testDb.notification.count({ where: { type: "AI_RESPLIT_READY" } })).toBe(1);
    const [event] = await testDb.activityEvent.findMany({ where: { projectId: p.id, type: "TASKS_RESPLIT" } });
    expect(event!.payload).toMatchObject({ kept: 1, removed: pr.removed.length, added: pr.added.length });
    // Applied: the result is gone, and the same version can't be applied again.
    expect((await state(p.leader.token, p.id)).data.status).toBe("none");
    expect((await apply(p.leader.token, p.id, { version: view.packagesVersion })).status).toBe(404);
  });

  it("a new brief with a new 选择题: it must be answered; edits, deletes and additions apply; the brief becomes the project's", async () => {
    const p = await aiProject();
    const text = `${BRIEF}\n4. 从 Waterfall、Agile、RAD 中选一种开发流程`;
    const s = await proposed(p, { text });
    expect(s.brief).toMatchObject({ source: "NEW", fileName: null, lines: 4 });
    const pr = s.proposal!;
    expect(pr.newQuestions).toHaveLength(1);
    const nq = pr.newQuestions[0]!;
    expect(nq).toMatchObject({ id: "n0", type: "METHOD", pickCount: 1 });
    expect(nq.options.map((o) => [o.key, o.recommended, o.tasks.length])).toEqual([
      ["A", false, 2],
      ["B", true, 2],
      ["C", false, 2],
    ]);
    // The placement assumes the recommended option.
    expect(nq.options[1]!.tasks.every((t) => t.packageIndex !== null)).toBe(true);
    expect(nq.options[0]!.tasks.every((t) => t.packageIndex === null)).toBe(true);

    const missing = await apply(p.leader.token, p.id, { version: pr.version });
    expect([missing.status, missing.error?.code]).toEqual([409, "CHOICES_REQUIRED"]);
    const wrong = await apply(p.leader.token, p.id, { version: pr.version, answers: { n0: ["A", "B"] } });
    expect(wrong.error?.code).toBe("CHOICES_REQUIRED");

    const [first, second] = pr.added;
    const res = await apply(p.leader.token, p.id, {
      version: pr.version,
      answers: { n0: ["C"] },
      edits: { [first!.key]: { title: "市场调研报告（改过）", kind: "DOC", points: 120 } },
      deleted: [second!.key],
      added: [{ title: "海报设计", kind: "DESIGN", points: 30 }],
    });
    expect(res.status).toBe(200);
    const view = res.data;
    expect(total(view)).toBe(1000);
    // The review page works the points out the same way (app/src/features/ai/resplitPlan.ts): same order, same placement.
    const list = [
      ...pr.added.filter((t) => t.key !== second!.key).map((t) => (t.key === first!.key ? { ...t, title: "市场调研报告（改过）", points: 120 } : t)),
      ...nq.options.find((o) => o.key === "C")!.tasks,
      { title: "海报设计", points: 30, feature: null, packageIndex: null },
    ];
    // The proposal's tasks stay where it put them; a points edit was made, so the kept ones rescale too.
    const expected = placeResplit({
      packages: pr.packages.map((x) => ({ index: x.index, ownerMemberId: x.ownerMemberId })),
      kept: pr.kept.map((t) => ({ points: t.points, packageIndex: t.packageIndex })),
      removed: pr.removed.map((t) => ({ points: t.points, packageIndex: t.packageIndex })),
      added: list.map((t) => ({ points: t.points, feature: t.feature, packageIndex: t.packageIndex })),
      keepKept: false,
    });
    list.forEach((t, i) => {
      const got = view.tasks.find((x) => x.title === t.title)!;
      const pkg = view.packages.find((x) => x.index === expected.added[i]!.packageIndex)!;
      expect([got.points, got.packageId]).toEqual([expected.added[i]!.points, pkg.id]);
    });
    const titles = view.tasks.map((t) => t.title);
    expect(titles).toContain("市场调研报告（改过）");
    expect(titles).not.toContain(second!.title);
    expect(titles).toContain("海报设计");
    expect(titles).toEqual(expect.arrayContaining(["RAD 快速原型 计划书", "RAD 快速原型 过程记录"]));
    expect(titles.some((t) => t.startsWith("Agile"))).toBe(false);
    expect(view.tasks.find((t) => t.title === "市场调研报告（改过）")!.kind).toBe("DOC");
    // The new question joins the project, answered.
    expect(view.choices.map((q) => q.type)).toEqual(["PICK_N", "METHOD"]);
    const method = view.choices[1]!;
    expect(method.options.filter((o) => o.picked).map((o) => o.key)).toEqual(["C"]);
    expect(method.options.find((o) => o.key === "C")!.taskIds).toHaveLength(2);
    // The leader's own task gets 怎么做 from the AI.
    const poster = view.tasks.find((t) => t.title === "海报设计")!;
    expect(await testDb.aiJob.count({ where: { kind: "HOWTO", taskId: poster.id } })).toBe(1);
    // The new brief is the project's now.
    const brief = await call<BriefView>(`/api/projects/${p.id}/brief`, { token: p.leader.token });
    expect(brief.data.text).toBe(text);
    expect((await state(p.leader.token, p.id)).data.savedBrief).toMatchObject({ fileName: null, fromResplit: true });
  });

  it("puts per-member copies into the package with their number", async () => {
    const p = await aiProject();
    const pr = (await proposed(p, { text: `${BRIEF}\n4. 每位同学签一份抄袭声明` })).proposal!;
    const copies = pr.added.filter((t) => /^组员 \d$/.test(t.feature ?? ""));
    // The declaration per member and the signing form, 3 copies each (组员 1–3).
    expect(copies.map((c) => c.feature).sort()).toEqual(["组员 1", "组员 1", "组员 2", "组员 2", "组员 3", "组员 3"]);
    for (const c of copies) expect(c.packageIndex).toBe(Number(c.feature!.slice(3)));
    const view = (await apply(p.leader.token, p.id, { version: pr.version })).data;
    for (const f of view.features.filter((x) => /^组员 \d$/.test(x.name))) {
      const pkg = view.packages.find((x) => x.index === Number(f.name.slice(3)))!;
      const tasks = view.tasks.filter((t) => t.featureId === f.id);
      expect(tasks.length).toBeGreaterThan(0);
      expect(tasks.every((t) => t.packageId === pkg.id && t.ownerMemberId === pkg.ownerMemberId)).toBe(true);
    }
  });

  it("a file the rules can't read goes to the AI as the file", async () => {
    const p = await aiProject();
    const form = await upload(path(p.id), p.leader.token, fakeFile("brief.png", "png"));
    expect(form.status).toBe(200);
    expect((form.data as AiResplitState).brief).toMatchObject({ source: "NEW", fileName: "brief.png", lines: null });
    await drain();
    expect(mockAi.calls().find((c) => c.purpose === "brief")!.text).toContain("[file brief.png image/png]");
    expect((await state(p.leader.token, p.id)).data.status).toBe("done");
    const bad = await upload(path(p.id), p.leader.token, fakeFile("virus.exe", "exe"));
    expect([bad.status, bad.error?.code]).toEqual([400, "BRIEF_UNREADABLE"]);
  });
});

describe("让 AI 重新拆: staying safe", () => {
  it("a task started between the review and the apply: STALE_PREVIEW, then it shows as kept", async () => {
    const p = await aiProject();
    const pr = (await proposed(p)).proposal!;
    const interview = p.view.tasks.find((t) => t.title === "用户访谈记录")!;
    expect(pr.removed.map((t) => t.taskId)).toContain(interview.id);
    expect((await startAs(p.ownerOf(interview.id).token, p.id, interview.id)).status).toBe(200);

    const stale = await apply(p.leader.token, p.id, { version: pr.version });
    expect([stale.status, stale.error?.code]).toEqual([409, "STALE_PREVIEW"]);
    const again = (await state(p.leader.token, p.id)).data.proposal!;
    expect(again.kept.map((t) => t.taskId)).toEqual([interview.id]);
    expect(again.added.map((t) => t.title)).not.toContain("用户访谈记录");
    const res = await apply(p.leader.token, p.id, { version: again.version });
    expect(res.status).toBe(200);
    expect(res.data.tasks.find((t) => t.id === interview.id)?.status).toBe("DOING");
    expect(total(res.data)).toBe(1000);
  });

  it("不要了: discarding changes nothing; a new start replaces the old result", async () => {
    const p = await aiProject();
    const pr = (await proposed(p)).proposal!;
    const gone = await call<AiResplitState>(path(p.id), { method: "DELETE", token: p.leader.token });
    expect(gone.data.status).toBe("none");
    expect((await apply(p.leader.token, p.id, { version: pr.version })).status).toBe(404);
    expect((await viewAs(p.leader.token, p.id)).tasks.map((t) => t.id).sort()).toEqual(p.view.tasks.map((t) => t.id).sort());

    // 不拆了 while it runs: the job is cancelled and never answers.
    await start(p.leader.token, p.id);
    await call(path(p.id), { method: "DELETE", token: p.leader.token });
    expect(await drain()).toBe(0);
    expect((await state(p.leader.token, p.id)).data.status).toBe("none");

    // Two starts: only the second one runs.
    await start(p.leader.token, p.id);
    await start(p.leader.token, p.id);
    expect(await drain()).toBe(1);
    expect(await testDb.aiJob.count({ where: { projectId: p.id, kind: "RESPLIT", status: "FAILED", error: "CANCELLED" } })).toBe(2);
  });

  it("an AI failure changes nothing and tells the leader", async () => {
    const p = await aiProject();
    mockAi.failNext("INVALID", { purpose: "brief" });
    await start(p.leader.token, p.id);
    await drain();
    const s = (await state(p.leader.token, p.id)).data;
    expect(s).toMatchObject({ status: "failed", error: "INVALID", proposal: null });
    const [n] = await testDb.notification.findMany({ where: { type: "AI_RESPLIT_FAILED" } });
    expect([n!.userId, n!.audience]).toEqual([p.leader.user.id, "ONLY_LEADER"]);
    expect(n!.payload).toMatchObject({ reason: "INVALID", provider: "GEMINI" });
    expect((await testDb.user.findUniqueOrThrow({ where: { id: p.leader.user.id } })).aiKeyStatus).toBe("INVALID");
    expect((await viewAs(p.leader.token, p.id)).tasks.map((t) => t.id).sort()).toEqual(p.view.tasks.map((t) => t.id).sort());
    // The key is known bad now: 再试一次 waits for a new key.
    expect((await start(p.leader.token, p.id, { again: true })).error?.code).toBe("NO_AI_KEY");
  });

  it("refuses an ended project, a leader without a key, and members", async () => {
    const p = await aiProject();
    const member = await start(p.members[0]!.token, p.id);
    expect(member.status).toBe(403);
    expect((await state(p.members[0]!.token, p.id)).status).toBe(403);
    expect((await apply(p.members[0]!.token, p.id, { version: 0 })).status).toBe(403);

    await call("/api/me/ai-key", { method: "DELETE", token: p.leader.token });
    const noKey = await start(p.leader.token, p.id);
    expect([noKey.status, noKey.error?.code]).toEqual([409, "NO_AI_KEY"]);

    await setKey(p.leader.token);
    expect((await call(`/api/projects/${p.id}/end`, { method: "POST", token: p.leader.token })).status).toBe(200);
    const ended = await start(p.leader.token, p.id);
    expect([ended.status, ended.error?.code]).toEqual([409, "PROJECT_ENDED"]);
    expect(await testDb.aiJob.count({ where: { projectId: p.id, kind: "RESPLIT" } })).toBe(0);
  });
});

describe("placeResplit", () => {
  it("rescales to 1000, sends copies to their package and balances the rest around the kept points", () => {
    const placed = placeResplit({
      packages: [
        { index: 1, ownerMemberId: "m1" },
        { index: 2, ownerMemberId: "m2" },
        { index: 3, ownerMemberId: null },
      ],
      kept: [{ points: 300, packageIndex: 1 }],
      removed: [
        { points: 350, packageIndex: 2 },
        { points: 350, packageIndex: 3 },
      ],
      added: [
        { points: 100, feature: "组员 1" },
        { points: 100, feature: "组员 2" },
        { points: 100, feature: "组员 3" },
        { points: 200, feature: null },
        { points: 200, feature: null },
      ],
    });
    expect(placed.keptPoints).toEqual([300]);
    expect(placed.added.slice(0, 3).map((a) => [a.packageIndex, a.ownerMemberId])).toEqual([
      [1, "m1"],
      [2, "m2"],
      [3, null],
    ]);
    // Package 1 already has the kept 300: the two free tasks go to 2 and 3.
    expect(placed.added.slice(3).map((a) => a.packageIndex).sort()).toEqual([2, 3]);
    expect(placed.packages).toEqual([
      { index: 1, pointsBefore: 300, pointsAfter: 400 },
      { index: 2, pointsBefore: 350, pointsAfter: 300 },
      { index: 3, pointsBefore: 350, pointsAfter: 300 },
    ]);
    expect([...placed.keptPoints, ...placed.added.map((a) => a.points)].reduce((s, n) => s + n, 0)).toBe(1000);
  });

  it("keeps the kept points when new tasks are deleted or added, and rescales them only after a points edit", () => {
    const base = {
      packages: [{ index: 1, ownerMemberId: "m1" }],
      kept: [{ points: 300, packageIndex: 1 }],
      removed: [{ points: 700, packageIndex: 1 }],
    };
    // One of the three new 233-tenth tasks deleted: the other two share the 700 left.
    const deleted = placeResplit({ ...base, added: [{ points: 233, feature: null }, { points: 233, feature: null }] });
    expect(deleted.keptPoints).toEqual([300]);
    expect(deleted.added.map((a) => a.points)).toEqual([350, 350]);
    // A task the proposal placed stays in its package even when that leaves the packages uneven.
    const pinned = placeResplit({
      packages: [{ index: 1, ownerMemberId: "m1" }, { index: 2, ownerMemberId: "m2" }],
      kept: [],
      removed: [{ points: 1000, packageIndex: 1 }],
      added: [{ points: 500, feature: null, packageIndex: 1 }, { points: 500, feature: null, packageIndex: 1 }, { points: 100, feature: null }],
    });
    expect(pinned.added.map((a) => a.packageIndex)).toEqual([1, 1, 2]);
    // The leader changed points: everything in proportion, the kept task too.
    const edited = placeResplit({ ...base, added: [{ points: 466, feature: null }, { points: 466, feature: null }], keepKept: false });
    expect(edited.keptPoints[0]).not.toBe(300);
    expect([...edited.keptPoints, ...edited.added.map((a) => a.points)].reduce((s, n) => s + n, 0)).toBe(1000);
  });
});
