import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { BriefResult, DraftView, ProjectView, TaskInput } from "../../shared/types";
import { endOfLocalDay, localDate, spreadDueDates, toInstant } from "../src/lib/plan/dates";
import { MAX_BRIEF_BYTES } from "../src/lib/plan/extract";
import { call, testApp, testDb } from "./helpers";
import {
  activeWith,
  basics,
  createActive,
  createDraft,
  DAY,
  freshDb,
  inDays,
  KL,
  login,
  RUBRIC_TASKS,
  upload,
  viewAs,
} from "./project-fixtures";

beforeEach(freshDb);
afterAll(() => testDb.$disconnect());

const CODE_CHARS = "[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]";
/** "YYYY-MM-DD" of a date n days from now, in Kuala Lumpur. */
const klDate = (days: number) => localDate(new Date(Date.now() + days * DAY), KL);

describe("time zone helpers", () => {
  it("puts a date-only due date at 23:59:59.999 in the project's time zone", () => {
    expect(endOfLocalDay("2026-10-01", KL).toISOString()).toBe("2026-10-01T15:59:59.999Z");
    expect(endOfLocalDay("2026-10-01", "UTC").toISOString()).toBe("2026-10-01T23:59:59.999Z");
  });

  it("handles daylight saving changes", () => {
    // New York: DST starts 2026-03-08 and ends 2026-11-01.
    expect(endOfLocalDay("2026-03-08", "America/New_York").toISOString()).toBe("2026-03-09T03:59:59.999Z");
    expect(endOfLocalDay("2026-11-01", "America/New_York").toISOString()).toBe("2026-11-02T04:59:59.999Z");
    expect(endOfLocalDay("2026-10-04", "Australia/Sydney").toISOString()).toBe("2026-10-04T12:59:59.999Z");
  });

  it("reads the local calendar date of an instant", () => {
    expect(localDate(new Date("2026-10-01T16:30:00Z"), KL)).toBe("2026-10-02");
    expect(localDate(new Date("2026-10-01T16:30:00Z"), "America/New_York")).toBe("2026-10-01");
    expect(toInstant("2026-10-01T08:00:00+08:00", KL).toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  it("spreads due dates evenly up to the deadline", () => {
    const start = new Date("2026-09-20T02:00:00Z");
    const deadline = new Date("2026-10-30T15:59:59.999Z");
    const dues = spreadDueDates(4, start, deadline, KL).map((d) => d.toISOString());
    expect(dues).toEqual([
      "2026-09-30T15:59:59.999Z",
      "2026-10-10T15:59:59.999Z",
      "2026-10-20T15:59:59.999Z",
      "2026-10-30T15:59:59.999Z",
    ]);
  });

  it("never spreads past a deadline earlier than 23:59", () => {
    const start = new Date("2026-09-20T02:00:00Z");
    const deadline = new Date("2026-09-20T09:00:00Z"); // 17:00 the same day in KL
    const dues = spreadDueDates(3, start, deadline, KL);
    for (const d of dues) expect(d.getTime()).toBeLessThanOrEqual(deadline.getTime());
    expect(dues.at(-1)).toEqual(deadline);
    expect(spreadDueDates(0, start, deadline, KL)).toEqual([]);
  });
});

describe("POST /api/projects (wizard step 1)", () => {
  it("creates a draft led by the creator", async () => {
    const { token, user } = await login(0);
    const res = await call<DraftView>("/api/projects", { method: "POST", token, body: basics() });
    expect(res.status).toBe(201);
    expect(res.data.basics).toMatchObject({
      name: "校园二手市场 App",
      shortCode: "CS302",
      courseName: "软件工程",
      groupLabel: "第 7 组",
      timezone: KL,
      teamSize: 5,
      leaderManages: false,
      repoFullName: null,
      color: "lemon",
      status: "DRAFT",
      draftStep: 2,
      locale: "zh",
      planSource: null,
      packageCount: 5,
    });
    expect(res.data).toMatchObject({ tasks: [], features: [], milestones: [], totalPoints: 0, briefFileName: null, hasBriefText: false });

    const project = await testDb.project.findUniqueOrThrow({ where: { id: res.data.basics.id }, include: { members: true } });
    expect(project.inviteCode).toBeNull();
    expect(project.createdById).toBe(user.id);
    expect(project.members).toEqual([expect.objectContaining({ userId: user.id, role: "LEADER", color: "lemon" })]);
  });

  it("uses the leader's language as the project language", async () => {
    const { token } = await login(0);
    await call("/api/me", { method: "PATCH", token, body: { locale: "en" } });
    expect((await createDraft(token)).basics.locale).toBe("en");
  });

  it("takes a date-only deadline as 23:59 in the project's time zone", async () => {
    const { token } = await login(0);
    const date = klDate(30);
    const draft = await createDraft(token, { deadline: date });
    expect(draft.basics.deadline).toBe(endOfLocalDay(date, KL).toISOString());
    expect(draft.basics.deadline.slice(11)).toBe("15:59:59.999Z");
  });

  it("stores blank optional fields as null", async () => {
    const { token } = await login(0);
    const draft = await createDraft(token, { shortCode: "  ", courseName: "", groupLabel: null, repoFullName: "" });
    expect(draft.basics).toMatchObject({ shortCode: null, courseName: null, groupLabel: null, repoFullName: null });
  });

  it("stores the time zone's IANA spelling", async () => {
    const { token } = await login(0);
    const draft = await createDraft(token, { timezone: "asia/kuala_lumpur" });
    expect(draft.basics.timezone).toBe(KL);
  });

  it("validates the basics", async () => {
    const { token } = await login(0);
    const bad = async (over: object) =>
      (await call("/api/projects", { method: "POST", token, body: { ...basics(), ...over } })).error?.code;
    expect(await bad({ teamSize: 1 })).toBe("VALIDATION");
    expect(await bad({ teamSize: 9 })).toBe("VALIDATION");
    expect(await bad({ teamSize: 4.5 })).toBe("VALIDATION");
    expect(await bad({ name: "   " })).toBe("VALIDATION");
    expect(await bad({ timezone: "Mars/Olympus" })).toBe("VALIDATION");
    expect(await bad({ timezone: "+08:00" })).toBe("VALIDATION");
    expect(await bad({ deadline: "next friday" })).toBe("VALIDATION");
    expect(await bad({ repoFullName: "not a repo" })).toBe("VALIDATION");
    expect(await bad({ deadline: inDays(-1) })).toBe("DEADLINE_IN_PAST");
    expect(await testDb.project.count()).toBe(0);
  });

  it("requires sign-in", async () => {
    expect((await call("/api/projects", { method: "POST", body: basics() })).status).toBe(401);
  });

  it("picks a project colour the creator's other running projects don't use", async () => {
    const { token } = await login(0);
    const colors = [];
    for (let i = 0; i < 3; i++) colors.push((await createDraft(token)).basics.color);
    expect(colors).toEqual(["lemon", "gum", "mint"]);

    // An ended project frees its colour.
    const gum = await testDb.project.findFirstOrThrow({ where: { color: "gum" } });
    await testDb.project.update({ where: { id: gum.id }, data: { status: "ENDED" } });
    expect((await createDraft(token)).basics.color).toBe("gum");

    // Other people's projects don't matter.
    const other = await login(1);
    expect((await createDraft(other.token)).basics.color).toBe("lemon");
  });

  it("reuses the least-used colour once all eight are taken", async () => {
    const { token } = await login(0);
    const colors = [];
    for (let i = 0; i < 10; i++) colors.push((await createDraft(token)).basics.color);
    expect(colors).toEqual(["lemon", "gum", "mint", "sky", "tang", "lilac", "lime", "aqua", "lemon", "gum"]);
  });
});

describe("draft visibility and editing", () => {
  it("shows a draft only to its leader", async () => {
    const leader = await login(0);
    const other = await login(1);
    const draft = await createDraft(leader.token);
    const id = draft.basics.id;

    expect((await call<DraftView>(`/api/projects/${id}/draft`, { token: leader.token })).data.basics.id).toBe(id);
    expect((await call<ProjectView>(`/api/projects/${id}`, { token: leader.token })).data.inviteCode).toBeNull();
    for (const [method, path] of [
      ["GET", `/api/projects/${id}`],
      ["GET", `/api/projects/${id}/draft`],
      ["PATCH", `/api/projects/${id}`],
      ["DELETE", `/api/projects/${id}`],
      ["POST", `/api/projects/${id}/confirm`],
      ["PUT", `/api/projects/${id}/tasks`],
    ] as const) {
      const res = await call(path, { method, token: other.token, body: method === "GET" || method === "DELETE" ? undefined : { tasks: [] } });
      expect(res.status, `${method} ${path}`).toBe(404);
    }
    expect((await call(`/api/projects/nope/draft`, { token: leader.token })).status).toBe(404);
  });

  it("updates the basics and the wizard step", async () => {
    const { token } = await login(0);
    const draft = await createDraft(token);
    const res = await call<DraftView>(`/api/projects/${draft.basics.id}`, {
      method: "PATCH",
      token,
      body: { name: "市场营销报告", shortCode: "", teamSize: 3, leaderManages: true, draftStep: 5 },
    });
    expect(res.status).toBe(200);
    expect(res.data.basics).toMatchObject({
      name: "市场营销报告",
      shortCode: null,
      courseName: "软件工程",
      teamSize: 3,
      leaderManages: true,
      packageCount: 2,
      draftStep: 5,
    });
    const bad = await call(`/api/projects/${draft.basics.id}`, { method: "PATCH", token, body: { draftStep: 7 } });
    expect(bad.error?.code).toBe("VALIDATION");
  });

  it("refuses a deadline in the past, but not one before a task's due date", async () => {
    const { token } = await login(0);
    const draft = await createDraft(token, { deadline: inDays(40) });
    const id = draft.basics.id;
    await call(`/api/projects/${id}/tasks`, {
      method: "PUT",
      token,
      body: { tasks: [{ title: "调研", kind: "RESEARCH", points: 100, dueAt: inDays(30) }] },
    });
    const past = await call(`/api/projects/${id}`, { method: "PATCH", token, body: { deadline: inDays(-2) } });
    expect(past.error?.code).toBe("DEADLINE_IN_PAST");
    const early = await call<DraftView>(`/api/projects/${id}`, { method: "PATCH", token, body: { deadline: inDays(20) } });
    expect(early.status).toBe(200);
    expect(early.data.tasks[0]!.dueAt).toBe(early.data.basics.deadline);
  });

  it("lets the leader delete a draft, but not a confirmed project", async () => {
    const { token } = await login(0);
    const draft = await createDraft(token);
    const res = await call(`/api/projects/${draft.basics.id}`, { method: "DELETE", token });
    expect(res).toMatchObject({ status: 200, data: null });
    expect(await testDb.project.count()).toBe(0);
    expect(await testDb.member.count()).toBe(0);

    const active = await createActive(token);
    const refused = await call(`/api/projects/${active.basics.id}`, { method: "DELETE", token });
    expect(refused.error?.code).toBe("NOT_A_DRAFT");
  });
});

describe("draft tasks", () => {
  it("replaces all tasks in manual mode (points in tenths, any total)", async () => {
    const { token } = await login(0);
    const draft = await createDraft(token);
    const due = klDate(12);
    const res = await call<DraftView>(`/api/projects/${draft.basics.id}/tasks`, {
      method: "PUT",
      token,
      body: {
        tasks: [
          { title: "市场调研", kind: "RESEARCH", points: 300, dueAt: due },
          { title: "竞品分析", kind: "RESEARCH", points: 250, dueAt: null, description: "  " },
          { title: "写报告", kind: "DOC", points: 200 },
          { title: "组会", kind: "MEETING", points: 100 },
        ],
      },
    });
    expect(res.status).toBe(200);
    expect(res.data.basics.planSource).toBe("MANUAL");
    expect(res.data.basics.draftStep).toBe(5);
    expect(res.data.totalPoints).toBe(850);
    expect(res.data.tasks.map((t) => [t.number, t.order, t.title, t.points])).toEqual([
      [1, 0, "市场调研", 300],
      [2, 1, "竞品分析", 250],
      [3, 2, "写报告", 200],
      [4, 3, "组会", 100],
    ]);
    expect(res.data.tasks[0]!.dueAt).toBe(endOfLocalDay(due, KL).toISOString());
    expect(res.data.tasks[1]).toMatchObject({ dueAt: null, description: null, status: "TODO", packageId: null });

    const again = await call<DraftView>(`/api/projects/${draft.basics.id}/tasks`, {
      method: "PUT",
      token,
      body: { tasks: [{ title: "只有一个", kind: "DOC", points: 50 }] },
    });
    expect(again.data.tasks).toHaveLength(1);
    expect(again.data.tasks[0]!.number).toBe(1);
  });

  it("refuses due dates after the project deadline, but allows the deadline's own date", async () => {
    const { token } = await login(0);
    const deadline = new Date(Date.now() + 20 * DAY);
    deadline.setUTCHours(9, 0, 0, 0); // 17:00 in Kuala Lumpur, before 23:59
    const draft = await createDraft(token, { deadline: deadline.toISOString() });
    const id = draft.basics.id;

    const late = await call(`/api/projects/${id}/tasks`, {
      method: "PUT",
      token,
      body: { tasks: [{ title: "A", kind: "DOC", points: 10, dueAt: new Date(deadline.getTime() + 60_000).toISOString() }] },
    });
    expect(late.error?.code).toBe("DUE_AFTER_DEADLINE");
    expect(await testDb.task.count()).toBe(0);

    const sameDay = await call<DraftView>(`/api/projects/${id}/tasks`, {
      method: "PUT",
      token,
      body: { tasks: [{ title: "A", kind: "DOC", points: 10, dueAt: localDate(deadline, KL) }] },
    });
    expect(sameDay.data.tasks[0]!.dueAt).toBe(deadline.toISOString());

    const nextDay = localDate(new Date(deadline.getTime() + DAY), KL);
    const add = await call(`/api/projects/${id}/tasks`, { method: "POST", token, body: { title: "B", kind: "DOC", points: 10, dueAt: nextDay } });
    expect(add.error?.code).toBe("DUE_AFTER_DEADLINE");
  });

  it("validates task input", async () => {
    const { token } = await login(0);
    const draft = await createDraft(token);
    const put = (task: object) => call(`/api/projects/${draft.basics.id}/tasks`, { method: "PUT", token, body: { tasks: [task] } });
    expect((await put({ title: "", kind: "DOC", points: 10 })).error?.code).toBe("VALIDATION");
    expect((await put({ title: "A", kind: "ESSAY", points: 10 })).error?.code).toBe("VALIDATION");
    expect((await put({ title: "A", kind: "DOC", points: 12.5 })).error?.code).toBe("VALIDATION");
    expect((await put({ title: "A", kind: "DOC", points: -1 })).error?.code).toBe("VALIDATION");
    expect((await put({ title: "A", kind: "DOC", points: 10, featureId: "nope" })).error?.code).toBe("VALIDATION");
  });

  it("adds, edits and deletes single tasks", async () => {
    const { token } = await login(0);
    const draft = await createDraft(token);
    const id = draft.basics.id;
    await call(`/api/projects/${id}/tasks`, { method: "PUT", token, body: { tasks: RUBRIC_TASKS.slice(0, 2) } });

    const added = await call<DraftView>(`/api/projects/${id}/tasks`, {
      method: "POST",
      token,
      body: { title: "期末演示 PPT", kind: "DESIGN", points: 40, dueAt: klDate(10) },
    });
    expect(added.status).toBe(201);
    expect(added.data.tasks.map((t) => t.number)).toEqual([1, 2, 3]);
    expect(added.data.totalPoints).toBe(740);
    const ppt = added.data.tasks[2]!;

    const edited = await call<DraftView>(`/api/projects/${id}/tasks/${ppt.id}`, {
      method: "PATCH",
      token,
      body: { title: "期末演示", points: 60, dueAt: null, description: "10 分钟" },
    });
    expect(edited.data.tasks[2]).toMatchObject({ title: "期末演示", kind: "DESIGN", points: 60, dueAt: null, description: "10 分钟" });

    const removed = await call<DraftView>(`/api/projects/${id}/tasks/${added.data.tasks[0]!.id}`, { method: "DELETE", token });
    expect(removed.data.tasks.map((t) => t.title)).toEqual(["口头报告", "期末演示"]);

    const next = await call<DraftView>(`/api/projects/${id}/tasks`, { method: "POST", token, body: { title: "D", kind: "DOC", points: 1 } });
    expect(next.data.tasks.at(-1)!.number).toBe(4);
  });

  it("links tasks to the project's features only", async () => {
    const { token } = await login(0);
    const mine = await createDraft(token);
    const theirs = await createDraft((await login(1)).token);
    const feature = await testDb.feature.create({ data: { projectId: mine.basics.id, name: "注册与登录", order: 0 } });
    const foreign = await testDb.feature.create({ data: { projectId: theirs.basics.id, name: "别人的", order: 0 } });

    const ok = await call<DraftView>(`/api/projects/${mine.basics.id}/tasks`, {
      method: "POST",
      token,
      body: { title: "注册页面", kind: "CODE", points: 120, featureId: feature.id },
    });
    expect(ok.data.tasks[0]!.featureId).toBe(feature.id);
    expect(ok.data.features).toEqual([{ id: feature.id, name: "注册与登录", order: 0 }]);
    const bad = await call(`/api/projects/${mine.basics.id}/tasks/${ok.data.tasks[0]!.id}`, {
      method: "PATCH",
      token,
      body: { featureId: foreign.id },
    });
    expect(bad.error?.code).toBe("VALIDATION");
  });

  it("can't touch another project's task", async () => {
    const { token } = await login(0);
    const a = await createDraft(token);
    const b = await createDraft(token);
    const put = await call<DraftView>(`/api/projects/${b.basics.id}/tasks`, { method: "PUT", token, body: { tasks: RUBRIC_TASKS } });
    const foreignTask = put.data.tasks[0]!.id;
    expect((await call(`/api/projects/${a.basics.id}/tasks/${foreignTask}`, { method: "PATCH", token, body: { title: "x" } })).status).toBe(404);
    expect((await call(`/api/projects/${a.basics.id}/tasks/${foreignTask}`, { method: "DELETE", token })).status).toBe(404);
  });

  it("locks points and deletion once a task has started", async () => {
    const { token } = await login(0);
    const draft = await createDraft(token);
    const put = await call<DraftView>(`/api/projects/${draft.basics.id}/tasks`, { method: "PUT", token, body: { tasks: RUBRIC_TASKS } });
    const [doing, started] = put.data.tasks;
    await testDb.task.update({ where: { id: doing!.id }, data: { status: "DOING" } });
    await testDb.task.update({ where: { id: started!.id }, data: { startedAt: new Date() } });

    for (const task of [doing!, started!]) {
      const path = `/api/projects/${draft.basics.id}/tasks/${task.id}`;
      expect((await call(path, { method: "PATCH", token, body: { points: 1 } })).error?.code).toBe("TASK_LOCKED");
      expect((await call(path, { method: "DELETE", token })).error?.code).toBe("TASK_LOCKED");
      // Unchanged points and other fields are fine.
      expect((await call(path, { method: "PATCH", token, body: { title: "新名字", points: task.points } })).status).toBe(200);
    }
  });
});

describe("POST /api/projects/:id/confirm", () => {
  it("refuses an empty plan", async () => {
    const { token } = await login(0);
    const draft = await createDraft(token);
    const res = await call(`/api/projects/${draft.basics.id}/confirm`, { method: "POST", token });
    expect(res.error?.code).toBe("PLAN_EMPTY");
  });

  it("rescales to exactly 100.0, splits into packages and creates the invite code", async () => {
    const { token, user } = await login(0);
    const draft = await createDraft(token);
    const id = draft.basics.id;
    await call(`/api/projects/${id}/tasks`, {
      method: "PUT",
      token,
      body: {
        tasks: [
          { title: "市场调研", kind: "RESEARCH", points: 300 },
          { title: "竞品分析", kind: "RESEARCH", points: 250 },
          { title: "写报告", kind: "DOC", points: 200 },
          { title: "组会", kind: "MEETING", points: 100 },
        ],
      },
    });
    const res = await call<ProjectView>(`/api/projects/${id}/confirm`, { method: "POST", token });
    expect(res.status).toBe(200);
    const view = res.data;
    expect(view.basics).toMatchObject({ status: "ACTIVE", draftStep: 6, packageCount: 5 });
    expect(view.inviteCode).toMatch(new RegExp(`^CS302-${CODE_CHARS}{8}$`));
    expect(view.viewerRole).toBe("LEADER");
    expect(view.members).toMatchObject([
      { id: view.viewerMemberId, userId: user.id, name: "陈思远", color: "lemon", role: "LEADER", active: true, packageId: null },
    ]);

    // 85 分 typed → 100.0 分 in proportion.
    expect(view.tasks.map((t) => t.points)).toEqual([353, 294, 235, 118]);
    expect(view.tasks.reduce((s, t) => s + t.points, 0)).toBe(1000);

    // 5 packages for 4 tasks: every task is in exactly one package; one package stays empty.
    expect(view.packages.map((p) => p.index)).toEqual([1, 2, 3, 4, 5]);
    expect(view.packages.every((p) => p.ownerMemberId === null && p.title === null)).toBe(true);
    const placed = view.packages.flatMap((p) => p.taskIds).sort();
    expect(placed).toEqual(view.tasks.map((t) => t.id).sort());
    for (const p of view.packages) {
      expect(p.points).toBe(view.tasks.filter((t) => p.taskIds.includes(t.id)).reduce((s, t) => s + t.points, 0));
    }
    for (const t of view.tasks) expect(view.packages.find((p) => p.id === t.packageId)?.taskIds).toContain(t.id);

    const project = await testDb.project.findUniqueOrThrow({ where: { id } });
    expect(project.activatedAt).not.toBeNull();
    // The feed starts with the plan.
    const events = await testDb.activityEvent.findMany({ where: { projectId: id } });
    expect(events.map((e) => [e.type, e.actorId, e.payload])).toEqual([
      ["PLAN_CONFIRMED", view.viewerMemberId, { type: "PLAN_CONFIRMED", packageCount: 5 }],
    ]);

    // Confirming twice, or editing the plan like a draft, is refused (adding a task is allowed since M3).
    expect((await call(`/api/projects/${id}/confirm`, { method: "POST", token })).error?.code).toBe("NOT_A_DRAFT");
    expect((await call(`/api/projects/${id}/draft`, { token })).error?.code).toBe("NOT_A_DRAFT");
    expect((await call(`/api/projects/${id}/tasks`, { method: "PUT", token, body: { tasks: [] } })).error?.code).toBe("NOT_A_DRAFT");
    expect((await call(`/api/projects/${id}/tasks/${view.tasks[0]!.id}`, { method: "DELETE", token })).error?.code).toBe("NOT_A_DRAFT");
  });

  it("keeps feature groups together: the mockup's 4 features + common work → five 20.0 packages", async () => {
    const { token } = await login(0);
    const draft = await createDraft(token);
    const id = draft.basics.id;
    const names = ["注册与登录", "商品发布", "买卖双方聊天", "搜索与筛选", "全组共同"];
    const features: { id: string; name: string }[] = [];
    for (const [order, name] of names.entries()) features.push(await testDb.feature.create({ data: { projectId: id, name, order } }));
    const groups: [number, number, number][] = [
      [120, 30, 50],
      [125, 30, 45],
      [115, 35, 50],
      [110, 40, 50],
    ];
    const tasks: TaskInput[] = groups.flatMap(([code, test, report], f): TaskInput[] => [
      { title: `${names[f]} 代码`, kind: "CODE", points: code, featureId: features[f]!.id },
      { title: `测试：${names[f]}`, kind: "CODE", points: test, featureId: features[f]!.id },
      { title: `报告：${names[f]}章节`, kind: "DOC", points: report, featureId: features[f]!.id },
    ]);
    for (const [title, kind, points] of [
      ["需求分析文档", "DOC", 80],
      ["数据库设计", "DOC", 60],
      ["期末演示 PPT", "DESIGN", 40],
      ["每周组会（5 次）", "MEETING", 20],
    ] as const) {
      tasks.push({ title, kind, points, featureId: features[4]!.id });
    }
    // Plan order interleaves the groups, as a leader editing by hand might.
    tasks.sort((a, b) => a.title.localeCompare(b.title));
    await call(`/api/projects/${id}/tasks`, { method: "PUT", token, body: { tasks } });

    const view = (await call<ProjectView>(`/api/projects/${id}/confirm`, { method: "POST", token })).data;
    expect(view.packages.map((p) => p.points)).toEqual([200, 200, 200, 200, 200]);
    expect(view.packages.map((p) => p.title).sort()).toEqual([...names].sort());
    for (const f of features) {
      const pkgs = new Set(view.tasks.filter((t) => t.featureId === f.id).map((t) => t.packageId));
      expect(pkgs.size, f.name).toBe(1);
    }
    // Numbers follow the plan order after confirming.
    expect(view.tasks.map((t) => t.number)).toEqual(view.tasks.map((_, i) => i + 1));
  });

  it("makes one package fewer when the leader only manages", async () => {
    const { token } = await login(0);
    const view = await createActive(token, { teamSize: 5, leaderManages: true });
    expect(view.basics.packageCount).toBe(4);
    expect(view.packages).toHaveLength(4);
  });

  it("renumbers tasks #1…#n after deletions", async () => {
    const { token } = await login(0);
    const draft = await createDraft(token);
    const id = draft.basics.id;
    const put = await call<DraftView>(`/api/projects/${id}/tasks`, { method: "PUT", token, body: { tasks: RUBRIC_TASKS } });
    await call(`/api/projects/${id}/tasks/${put.data.tasks[1]!.id}`, { method: "DELETE", token });
    await call(`/api/projects/${id}/tasks`, { method: "POST", token, body: { title: "新任务", kind: "DOC", points: 100 } });
    const view = (await call<ProjectView>(`/api/projects/${id}/confirm`, { method: "POST", token })).data;
    expect(view.tasks.map((t) => [t.number, t.title])).toEqual([
      [1, "书面报告"],
      [2, "问卷调查"],
      [3, "小组会议记录"],
      [4, "新任务"],
    ]);
  });

  it("uses random letters for the code when there is no usable short code", async () => {
    const { token } = await login(0);
    const view = await createActive(token, { shortCode: "软工" });
    expect(view.inviteCode).toMatch(new RegExp(`^${CODE_CHARS}{6}-${CODE_CHARS}{8}$`));
    const long = await createActive(token, { shortCode: "mkt-201 marketing" });
    expect(long.inviteCode).toMatch(new RegExp(`^MKT201-${CODE_CHARS}{8}$`));
  });

  it("confirms only once when tapped twice at the same time", async () => {
    const { token } = await login(0);
    const draft = await createDraft(token);
    const id = draft.basics.id;
    await call(`/api/projects/${id}/tasks`, { method: "PUT", token, body: { tasks: RUBRIC_TASKS } });
    const results = await Promise.all([
      call(`/api/projects/${id}/confirm`, { method: "POST", token }),
      call(`/api/projects/${id}/confirm`, { method: "POST", token }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)!.error?.code).toBe("NOT_A_DRAFT");
    expect(await testDb.package.count({ where: { projectId: id } })).toBe(5);
    expect(await testDb.activityEvent.count({ where: { projectId: id, type: "PLAN_CONFIRMED" } })).toBe(1);
  });

  it("refuses to confirm once the deadline has passed", async () => {
    const { token } = await login(0);
    const draft = await createDraft(token);
    await call(`/api/projects/${draft.basics.id}/tasks`, { method: "PUT", token, body: { tasks: RUBRIC_TASKS } });
    await testDb.project.update({ where: { id: draft.basics.id }, data: { deadline: new Date(Date.now() - DAY) } });
    const res = await call(`/api/projects/${draft.basics.id}/confirm`, { method: "POST", token });
    expect(res.error?.code).toBe("DEADLINE_IN_PAST");
  });
});

describe("active projects", () => {
  it("shows the project to active members only", async () => {
    const leader = await login(0);
    const member = await login(1);
    const stranger = await login(2);
    const view = await createActive(leader.token);
    await call(`/api/join/${view.inviteCode}`, { method: "POST", token: member.token });

    const seen = await call<ProjectView>(`/api/projects/${view.basics.id}`, { token: member.token });
    expect(seen.data).toMatchObject({ viewerRole: "MEMBER", inviteCode: view.inviteCode });
    expect(seen.data.members.map((m) => [m.name, m.role, m.color])).toEqual([
      ["陈思远", "LEADER", "lemon"],
      ["林晓雯", "MEMBER", "gum"],
    ]);
    expect((await call(`/api/projects/${view.basics.id}`, { token: stranger.token })).status).toBe(404);
  });

  it("lets only the leader edit the basics, and not the team size", async () => {
    const leader = await login(0);
    const member = await login(1);
    const view = await createActive(leader.token);
    const id = view.basics.id;
    await call(`/api/join/${view.inviteCode}`, { method: "POST", token: member.token });

    const renamed = await call<ProjectView>(`/api/projects/${id}`, {
      method: "PATCH",
      token: leader.token,
      body: { name: "新名字", deadline: inDays(80), teamSize: 5, draftStep: 2 },
    });
    expect(renamed.status).toBe(200);
    expect(renamed.data.basics).toMatchObject({ name: "新名字", status: "ACTIVE", draftStep: 6 });
    expect(renamed.data.packages).toHaveLength(5);

    const resize = await call(`/api/projects/${id}`, { method: "PATCH", token: leader.token, body: { teamSize: 4 } });
    expect(resize.error?.code).toBe("CONFLICT");
    const byMember = await call(`/api/projects/${id}`, { method: "PATCH", token: member.token, body: { name: "x" } });
    expect(byMember.error?.code).toBe("FORBIDDEN");
    const confirmByMember = await call(`/api/projects/${id}/confirm`, { method: "POST", token: member.token });
    expect(confirmByMember.error?.code).toBe("FORBIDDEN");
    // Members can't read the leader's draft endpoint either.
    expect((await call(`/api/projects/${id}/draft`, { token: member.token })).status).toBe(404);
  });

  it("refuses changes once the project has ended", async () => {
    const { token } = await login(0);
    const view = await createActive(token);
    await testDb.project.update({ where: { id: view.basics.id }, data: { status: "ENDED" } });
    const res = await call(`/api/projects/${view.basics.id}`, { method: "PATCH", token, body: { name: "x" } });
    expect(res.error?.code).toBe("PROJECT_ENDED");
  });
});

describe("POST /api/projects/:id/invite-code/reset", () => {
  it("replaces the code and retires the old one", async () => {
    const leader = await login(0);
    const view = await createActive(leader.token);
    const res = await call<{ inviteCode: string }>(`/api/projects/${view.basics.id}/invite-code/reset`, {
      method: "POST",
      token: leader.token,
    });
    expect(res.status).toBe(200);
    expect(res.data.inviteCode).toMatch(new RegExp(`^CS302-${CODE_CHARS}{8}$`));
    expect(res.data.inviteCode).not.toBe(view.inviteCode);
    expect(await testDb.retiredInviteCode.findUnique({ where: { code: view.inviteCode! } })).toMatchObject({
      projectId: view.basics.id,
    });
    const joiner = await login(1);
    expect((await call(`/api/join/${view.inviteCode}`, { token: joiner.token })).error?.code).toBe("INVITE_CODE_EXPIRED");
    expect((await call(`/api/join/${res.data.inviteCode}`, { token: joiner.token })).status).toBe(200);
  });

  it("is for the leader of a confirmed project only", async () => {
    const leader = await login(0);
    const member = await login(1);
    const view = await createActive(leader.token);
    await call(`/api/join/${view.inviteCode}`, { method: "POST", token: member.token });
    const byMember = await call(`/api/projects/${view.basics.id}/invite-code/reset`, { method: "POST", token: member.token });
    expect(byMember.error?.code).toBe("FORBIDDEN");

    const draft = await createDraft(leader.token);
    const onDraft = await call(`/api/projects/${draft.basics.id}/invite-code/reset`, { method: "POST", token: leader.token });
    expect(onDraft.error?.code).toBe("CONFLICT");
  });
});

// These use the free rules parser and the file extractor (server/src/lib/plan).
describe("POST /api/projects/:id/brief", () => {
  const RUBRIC = ["书面报告 40%", "口头报告 30%", "问卷调查 20%", "小组会议记录 10%"].join("\n");

  it("turns a typed brief with scores into tasks spread up to the deadline", async () => {
    const { token } = await login(0);
    const draft = await createDraft(token, { deadline: inDays(40) });
    const id = draft.basics.id;
    // Anything already there (tasks, features) is replaced.
    await testDb.feature.create({ data: { projectId: id, name: "旧功能", order: 0 } });
    await call(`/api/projects/${id}/tasks`, { method: "PUT", token, body: { tasks: [{ title: "旧任务", kind: "DOC", points: 5 }] } });

    const res = await call<BriefResult>(`/api/projects/${id}/brief`, { method: "POST", token, body: { text: RUBRIC } });
    expect(res.status).toBe(200);
    if (!res.data.ok) throw new Error(`brief failed: ${res.data.reason}`);
    expect(res.data).toMatchObject({ ok: true, source: "RULES", method: "SCORES", found: 4 });
    const d = res.data.draft;
    expect(d.basics).toMatchObject({ planSource: "RULES", draftStep: 5 });
    expect(d).toMatchObject({ hasBriefText: true, briefFileName: null, features: [], totalPoints: 1000 });
    expect(d.tasks.map((t) => [t.number, t.title, t.kind, t.points])).toEqual([
      [1, "书面报告", "DOC", 400],
      [2, "口头报告", "DESIGN", 300],
      [3, "问卷调查", "RESEARCH", 200],
      [4, "小组会议记录", "MEETING", 100],
    ]);
    const dues = d.tasks.map((t) => t.dueAt!);
    expect(d.tasks.map((t) => t.suggestedDueAt)).toEqual(dues);
    expect(dues.at(-1)).toBe(d.basics.deadline);
    for (const due of dues.slice(0, -1)) expect(due.slice(11)).toBe("15:59:59.999Z"); // 23:59:59.999 in KL
    expect([...dues].sort()).toEqual(dues);
  });

  it("splits a plain list equally", async () => {
    const { token } = await login(0);
    const draft = await createDraft(token);
    const text = "Tasks:\n1. Literature review\n2. Build the prototype app\n3. Final presentation slides";
    const res = await call<BriefResult>(`/api/projects/${draft.basics.id}/brief`, { method: "POST", token, body: { text } });
    if (!res.data.ok) throw new Error(`brief failed: ${res.data.reason}`);
    expect(res.data).toMatchObject({ method: "LIST", found: 3 });
    expect(res.data.draft.tasks.map((t) => t.points)).toEqual([334, 333, 333]);
  });

  it("reports briefs the rules can't split without changing the draft", async () => {
    const { token } = await login(0);
    const draft = await createDraft(token);
    const id = draft.basics.id;
    await call(`/api/projects/${id}/tasks`, { method: "PUT", token, body: { tasks: RUBRIC_TASKS } });

    const prose = "This semester your group will study how small businesses in Penang use social media. Discuss your findings with the class at the end of the term.";
    const none = await call<BriefResult>(`/api/projects/${id}/brief`, { method: "POST", token, body: { text: prose } });
    expect(none.data).toEqual({ ok: false, reason: "NO_STRUCTURE", fileName: null, sizeBytes: null, maxBytes: MAX_BRIEF_BYTES });
    const empty = await call<BriefResult>(`/api/projects/${id}/brief`, { method: "POST", token, body: { text: "  \n " } });
    expect(empty.data).toMatchObject({ ok: false, reason: "EMPTY" });

    const after = await call<DraftView>(`/api/projects/${id}/draft`, { token });
    expect(after.data.tasks.map((t) => t.title)).toEqual(RUBRIC_TASKS.map((t) => t.title));
    expect(after.data.basics.planSource).toBe("MANUAL");
  });

  it("reads an uploaded text file", async () => {
    const { token } = await login(0);
    const draft = await createDraft(token);
    const file = new File([RUBRIC], "作业要求.txt", { type: "text/plain" });
    const res = await upload(`/api/projects/${draft.basics.id}/brief`, token, file);
    const data = res.data as BriefResult;
    if (!data.ok) throw new Error(`brief failed: ${data.reason}`);
    expect(data.draft.briefFileName).toBe("作业要求.txt");
    expect(data.draft.tasks).toHaveLength(4);
  });

  it("explains files it can't read", async () => {
    const { token } = await login(0);
    const draft = await createDraft(token);
    const path = `/api/projects/${draft.basics.id}/brief`;
    const photo = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])], "作业要求.jpg", { type: "image/jpeg" });
    expect((await upload(path, token, photo)).data).toEqual({
      ok: false,
      reason: "UNREADABLE",
      fileName: "作业要求.jpg",
      sizeBytes: 7,
      maxBytes: MAX_BRIEF_BYTES,
    });
    const slides = new File([new Uint8Array([1, 2, 3])], "brief.pptx", {
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    });
    expect((await upload(path, token, slides)).data).toMatchObject({ ok: false, reason: "UNSUPPORTED_TYPE" });
    const blank = new File([""], "empty.txt", { type: "text/plain" });
    expect((await upload(path, token, blank)).data).toMatchObject({ ok: false, reason: "EMPTY" });
  });

  it("refuses files over the size limit", async () => {
    const { token } = await login(0);
    const draft = await createDraft(token);
    const big = new File([new Uint8Array(MAX_BRIEF_BYTES + 1024 * 1024)], "MKT201_课程资料合集.pdf", { type: "application/pdf" });
    const res = await upload(`/api/projects/${draft.basics.id}/brief`, token, big);
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({ ok: false, reason: "TOO_LARGE", maxBytes: MAX_BRIEF_BYTES });
  });

  it("needs a file field and a draft the viewer leads", async () => {
    const leader = await login(0);
    const other = await login(1);
    const draft = await createDraft(leader.token);
    const path = `/api/projects/${draft.basics.id}/brief`;
    const form = new FormData();
    form.append("note", "no file here");
    const res = await testApp.request(path, { method: "POST", headers: { Authorization: `Bearer ${leader.token}` }, body: form });
    expect(res.status).toBe(400);
    expect((await call(path, { method: "POST", token: other.token, body: { text: "1. A\n2. B" } })).status).toBe(404);

    const active = await createActive(leader.token);
    const onActive = await call(`/api/projects/${active.basics.id}/brief`, { method: "POST", token: leader.token, body: { text: "1. A\n2. B" } });
    expect(onActive.error?.code).toBe("NOT_A_DRAFT");
  });
});

describe("typed briefs", () => {
  const LINES = "做一个订餐网站\n写使用说明书\n做 PPT 上台展示";

  it("makes each typed line a task, even without numbers", async () => {
    const { token } = await login(0);
    const draft = await createDraft(token);
    const res = await call<BriefResult>(`/api/projects/${draft.basics.id}/brief`, { method: "POST", token, body: { text: LINES } });
    if (!res.data.ok) throw new Error(`brief failed: ${res.data.reason}`);
    expect(res.data).toMatchObject({ method: "LIST", found: 3 });
    expect(res.data.draft.tasks.map((t) => [t.title, t.kind, t.points])).toEqual([
      ["做一个订餐网站", "CODE", 334],
      ["写使用说明书", "DOC", 333],
      ["做 PPT 上台展示", "DESIGN", 333],
    ]);
  });

  it("still needs numbers or bullets in an uploaded file", async () => {
    const { token } = await login(0);
    const draft = await createDraft(token);
    const file = new File([LINES], "要做的事.txt", { type: "text/plain" });
    expect((await upload(`/api/projects/${draft.basics.id}/brief`, token, file)).data).toMatchObject({ ok: false, reason: "NO_STRUCTURE" });
  });
});

describe("package balance and splitting big tasks (step 5)", () => {
  // 35 / 30 / 20 / 10 → 368 / 316 / 211 / 105 after rescaling: four tasks can't fill five packages.
  const UNEVEN: TaskInput[] = [
    { title: "书面报告", kind: "DOC", points: 368, description: "3000 字" },
    { title: "口头报告", kind: "DESIGN", points: 316 },
    { title: "问卷调查", kind: "RESEARCH", points: 211 },
    { title: "小组会议记录", kind: "MEETING", points: 105 },
  ];

  async function unevenDraft(token: string, over: Parameters<typeof createDraft>[1] = {}) {
    const draft = await createDraft(token, over);
    const due = klDate(20);
    const tasks = UNEVEN.map((t, i) => (i === 0 ? { ...t, dueAt: due } : t));
    const put = await call<DraftView>(`/api/projects/${draft.basics.id}/tasks`, { method: "PUT", token, body: { tasks } });
    return put.data;
  }

  it("shows how the packages would come out before confirming", async () => {
    const { token } = await login(0);
    const draft = await unevenDraft(token);
    expect(draft.balance).toEqual({ packagePoints: [368, 316, 211, 105, 0], spread: 368, emptyPackages: 1, balanced: false });
    const empty = await createDraft(token);
    expect(empty.balance).toMatchObject({ emptyPackages: 5, balanced: false });
    const two = await createDraft(token, { teamSize: 2 });
    const even = await call<DraftView>(`/api/projects/${two.basics.id}/tasks`, { method: "PUT", token, body: { tasks: RUBRIC_TASKS } });
    expect(even.data.balance).toEqual({ packagePoints: [500, 500], spread: 0, emptyPackages: 0, balanced: true });
  });

  it("splits the big tasks into equal parts until the packages come out even", async () => {
    const { token } = await login(0);
    const draft = await unevenDraft(token);
    const id = draft.basics.id;
    const res = await call<DraftView>(`/api/projects/${id}/split-large`, { method: "POST", token });
    expect(res.status).toBe(200);
    const d = res.data;
    expect(d.balance).toMatchObject({ emptyPackages: 0, balanced: true });
    expect(d.balance.spread).toBeLessThanOrEqual(20);
    expect(d.totalPoints).toBe(1000);
    expect(d.tasks.map((t) => [t.number, t.order, t.title, t.points])).toEqual([
      [1, 0, "书面报告（第 1/4 部分）", 92],
      [2, 1, "书面报告（第 2/4 部分）", 92],
      [3, 2, "书面报告（第 3/4 部分）", 92],
      [4, 3, "书面报告（第 4/4 部分）", 92],
      [5, 4, "口头报告（第 1/3 部分）", 106],
      [6, 5, "口头报告（第 2/3 部分）", 105],
      [7, 6, "口头报告（第 3/3 部分）", 105],
      [8, 7, "问卷调查（第 1/2 部分）", 106],
      [9, 8, "问卷调查（第 2/2 部分）", 105],
      [10, 9, "小组会议记录", 105],
    ]);
    // The first part keeps the original task; the others copy its kind, due dates and description.
    expect(d.tasks[0]!.id).toBe(draft.tasks[0]!.id);
    expect(d.tasks.at(-1)!.id).toBe(draft.tasks[3]!.id);
    for (const part of d.tasks.slice(0, 4)) {
      expect(part).toMatchObject({ kind: "DOC", description: "3000 字", dueAt: draft.tasks[0]!.dueAt, status: "TODO" });
    }
    expect(d.tasks[5]).toMatchObject({ kind: "DESIGN", description: null, dueAt: null });

    // Confirming gives the even packages the preview promised.
    const view = (await call<ProjectView>(`/api/projects/${id}/confirm`, { method: "POST", token })).data;
    expect(view.packages.map((p) => p.points)).toEqual(d.balance.packagePoints);
    expect(view.packages.every((p) => p.taskIds.length > 0)).toBe(true);
  });

  it("does nothing when the packages are already even or nothing can be split further", async () => {
    const { token } = await login(0);
    const draft = await unevenDraft(token);
    const once = await call<DraftView>(`/api/projects/${draft.basics.id}/split-large`, { method: "POST", token });
    const twice = await call<DraftView>(`/api/projects/${draft.basics.id}/split-large`, { method: "POST", token });
    expect(twice.data.tasks).toEqual(once.data.tasks);

    const two = await createDraft(token, { teamSize: 2 });
    const put = await call<DraftView>(`/api/projects/${two.basics.id}/tasks`, { method: "PUT", token, body: { tasks: RUBRIC_TASKS } });
    const same = await call<DraftView>(`/api/projects/${two.basics.id}/split-large`, { method: "POST", token });
    expect(same.data.tasks).toEqual(put.data.tasks);

    // Every part keeps at least a tenth: two 0.1-point tasks can't fill 4 packages. The app sees the
    // same task count and says so.
    const tiny = await createDraft(token, { teamSize: 4 });
    const tasks = [
      { title: "A", kind: "DOC", points: 1 },
      { title: "B", kind: "DOC", points: 1 },
    ];
    const small = await call<DraftView>(`/api/projects/${tiny.basics.id}/tasks`, { method: "PUT", token, body: { tasks } });
    const stuck = await call<DraftView>(`/api/projects/${tiny.basics.id}/split-large`, { method: "POST", token });
    expect(stuck.data.tasks).toEqual(small.data.tasks);
    expect(stuck.data.balance.balanced).toBe(false);
  });

  it("names the parts in the language the app shows", async () => {
    const { token } = await login(0);
    await call("/api/me", { method: "PATCH", token, body: { locale: "en" } });
    const draft = await createDraft(token, { teamSize: 2 });
    const id = draft.basics.id;
    await call(`/api/projects/${id}/tasks`, { method: "PUT", token, body: { tasks: [{ title: "书面报告", kind: "DOC", points: 1000 }] } });
    const res = await call<DraftView>(`/api/projects/${id}/split-large`, { method: "POST", token, body: { locale: "zh" } });
    expect(res.data.tasks.map((t) => t.title)).toEqual(["书面报告（第 1/2 部分）", "书面报告（第 2/2 部分）"]);
    const bad = await call(`/api/projects/${id}/split-large`, { method: "POST", token, body: { locale: "fr" } });
    expect(bad.status).toBe(400);
  });

  it("names the parts in the user's saved language and numbers them again when split further", async () => {
    const { token } = await login(0);
    await call("/api/me", { method: "PATCH", token, body: { locale: "en" } });
    const draft = await createDraft(token, { teamSize: 2 });
    const id = draft.basics.id;
    await call(`/api/projects/${id}/tasks`, { method: "PUT", token, body: { tasks: [{ title: "Written report", kind: "DOC", points: 1000 }] } });
    const halves = await call<DraftView>(`/api/projects/${id}/split-large`, { method: "POST", token });
    expect(halves.data.tasks.map((t) => [t.title, t.points])).toEqual([
      ["Written report (part 1/2)", 500],
      ["Written report (part 2/2)", 500],
    ]);

    // Four people now: both halves are split again and numbered as one set.
    await call(`/api/projects/${id}`, { method: "PATCH", token, body: { teamSize: 4 } });
    const quarters = await call<DraftView>(`/api/projects/${id}/split-large`, { method: "POST", token });
    expect(quarters.data.tasks.map((t) => [t.title, t.points])).toEqual([
      ["Written report (part 1/4)", 250],
      ["Written report (part 2/4)", 250],
      ["Written report (part 3/4)", 250],
      ["Written report (part 4/4)", 250],
    ]);
  });

  it("keeps started tasks whole", async () => {
    const { token } = await login(0);
    const draft = await unevenDraft(token);
    await testDb.task.update({ where: { id: draft.tasks[0]!.id }, data: { status: "DOING" } });
    const res = await call<DraftView>(`/api/projects/${draft.basics.id}/split-large`, { method: "POST", token });
    expect(res.data.tasks[0]).toMatchObject({ id: draft.tasks[0]!.id, title: "书面报告", points: 368 });
    expect(res.data.tasks.filter((t) => t.title.startsWith("书面报告"))).toHaveLength(1);
  });

  it("is for the leader's draft only", async () => {
    const leader = await login(0);
    const other = await login(1);
    const draft = await unevenDraft(leader.token);
    expect((await call(`/api/projects/${draft.basics.id}/split-large`, { method: "POST", token: other.token })).status).toBe(404);
    const active = await createActive(leader.token);
    const res = await call(`/api/projects/${active.basics.id}/split-large`, { method: "POST", token: leader.token });
    expect(res.error?.code).toBe("NOT_A_DRAFT");
  });
});

describe("changing the project deadline", () => {
  const RUBRIC = ["书面报告 40%", "口头报告 30%", "问卷调查 20%", "小组会议记录 10%"].join("\n");
  const iso = (d: Date) => d.toISOString();

  it("spreads the scheduled due dates evenly again up to a later deadline", async () => {
    const { token } = await login(0);
    const draft = await createDraft(token, { deadline: inDays(40) });
    const id = draft.basics.id;
    const brief = await call<BriefResult>(`/api/projects/${id}/brief`, { method: "POST", token, body: { text: RUBRIC } });
    if (!brief.data.ok) throw new Error("brief failed");
    const before = brief.data.draft.tasks;

    const deadline = new Date(Date.now() + 60 * DAY);
    const startedAt = new Date();
    const res = await call<DraftView>(`/api/projects/${id}`, { method: "PATCH", token, body: { deadline: iso(deadline) } });
    const endedAt = new Date();
    expect(res.status).toBe(200);
    const tasks = res.data.tasks;
    const expected = [startedAt, endedAt].map((start) => spreadDueDates(4, start, deadline, KL).map(iso));
    expect(expected).toContainEqual(tasks.map((t) => t.dueAt));
    expect(tasks.map((t) => t.suggestedDueAt)).toEqual(tasks.map((t) => t.dueAt));
    expect(tasks.at(-1)!.dueAt).toBe(iso(deadline));
    tasks.forEach((t, i) => expect(t.dueAt! > before[i]!.dueAt!).toBe(true));
    expect(res.data.adjustedTasks).toEqual(tasks.map((t) => ({ id: t.id, title: t.title, dueAt: t.dueAt })));
  });

  it("pulls the leader's later dates in to an earlier deadline and keeps the rest", async () => {
    const { token } = await login(0);
    const draft = await createDraft(token, { deadline: inDays(40) });
    const id = draft.basics.id;
    const put = await call<DraftView>(`/api/projects/${id}/tasks`, {
      method: "PUT",
      token,
      body: {
        tasks: [
          { title: "晚的", kind: "DOC", points: 100, dueAt: inDays(30) },
          { title: "早的", kind: "DOC", points: 100, dueAt: inDays(5) },
          { title: "没日期", kind: "DOC", points: 100 },
          { title: "系统排的", kind: "DOC", points: 100, dueAt: inDays(35) },
          { title: "建议更晚", kind: "DOC", points: 100, dueAt: inDays(10) },
        ],
      },
    });
    const [late, early, none, scheduled, suggested] = put.data.tasks;
    // This one's date came from the planner, not the leader.
    await testDb.task.update({ where: { id: scheduled!.id }, data: { suggestedDueAt: new Date(scheduled!.dueAt!), leaderDueAt: null } });
    await testDb.task.update({ where: { id: late!.id }, data: { suggestedDueAt: new Date(Date.now() + 38 * DAY) } });
    await testDb.task.update({ where: { id: suggested!.id }, data: { suggestedDueAt: new Date(Date.now() + 25 * DAY) } });

    const deadline = iso(new Date(Date.now() + 20 * DAY));
    const res = await call<DraftView>(`/api/projects/${id}`, { method: "PATCH", token, body: { deadline } });
    expect(res.status).toBe(200);
    const byId = new Map(res.data.tasks.map((t) => [t.id, t]));
    // Leader's date after the new deadline → the deadline (with its later suggestion).
    expect(byId.get(late!.id)).toMatchObject({ dueAt: deadline, suggestedDueAt: deadline });
    // Leader's earlier date and "no date" stay.
    expect(byId.get(early!.id)).toMatchObject({ dueAt: early!.dueAt, suggestedDueAt: null });
    expect(byId.get(none!.id)).toMatchObject({ dueAt: null });
    // The only system-scheduled task is due at the new deadline (the last of one).
    expect(byId.get(scheduled!.id)).toMatchObject({ dueAt: deadline, suggestedDueAt: deadline });
    // A suggestion after the deadline is pulled in; the leader's own earlier date stays.
    expect(byId.get(suggested!.id)).toMatchObject({ dueAt: suggested!.dueAt, suggestedDueAt: deadline });
    expect(res.data.adjustedTasks).toEqual([
      { id: late!.id, title: "晚的", dueAt: deadline },
      { id: scheduled!.id, title: "系统排的", dueAt: deadline },
    ]);
  });

  it("works on a confirmed project too", async () => {
    const leader = await login(0);
    const member = await login(1);
    const tasks = RUBRIC_TASKS.map((t, i) => ({ ...t, dueAt: inDays(40 + i) }));
    const view = await createActive(leader.token, { tasks });
    await call(`/api/join/${view.inviteCode}`, { method: "POST", token: member.token });
    // Finished work keeps the date it was done against.
    const done = view.tasks.find((t) => t.title === RUBRIC_TASKS[3]!.title)!;
    await testDb.task.update({ where: { id: done.id }, data: { status: "DONE", grade: "PASS" } });
    const deadline = iso(new Date(Date.now() + 30 * DAY));
    const res = await call<ProjectView>(`/api/projects/${view.basics.id}`, { method: "PATCH", token: leader.token, body: { deadline } });
    expect(res.status).toBe(200);
    expect(res.data.basics.deadline).toBe(deadline);
    expect(res.data.tasks.map((t) => t.dueAt)).toEqual([deadline, deadline, deadline, done.dueAt]);
    expect(res.data.adjustedTasks?.map((t) => t.title)).toEqual(RUBRIC_TASKS.slice(0, 3).map((t) => t.title));
    // Only that response lists them.
    expect((await call<ProjectView>(`/api/projects/${view.basics.id}`, { token: member.token })).data.adjustedTasks).toBeUndefined();
  });

  it("gives the leader's own dates back when an earlier deadline moves later again", async () => {
    const leader = await login(0);
    const view = await createActive(leader.token, {
      deadline: inDays(40),
      tasks: [
        { title: "组长定的", kind: "DOC", points: 400, dueAt: inDays(30) },
        { title: "组长定的早", kind: "DOC", points: 300, dueAt: inDays(10) },
        { title: "系统排的", kind: "DOC", points: 300, dueAt: inDays(35) },
      ],
    });
    const id = view.basics.id;
    const [mine, early, system] = view.tasks;
    await testDb.task.update({ where: { id: system!.id }, data: { suggestedDueAt: new Date(system!.dueAt!), leaderDueAt: null } });
    const patch = (deadline: string) => call<ProjectView>(`/api/projects/${id}`, { method: "PATCH", token: leader.token, body: { deadline } });
    const dueOf = (v: ProjectView, taskId: string) => v.tasks.find((t) => t.id === taskId)!.dueAt;

    const earlier = iso(new Date(Date.now() + 20 * DAY));
    const first = (await patch(earlier)).data;
    expect(dueOf(first, mine!.id)).toBe(earlier);
    expect(dueOf(first, early!.id)).toBe(early!.dueAt);
    expect(dueOf(first, system!.id)).toBe(earlier);
    expect(first.adjustedTasks?.map((t) => t.title)).toEqual(["组长定的", "系统排的"]);

    const later = iso(new Date(Date.now() + 45 * DAY));
    const second = (await patch(later)).data;
    // Back to the date the leader set; the planner's date is spread again up to the new deadline.
    expect(dueOf(second, mine!.id)).toBe(mine!.dueAt);
    expect(dueOf(second, early!.id)).toBe(early!.dueAt);
    expect(dueOf(second, system!.id)).toBe(later);
    expect(second.adjustedTasks).toEqual([
      { id: mine!.id, title: "组长定的", dueAt: mine!.dueAt },
      { id: system!.id, title: "系统排的", dueAt: later },
    ]);
    const rows = await testDb.task.findMany({ where: { projectId: id }, orderBy: { number: "asc" } });
    expect(rows.map((r) => r.leaderDueAt && iso(r.leaderDueAt))).toEqual([mine!.dueAt, early!.dueAt, null]);

    // A deadline between the two gives back only what fits.
    const middle = iso(new Date(Date.now() + 25 * DAY));
    await patch(earlier);
    const third = (await patch(middle)).data;
    expect(dueOf(third, mine!.id)).toBe(middle);
  });

  it("lists nothing when the deadline stays", async () => {
    const { token } = await login(0);
    const draft = await createDraft(token);
    const id = draft.basics.id;
    await call(`/api/projects/${id}/brief`, { method: "POST", token, body: { text: RUBRIC } });
    const renamed = await call<DraftView>(`/api/projects/${id}`, { method: "PATCH", token, body: { name: "新名字" } });
    expect(renamed.data.adjustedTasks).toBeUndefined();
    const same = await call<DraftView>(`/api/projects/${id}`, { method: "PATCH", token, body: { deadline: draft.basics.deadline } });
    expect(same.data.adjustedTasks).toBeUndefined();
    expect(same.data.tasks.map((t) => t.dueAt)).toEqual(renamed.data.tasks.map((t) => t.dueAt));
  });
});

describe("brief file names", () => {
  it("prefers the separate UTF-8 fileName field and decodes percent-encoded part names", async () => {
    const { briefFileName } = await import("../src/routes/projects");
    expect(briefFileName("作业说明.pdf", "brief.pdf")).toBe("作业说明.pdf");
    expect(briefFileName(undefined, "%E4%BD%9C%E4%B8%9A.txt")).toBe("作业.txt");
    expect(briefFileName("", "notes%.txt")).toBe("notes%.txt");
    expect(briefFileName(undefined, `a${String.fromCharCode(0)}b.txt`)).toBe("ab.txt");
    expect(briefFileName(undefined, "")).toBe("brief");
  });
});

describe("the leader's own due dates (leaderDueAt)", () => {
  const RUBRIC = ["书面报告 40%", "口头报告 30%", "问卷调查 20%", "小组会议记录 10%"].join("\n");
  const rowsOf = (projectId: string) => testDb.task.findMany({ where: { projectId }, orderBy: [{ order: "asc" }, { number: "asc" }] });
  const iso = (d: Date | null) => d && d.toISOString();

  it("is set when the leader types a date and cleared with it; the rules parser never sets it", async () => {
    const { token } = await login(0);
    const draft = await createDraft(token);
    const id = draft.basics.id;
    await call(`/api/projects/${id}/brief`, { method: "POST", token, body: { text: RUBRIC } });
    const parsed = await rowsOf(id);
    expect(parsed.every((r) => r.dueAt !== null && r.leaderDueAt === null)).toBe(true);

    const task = parsed[0]!;
    const path = `/api/projects/${id}/tasks/${task.id}`;
    const due = klDate(10);
    await call(path, { method: "PATCH", token, body: { dueAt: due } });
    const edited = await testDb.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(iso(edited.leaderDueAt)).toBe(endOfLocalDay(due, KL).toISOString());
    expect(edited.dueAt).toEqual(edited.leaderDueAt);
    expect(edited.suggestedDueAt).toEqual(task.suggestedDueAt);

    // Other edits leave it; clearing the date clears both (the planner's suggestion stays for reference).
    await call(path, { method: "PATCH", token, body: { title: "书面报告（终稿）" } });
    expect((await testDb.task.findUniqueOrThrow({ where: { id: task.id } })).leaderDueAt).toEqual(edited.leaderDueAt);
    await call(path, { method: "PATCH", token, body: { dueAt: null } });
    expect(await testDb.task.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({
      dueAt: null,
      leaderDueAt: null,
      suggestedDueAt: task.suggestedDueAt,
    });

    // Adding and the manual plan: a typed date is the leader's; no date, none.
    await call(`/api/projects/${id}/tasks`, { method: "POST", token, body: { title: "加的", kind: "DOC", points: 50, dueAt: due } });
    await call(`/api/projects/${id}/tasks`, { method: "POST", token, body: { title: "没日期", kind: "DOC", points: 50 } });
    const added = (await rowsOf(id)).slice(-2);
    expect(added.map((r) => [r.title, iso(r.leaderDueAt)])).toEqual([
      ["加的", endOfLocalDay(due, KL).toISOString()],
      ["没日期", null],
    ]);
    await call(`/api/projects/${id}/tasks`, {
      method: "PUT",
      token,
      body: { tasks: [{ title: "A", kind: "DOC", points: 10, dueAt: due }, { title: "B", kind: "DOC", points: 10 }] },
    });
    expect((await rowsOf(id)).map((r) => iso(r.leaderDueAt))).toEqual([endOfLocalDay(due, KL).toISOString(), null]);
  });

  it("is copied to every part when a big task is split", async () => {
    const { token } = await login(0);
    const draft = await createDraft(token, { teamSize: 2 });
    const id = draft.basics.id;
    const due = klDate(12);
    const dueIso = endOfLocalDay(due, KL).toISOString();
    await call(`/api/projects/${id}/tasks`, { method: "PUT", token, body: { tasks: [{ title: "书面报告", kind: "DOC", points: 1000, dueAt: due }] } });
    await call(`/api/projects/${id}/split-large`, { method: "POST", token, body: { locale: "zh" } });
    const parts = await rowsOf(id);
    expect(parts.map((r) => [r.title, iso(r.dueAt), iso(r.leaderDueAt)])).toEqual([
      ["书面报告（第 1/2 部分）", dueIso, dueIso],
      ["书面报告（第 2/2 部分）", dueIso, dueIso],
    ]);
  });
});

describe("the project view (M3 fields)", () => {
  const HOUR = 60 * 60 * 1000;

  async function team(n: number, opts: Parameters<typeof activeWith>[1] = {}) {
    const t = await activeWith(n, opts);
    const idOf = (userId: string) => t.view.members.find((m) => m.userId === userId)!.id;
    return {
      ...t,
      leaderId: idOf(t.leader.user.id),
      memberIds: t.members.map((p) => idOf(p.user.id)),
      packages: [...t.view.packages].sort((a, b) => a.index - b.index),
    };
  }

  it("works out earned points, started packages, overdue tasks, who needs a package and the re-split range", async () => {
    const t = await team(3);
    const [aId, bId] = t.memberIds as [string, string];
    const [p1, p2, p3] = t.packages;
    const [a1, a2] = p1!.taskIds as [string, string];
    const [b1, b2] = p2!.taskIds as [string, string];
    const past = new Date(Date.now() - 2 * DAY);
    await testDb.package.update({ where: { id: p1!.id }, data: { ownerId: aId } });
    await testDb.package.update({ where: { id: p2!.id }, data: { ownerId: bId } });
    // A finished one task (their own start) and is late on the other.
    await testDb.task.update({
      where: { id: a1 },
      data: { ownerId: aId, status: "DONE", grade: "PASS", startedAt: past, startedById: aId, dueAt: past, estimateHours: 1.5 },
    });
    await testDb.task.update({ where: { id: a2 }, data: { ownerId: aId, dueAt: past, estimateHours: 2.25 } });
    // B holds work someone else started (moved in), which isn't B's start, and finished another task:
    // finishing counts as starting (REQUIREMENTS §13 开工), so B's package is started.
    await testDb.task.update({ where: { id: b1 }, data: { ownerId: bId, status: "DOING", startedAt: past, startedById: t.leaderId } });
    await testDb.task.update({ where: { id: b2 }, data: { ownerId: bId, status: "HALF", grade: "HALF" } });

    const view = await viewAs(t.members[0]!.token, t.projectId);
    const task = (id: string) => view.tasks.find((x) => x.id === id)!;
    const points = (id: string) => task(id).points;
    expect(task(a1)).toMatchObject({ locked: true, overdue: false, earnedPoints: points(a1), startedByMemberId: aId });
    expect(task(a2)).toMatchObject({ locked: false, overdue: true, earnedPoints: 0 });
    expect(task(b1)).toMatchObject({ locked: true, overdue: false, earnedPoints: 0, startedByMemberId: t.leaderId });
    expect(task(b2)).toMatchObject({ locked: true, earnedPoints: Math.round(points(b2) / 2) });

    const pkg = (id: string) => view.packages.find((p) => p.id === id)!;
    expect(pkg(p1!.id)).toMatchObject({ started: true, earnedPoints: points(a1), overdueCount: 1, estimateHours: 3.8 });
    expect(pkg(p2!.id)).toMatchObject({ started: true, earnedPoints: Math.round(points(b2) / 2), overdueCount: 0, estimateHours: null });
    expect(pkg(p3!.id)).toMatchObject({ started: false, earnedPoints: 0, ownerMemberId: null });

    const member = (id: string) => view.members.find((m) => m.id === id)!;
    expect(member(aId)).toMatchObject({ earnedPoints: points(a1), unfinishedCount: 1, needsPackage: false });
    expect(member(bId)).toMatchObject({ earnedPoints: Math.round(points(b2) / 2), unfinishedCount: 1, needsPackage: false });
    // The leader (who does tasks too) hasn't picked yet.
    expect(member(t.leaderId)).toMatchObject({ earnedPoints: 0, unfinishedCount: 0, needsPackage: true });
    expect(view.viewerNeedsPackage).toBe(false);
    expect((await viewAs(t.leader.token, t.projectId)).viewerNeedsPackage).toBe(true);

    expect(view.earnedPoints).toBe(points(a1) + Math.round(points(b2) / 2));
    expect(view.basics.packageCount).toBe(3);
    // Three people should each hold a package; two packages have to stay.
    expect(view.resplitRange).toEqual({ min: 3, max: 8 });
    const totals = view.packages.map((p) => p.points);
    const lightest = view.packages.find((p) => p.points === Math.min(...totals))!;
    expect(view.lightestPackageId).toBe(lightest.id);
    expect(view.packagesVersion).toBe((await testDb.project.findUniqueOrThrow({ where: { id: t.projectId } })).packagesVersion);

    // Without the finished task, work someone else started alone isn't B's start.
    await testDb.task.update({ where: { id: b2 }, data: { status: "TODO", grade: null } });
    expect((await viewAs(t.members[0]!.token, t.projectId)).packages.find((p) => p.id === p2!.id)!.started).toBe(false);
  });

  it("never marks a leader who only manages as needing a package", async () => {
    const t = await team(3, { leaderManages: true });
    const view = await viewAs(t.leader.token, t.projectId);
    expect(view.viewerNeedsPackage).toBe(false);
    expect(view.members.map((m) => [m.role, m.needsPackage])).toEqual([
      ["LEADER", false],
      ["MEMBER", true],
      ["MEMBER", true],
    ]);
    expect(view.resplitRange).toEqual({ min: 2, max: 7 });
  });

  it("shows a pending swap only to its two people, and not after it ran out", async () => {
    const t = await team(3);
    const [aId, bId] = t.memberIds as [string, string];
    const [p1, p2, p3] = t.packages;
    const owners: [string, string][] = [
      [p1!.id, aId],
      [p2!.id, bId],
      [p3!.id, t.leaderId],
    ];
    for (const [packageId, ownerId] of owners) await testDb.package.update({ where: { id: packageId }, data: { ownerId } });
    const createdAt = new Date(Date.now() - HOUR);
    const swap = await testDb.swapRequest.create({
      data: {
        projectId: t.projectId,
        requesterId: aId,
        targetId: bId,
        requesterPackageId: p1!.id,
        targetPackageId: p2!.id,
        createdAt,
        expiresAt: new Date(createdAt.getTime() + 72 * HOUR),
      },
    });
    const old = new Date(Date.now() - 73 * HOUR);
    await testDb.swapRequest.create({
      data: {
        projectId: t.projectId,
        requesterId: t.leaderId,
        targetId: aId,
        requesterPackageId: p3!.id,
        targetPackageId: p1!.id,
        createdAt: old,
        expiresAt: new Date(old.getTime() + 72 * HOUR),
      },
    });
    const expected = [
      {
        id: swap.id,
        requesterMemberId: aId,
        targetMemberId: bId,
        requesterPackageId: p1!.id,
        targetPackageId: p2!.id,
        createdAt: createdAt.toISOString(),
        expiresAt: swap.expiresAt.toISOString(),
      },
    ];
    expect((await viewAs(t.members[0]!.token, t.projectId)).swaps).toEqual(expected);
    expect((await viewAs(t.members[1]!.token, t.projectId)).swaps).toEqual(expected);
    expect((await viewAs(t.leader.token, t.projectId)).swaps).toEqual([]);
  });

  it("shows a draft's planned package count and nobody needing a package", async () => {
    const { token } = await login(0);
    const draft = await createDraft(token, { teamSize: 4 });
    const view = (await call<ProjectView>(`/api/projects/${draft.basics.id}`, { token })).data;
    expect(view.basics.packageCount).toBe(4);
    expect(view).toMatchObject({ viewerNeedsPackage: false, swaps: [], earnedPoints: 0, lightestPackageId: null });
    expect(view.members[0]!.needsPackage).toBe(false);
  });
});
