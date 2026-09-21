import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { HomeData, InviteOutcome, ProjectView } from "../../shared/types";
import { seedDemo } from "../prisma/seed";
import { call, testDb } from "./helpers";
import { activeWith, createActive, createDraft, freshDb, joinCode, login, person } from "./project-fixtures";

beforeEach(freshDb);
afterAll(() => testDb.$disconnect());

const home = async (token: string) => (await call<HomeData>("/api/home", { token })).data;

describe("GET /api/home", () => {
  it("requires sign-in", async () => {
    expect((await call("/api/home")).status).toBe(401);
  });

  it("is empty for someone new", async () => {
    const { token } = await login(0);
    expect(await home(token)).toEqual({ projects: [], invites: [], dueSoon: [], deletedProjects: [] });
  });

  it("shows a draft only to the leader who created it", async () => {
    const leader = await login(0);
    const other = await login(1);
    const draft = await createDraft(leader.token, { name: "市场营销报告", shortCode: "MKT201", courseName: "市场营销原理", groupLabel: null });
    await call(`/api/projects/${draft.basics.id}`, { method: "PATCH", token: leader.token, body: { draftStep: 5 } });

    const data = await home(leader.token);
    expect(data.projects).toEqual([
      {
        id: draft.basics.id,
        name: "市场营销报告",
        shortCode: "MKT201",
        courseName: "市场营销原理",
        groupLabel: null,
        color: "lemon",
        status: "DRAFT",
        draftStep: 5,
        role: "LEADER",
        leaderName: "陈思远",
        memberCount: 1,
        teamSize: 5,
        packageCount: 5,
        freePackages: 0,
        myPackageIndex: null,
        earnedPoints: 0,
        deadline: draft.basics.deadline,
        members: [{ name: "陈思远", color: "lemon" }],
        updatedAt: expect.any(String),
        needsPackage: false,
        lifecycle: { status: "DRAFT", awaitingSince: null, autoEndAt: null, endedAt: null, endedAuto: false, endedBy: null, purgeAfter: null },
      },
    ]);
    expect((await home(other.token)).projects).toEqual([]);
  });

  it("shows active projects to their members with packages and colours", async () => {
    const leader = await login(0);
    const a = await login(1);
    const b = await login(2);
    const view = await createActive(leader.token, { leaderManages: true });
    const joinedA = await joinCode(a.token, view.inviteCode!);
    await joinCode(b.token, view.inviteCode!);

    const forA = await home(a.token);
    expect(forA.projects).toHaveLength(1);
    expect(forA.projects[0]).toMatchObject({
      id: view.basics.id,
      status: "ACTIVE",
      role: "MEMBER",
      leaderName: "陈思远",
      memberCount: 3,
      teamSize: 5,
      packageCount: 4,
      freePackages: 4,
      myPackageIndex: null,
      members: [
        { name: "陈思远", color: "lemon" },
        { name: "林晓雯", color: "gum" },
        { name: "王子杰", color: "mint" },
      ],
    });

    // A picked package (M3 does the picking; here we set it directly).
    await testDb.package.update({ where: { id: view.packages[2]!.id }, data: { ownerId: joinedA.data.viewerMemberId } });
    const after = await home(a.token);
    expect(after.projects[0]).toMatchObject({ freePackages: 3, myPackageIndex: 3 });
    expect((await home(leader.token)).projects[0]).toMatchObject({ role: "LEADER", myPackageIndex: null, freePackages: 3 });
  });

  it("hides projects the viewer left or was removed from, and lists ended ones last", async () => {
    const leader = await login(0);
    const a = await login(1);
    const left = await createActive(leader.token, { name: "退出的项目" });
    const removed = await createActive(leader.token, { name: "被移除的项目" });
    const ended = await createActive(leader.token, { name: "结束的项目" });
    const current = await createActive(leader.token, { name: "进行中的项目" });
    for (const p of [left, removed, ended, current]) await joinCode(a.token, p.inviteCode!);
    await testDb.member.updateMany({ where: { projectId: left.basics.id, userId: a.user.id }, data: { leftAt: new Date() } });
    await testDb.member.updateMany({
      where: { projectId: removed.basics.id, userId: a.user.id },
      data: { leftAt: new Date(), removed: true },
    });
    await call(`/api/projects/${current.basics.id}`, { method: "PATCH", token: leader.token, body: { name: "进行中的项目" } });
    // Ended most recently, yet it still sorts after every running project.
    await testDb.project.update({ where: { id: ended.basics.id }, data: { status: "ENDED" } });

    expect((await home(a.token)).projects.map((p) => p.name)).toEqual(["进行中的项目", "结束的项目"]);
    expect((await home(leader.token)).projects.map((p) => p.name)).toEqual(["进行中的项目", "被移除的项目", "退出的项目", "结束的项目"]);
  });

  it("orders running projects by the latest edit", async () => {
    const { token } = await login(0);
    const first = await createDraft(token, { name: "第一个" });
    await createDraft(token, { name: "第二个" });
    expect((await home(token)).projects.map((p) => p.name)).toEqual(["第二个", "第一个"]);
    await call(`/api/projects/${first.basics.id}/tasks`, { method: "POST", token, body: { title: "新任务", kind: "DOC", points: 10 } });
    expect((await home(token)).projects.map((p) => p.name)).toEqual(["第一个", "第二个"]);
  });

  it("shows one invite card per project, not for projects already joined or ended", async () => {
    const leader = await login(0);
    const invitee = await login(1);
    const p1 = await createActive(leader.token, { name: "项目一", teamSize: 4 });
    const p2 = await createActive(leader.token, { name: "项目二" });
    const p3 = await createActive(leader.token, { name: "项目三" });
    const send = (projectId: string, targets: string) =>
      call<InviteOutcome[]>(`/api/projects/${projectId}/invites`, { method: "POST", token: leader.token, body: { targets } });
    await send(p1.basics.id, "xiaowen@dev.meritai.test");
    await send(p1.basics.id, "@xiaowen-dev");
    await send(p2.basics.id, "@XIAOWEN-DEV");
    await send(p3.basics.id, "xiaowen@dev.meritai.test");
    await joinCode(invitee.token, p2.inviteCode!);
    await testDb.project.update({ where: { id: p3.basics.id }, data: { status: "ENDED" } });

    const data = await home(invitee.token);
    expect(data.invites).toEqual([
      expect.objectContaining({ projectId: p1.basics.id, projectName: "项目一", inviterName: "陈思远", memberCount: 1, teamSize: 4 }),
    ]);
    expect(data.projects.map((p) => p.name)).toEqual(["项目二"]);
    // Someone else sees no invites.
    expect((await home((await login(2)).token)).invites).toEqual([]);
  });

  it("shows the optional demo data (SEED_DEMO=true) to the seeded people", async () => {
    expect(await seedDemo(testDb)).toBe(true);
    expect(await seedDemo(testDb)).toBe(false);
    const siyuan = await home((await login(0)).token);
    expect(siyuan.projects.map((p) => [p.name, p.status, p.memberCount])).toEqual([
      ["市场营销报告", "DRAFT", 1],
      ["校园二手市场 App", "ACTIVE", 3],
    ]);
    const bowen = await login(3);
    expect((await home(bowen.token)).invites).toEqual([expect.objectContaining({ projectName: "校园二手市场 App", inviterName: "陈思远" })]);
    const xiaowen = await login(1);
    const view = await call<ProjectView>(`/api/projects/${siyuan.projects[1]!.id}`, { token: xiaowen.token });
    expect(view.data.packages.map((p) => p.points)).toEqual([200, 200, 200, 200, 200]);
  });

  it("says who still needs a package, counts the real packages and the points earned", async () => {
    const t = await activeWith(3, { leaderManages: true });
    const idOf = (userId: string) => t.view.members.find((m) => m.userId === userId)!.id;
    const [a, b] = t.members;
    const card = async (token: string) => (await home(token)).projects[0]!;

    // Nobody has picked: the members need one, the leader who only manages never does.
    expect(await card(a!.token)).toMatchObject({ needsPackage: true, packageCount: 2, freePackages: 2, myPackageIndex: null });
    expect(await card(t.leader.token)).toMatchObject({ needsPackage: false });

    const [p1, p2] = [...t.view.packages].sort((x, y) => x.index - y.index);
    await testDb.package.update({ where: { id: p1!.id }, data: { ownerId: idOf(a!.user.id) } });
    await testDb.package.update({ where: { id: p2!.id }, data: { ownerId: idOf(b!.user.id) } });
    expect(await card(a!.token)).toMatchObject({ needsPackage: false, myPackageIndex: 1, freePackages: 0 });

    // A fourth person joins with nothing left to pick.
    const late = await person(3);
    await joinCode(late.token, t.view.inviteCode!);
    expect(await card(late.token)).toMatchObject({ needsPackage: true, freePackages: 0, memberCount: 4, teamSize: 4 });

    // Once confirmed, the count is the real number of packages (a re-split adds one), not the planned one.
    await testDb.package.create({ data: { projectId: t.projectId, index: 3 } });
    expect(await card(late.token)).toMatchObject({ packageCount: 3, freePackages: 1 });

    // Points earned by the team (a full grade → all, HALF → half).
    const [done, half] = await testDb.task.findMany({ where: { projectId: t.projectId }, orderBy: { number: "asc" } });
    await testDb.task.update({ where: { id: done!.id }, data: { status: "DONE", grade: "PASS" } });
    await testDb.task.update({ where: { id: half!.id }, data: { status: "HALF", grade: "HALF" } });
    expect((await card(t.leader.token)).earnedPoints).toBe(done!.points + Math.round(half!.points / 2));

    // An ended project hands out no packages.
    await testDb.project.update({ where: { id: t.projectId }, data: { status: "ENDED" } });
    expect(await card(late.token)).toMatchObject({ needsPackage: false });
  });
});

describe("HomeData.dueSoon (M4)", () => {
  it("lists the effective dues of my open, not-submitted tasks in ACTIVE projects: overdue ones and the next 8 days", async () => {
    const DAY = 24 * 60 * 60 * 1000;
    const tasks = Array.from({ length: 16 }, (_, i) => ({ title: `任务 ${i + 1}`, kind: "DOC" as const, points: 100 }));
    const t = await activeWith(2, { tasks });
    const member = t.members[0]!;
    await call(`/api/projects/${t.projectId}/packages/${t.view.packages[1]!.id}/pick`, { method: "POST", token: member.token });
    const me = await testDb.member.findFirstOrThrow({ where: { projectId: t.projectId, userId: member.user.id } });
    const mine = await testDb.task.findMany({ where: { ownerId: me.id }, orderBy: { number: "asc" } });
    expect(mine.length).toBeGreaterThanOrEqual(8);
    const now = Date.now();
    const due = (days: number) => new Date(now + days * DAY);
    const set = (i: number, data: Parameters<typeof testDb.task.update>[0]["data"]) => testDb.task.update({ where: { id: mine[i]!.id }, data });

    await set(0, { dueAt: due(-3) }); // TODO, overdue: counted (过期)
    await set(1, { dueAt: due(1), status: "DOING", startedAt: new Date(), startedById: me.id });
    await set(2, { dueAt: due(-1), status: "FAIL", grade: "FAIL", startedAt: new Date() }); // to redo, overdue
    await set(3, { dueAt: due(-2), status: "REVIEWING", startedAt: new Date() }); // waiting for review: not counted
    await set(4, { dueAt: due(2), status: "HALF", grade: "HALF", startedAt: new Date() }); // finished: not counted
    await set(5, { dueAt: due(3), status: "DONE", grade: "PASS", startedAt: new Date() });
    await set(6, { dueAt: due(9) }); // too far ahead
    for (let i = 7; i < mine.length; i++) await set(i, { dueAt: null }); // the deadline, weeks away

    expect((await home(member.token)).dueSoon).toEqual([due(-3), due(-1), due(1)].map((d) => d.toISOString()));
    // Someone else's tasks never show; an ended project neither.
    expect((await home(t.leader.token)).dueSoon).toEqual([]);
    await testDb.project.update({ where: { id: t.projectId }, data: { status: "ENDED" } });
    expect((await home(member.token)).dueSoon).toEqual([]);
  });
});
