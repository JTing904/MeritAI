// Re-split (重新分包, spec §5): the plan, the preview and applying it.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { LoginResult, NotificationPayload, ProjectView, ResplitPreview } from "../../shared/types";
import { AppError } from "../src/lib/errors";
import { planResplit, unavoidableSpread, type ResplitState } from "../src/services/resplit";
import { call, testDb } from "./helpers";
import { activeWith, devStatus, freshDb, joinCode, person, pickAs, startAs } from "./project-fixtures";

beforeEach(freshDb);
afterAll(() => testDb.$disconnect());

const HOUR = 60 * 60 * 1000;

const packagesOf = (projectId: string) => testDb.package.findMany({ where: { projectId }, orderBy: { index: "asc" } });
const tasksIn = (packageId: string) => testDb.task.findMany({ where: { packageId }, orderBy: { number: "asc" } });
const projectRow = (id: string) => testDb.project.findUniqueOrThrow({ where: { id } });
const notificationsOf = (userId: string, type?: NotificationPayload["type"]) =>
  testDb.notification.findMany({ where: { userId, ...(type ? { type } : {}) }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
const memberId = async (projectId: string, p: LoginResult) =>
  (await testDb.member.findFirstOrThrow({ where: { projectId, userId: p.user.id } })).id;

const preview = (token: string, projectId: string, count: number) =>
  call<ResplitPreview>(`/api/projects/${projectId}/resplit/preview`, { method: "POST", token, body: { count } });
const apply = (token: string, projectId: string, count: number, version: number) =>
  call<ProjectView>(`/api/projects/${projectId}/resplit`, { method: "POST", token, body: { count, version } });

async function totals(projectId: string) {
  const pkgs = await packagesOf(projectId);
  const tasks = await testDb.task.findMany({ where: { projectId } });
  return pkgs.map((p) => tasks.filter((t) => t.packageId === p.id).reduce((s, t) => s + t.points, 0));
}

// ─── planResplit (pure) ──────────────────────────────────────────────────────

type TaskRow = ResplitState["tasks"][number];
let seq = 0;
function task(packageId: string | null, points: number, over: Partial<TaskRow> = {}): TaskRow {
  seq += 1;
  return {
    id: `t${seq}`,
    title: `任务 ${seq}`,
    packageId,
    ownerId: null,
    status: "TODO",
    startedAt: null,
    points,
    order: seq,
    number: seq,
    featureId: null,
    ...over,
  };
}
const member = (role: "LEADER" | "MEMBER" = "MEMBER") => ({ role, leftAt: null, removed: false });
const slotOf = (plan: ReturnType<typeof planResplit>, taskId: string) => plan.slots.findIndex((s) => s.taskIds.includes(taskId));
const failure = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    return err as AppError;
  }
  throw new Error("expected a failure");
};

describe("planResplit", () => {
  it("drops the highest-numbered free packages without locked tasks first, then renumbers in order", () => {
    const state: ResplitState = {
      project: { leaderManages: false },
      members: [member("LEADER"), member()],
      packages: [
        { id: "p1", index: 1, ownerId: "m1" },
        { id: "p2", index: 2, ownerId: null },
        { id: "p3", index: 3, ownerId: "m2" },
        { id: "p4", index: 4, ownerId: null },
        { id: "p5", index: 5, ownerId: null },
      ],
      tasks: [
        task("p1", 200, { ownerId: "m1" }),
        task("p2", 200),
        task("p3", 200, { ownerId: "m2" }),
        task("p4", 200),
        task("p5", 200, { status: "FAIL" }),
      ],
    };
    const four = planResplit(state, 4);
    expect(four.range).toEqual({ min: 3, max: 8 });
    expect(four.slots.map((s) => [s.packageId, s.oldIndex, s.index, s.ownerId])).toEqual([
      ["p1", 1, 1, "m1"],
      ["p2", 2, 2, null],
      ["p3", 3, 3, "m2"],
      ["p5", 5, 4, null],
    ]);
    expect(four.removed).toEqual([{ packageId: "p4", oldIndex: 4, before: 200 }]);

    const three = planResplit(state, 3);
    expect(three.slots.map((s) => [s.packageId, s.index])).toEqual([
      ["p1", 1],
      ["p3", 2],
      ["p5", 3],
    ]);
    expect(three.removed.map((r) => r.packageId)).toEqual(["p2", "p4"]);
    expect(three.lockedTasks.map((t) => t.title)).toEqual([state.tasks[4]!.title]);
    // Every point ends up somewhere: 1000 in, 1000 out.
    expect(three.slots.reduce((s, x) => s + x.after, 0)).toBe(1000);
    expect(three.slots[2]!.after).toBeGreaterThanOrEqual(200);
  });

  it("adds new free packages at the end", () => {
    const state: ResplitState = {
      project: { leaderManages: false },
      members: [member("LEADER"), member()],
      packages: [
        { id: "p1", index: 1, ownerId: "m1" },
        { id: "p2", index: 2, ownerId: "m2" },
      ],
      tasks: [task("p1", 250, { ownerId: "m1" }), task("p1", 250, { ownerId: "m1" }), task("p2", 250), task("p2", 250)],
    };
    const plan = planResplit(state, 4);
    expect(plan.slots.map((s) => [s.packageId, s.oldIndex, s.index, s.before, s.after])).toEqual([
      ["p1", 1, 1, 500, 250],
      ["p2", 2, 2, 500, 250],
      [null, null, 3, null, 250],
      [null, null, 4, null, 250],
    ]);
    expect(plan.removed).toEqual([]);
  });

  it("keeps feature groups whole next to one heavy package of started work", () => {
    const state: ResplitState = {
      project: { leaderManages: false },
      members: [member("LEADER"), member(), member()],
      packages: [
        { id: "p1", index: 1, ownerId: "m1" },
        { id: "p2", index: 2, ownerId: "m2" },
        { id: "p3", index: 3, ownerId: "m3" },
      ],
      tasks: [
        task("p1", 300, { ownerId: "m1", status: "DOING", startedAt: new Date() }),
        task("p1", 200, { ownerId: "m1", status: "DONE", startedAt: new Date() }),
        task("p2", 150, { featureId: "f1" }),
        task("p3", 100, { featureId: "f1" }),
        task("p3", 150, { featureId: "f2" }),
        task("p2", 100, { featureId: "f2" }),
      ],
    };
    const plan = planResplit(state, 3);
    expect(plan.slots.map((s) => s.after)).toEqual([500, 250, 250]);
    expect(plan.slots[0]!.taskIds).toEqual([]);
    const slotOf = (id: string) => plan.slots.findIndex((s) => s.taskIds.includes(id));
    const [, , f1a, f1b, f2a, f2b] = state.tasks;
    expect(slotOf(f1a!.id)).toBe(slotOf(f1b!.id));
    expect(slotOf(f2a!.id)).toBe(slotOf(f2b!.id));
    expect(slotOf(f1a!.id)).not.toBe(slotOf(f2a!.id));
    expect(plan.lockedTasks.map((t) => t.ownerMemberId)).toEqual(["m1", "m1"]);
  });

  it("keeps feature groups whole when a heavy package puts 2.0 分 out of reach", () => {
    const state: ResplitState = {
      project: { leaderManages: false },
      members: [member("LEADER"), member(), member()],
      packages: [
        { id: "p1", index: 1, ownerId: "m1" },
        { id: "p2", index: 2, ownerId: "m2" },
        { id: "p3", index: 3, ownerId: "m3" },
      ],
      tasks: [
        task("p1", 350, { ownerId: "m1", status: "DOING", startedAt: new Date() }),
        task("p2", 110, { featureId: "f1" }),
        task("p2", 200, { featureId: "f1" }),
        task("p3", 120, { featureId: "f2" }),
        task("p3", 220, { featureId: "f2" }),
      ],
    };
    // No placement gets closer than 2.5 分 (350 against 650 shared by two), so 2.5 + 2.0 is fine:
    // whole groups come out 4.0 apart instead of both being split for 3.0.
    const plan = planResplit(state, 3);
    const [, f1a, f1b, f2a, f2b] = state.tasks;
    expect(slotOf(plan, f1a!.id)).toBe(slotOf(plan, f1b!.id));
    expect(slotOf(plan, f2a!.id)).toBe(slotOf(plan, f2b!.id));
    expect(slotOf(plan, f1a!.id)).not.toBe(slotOf(plan, f2a!.id));
    expect(plan.slots[0]!.taskIds).toEqual([]);
    expect([...plan.slots.map((s) => s.after)].sort((a, b) => b - a)).toEqual([350, 340, 310]);
  });

  it("still breaks a feature group when that is what reaches 2.0 分", () => {
    const state: ResplitState = {
      project: { leaderManages: false },
      members: [member("LEADER"), member()],
      packages: [
        { id: "p1", index: 1, ownerId: "m1" },
        { id: "p2", index: 2, ownerId: "m2" },
      ],
      tasks: [
        task("p1", 150, { ownerId: "m1", status: "DOING", startedAt: new Date() }),
        ...Array.from({ length: 20 }, (_, i) => task(i < 10 ? "p1" : "p2", 25, { featureId: "f1" })),
        task("p2", 300),
      ],
    };
    // Kept whole, the group leaves the packages 5.0 apart; split, they come out even.
    const plan = planResplit(state, 2);
    expect(plan.slots.map((s) => s.after)).toEqual([475, 475]);
    const f1 = state.tasks.filter((t) => t.featureId === "f1").map((t) => slotOf(plan, t.id));
    expect(new Set(f1).size).toBe(2);
  });

  it("refuses counts outside the range: at least one per member who holds one, at most 8 (7 when the leader only manages)", () => {
    const state: ResplitState = {
      project: { leaderManages: true },
      members: [member("LEADER"), member(), member(), { role: "MEMBER", leftAt: new Date(), removed: false }],
      packages: [{ id: "p1", index: 1, ownerId: null }],
      tasks: [task("p1", 1000)],
    };
    expect(planResplit(state, 2).range).toEqual({ min: 2, max: 7 });
    expect(failure(() => planResplit(state, 1)).code).toBe("VALIDATION");
    expect(failure(() => planResplit(state, 8)).status).toBe(400);
    expect(planResplit({ ...state, project: { leaderManages: false } }, 8).slots).toHaveLength(8);
  });
});

describe("unavoidableSpread", () => {
  it("is the heaviest preload minus the level the new points can fill the others to", () => {
    expect(unavoidableSpread([350, 0, 0], 650)).toBe(25);
    expect(unavoidableSpread([500, 0, 0], 500)).toBe(250);
    expect(unavoidableSpread([100, 50, 0], 30)).toBe(70);
    expect(unavoidableSpread([350, 0, 0], 0)).toBe(350);
  });

  it("is 0 when the points can even everything out", () => {
    expect(unavoidableSpread([0, 0, 0], 900)).toBe(0);
    expect(unavoidableSpread([100, 0], 200)).toBe(0);
    expect(unavoidableSpread([150, 0], 400)).toBe(0);
    expect(unavoidableSpread([], 100)).toBe(0);
  });
});

// ─── POST /resplit/preview and /resplit ──────────────────────────────────────

/** Three people who each picked their package (leader 1, A 2, B 3) and a fourth, 张博文, who joined late. */
async function lateJoiner() {
  const t = await activeWith(3);
  const [a, b] = t.members;
  const late = await person(3);
  await joinCode(late.token, t.view.inviteCode!);
  await pickAs(t.leader.token, t.projectId, 1);
  await pickAs(a!.token, t.projectId, 2);
  await pickAs(b!.token, t.projectId, 3);
  return { ...t, a: a!, b: b!, late };
}

describe("re-split", () => {
  it("does what the preview showed: a new free package for the member without one", async () => {
    const t = await lateJoiner();
    const pv = await preview(t.leader.token, t.projectId, 4);
    expect(pv.status).toBe(200);
    const before = await projectRow(t.projectId);
    expect(pv.data).toMatchObject({ version: before.packagesVersion, count: 4, range: { min: 4, max: 8 }, lockedTasks: [] });
    const pkgs = await packagesOf(t.projectId);
    const was = await totals(t.projectId);
    expect(pv.data.rows.map((r) => [r.packageId, r.oldIndex, r.index, r.ownerMemberId, r.before])).toEqual([
      [pkgs[0]!.id, 1, 1, pkgs[0]!.ownerId, was[0]],
      [pkgs[1]!.id, 2, 2, pkgs[1]!.ownerId, was[1]],
      [pkgs[2]!.id, 3, 3, pkgs[2]!.ownerId, was[2]],
      [null, null, 4, null, null],
    ]);
    // Nothing changed yet.
    expect(await packagesOf(t.projectId)).toHaveLength(3);

    const res = await apply(t.leader.token, t.projectId, 4, pv.data.version);
    expect(res.status).toBe(200);
    const after = await packagesOf(t.projectId);
    expect(after.map((p) => p.index)).toEqual([1, 2, 3, 4]);
    expect(after.slice(0, 3).map((p) => p.id)).toEqual(pkgs.map((p) => p.id));
    expect(after[3]!.ownerId).toBeNull();
    expect(await totals(t.projectId)).toEqual(pv.data.rows.map((r) => r.after));
    expect((await totals(t.projectId)).reduce((s, x) => s + x, 0)).toBe(1000);
    for (const p of after) {
      expect((await tasksIn(p.id)).every((x) => x.ownerId === p.ownerId)).toBe(true);
    }
    const project = await projectRow(t.projectId);
    expect(project.teamSize).toBe(4);
    expect(project.packagesVersion).toBe(before.packagesVersion + 1);

    const lateId = await memberId(t.projectId, t.late);
    const aId = await memberId(t.projectId, t.a);
    expect((await notificationsOf(t.late.user.id, "RESPLIT")).map((n) => [n.audience, n.mine, n.payload])).toEqual([
      ["GROUP", true, { type: "RESPLIT", package: null, freePackages: 1, packageCount: 4 }],
    ]);
    expect((await notificationsOf(t.a.user.id, "RESPLIT")).map((n) => n.payload)).toEqual([
      { type: "RESPLIT", package: { index: 2, oldIndex: null, points: pv.data.rows[1]!.after }, freePackages: 1, packageCount: 4 },
    ]);
    expect(await notificationsOf(t.leader.user.id, "RESPLIT")).toHaveLength(0);
    const events = await testDb.activityEvent.findMany({ where: { projectId: t.projectId, type: "RESPLIT" } });
    expect(events.map((e) => e.payload)).toEqual([{ type: "RESPLIT", packageCount: 4 }]);
    expect(aId).not.toBe(lateId);

    // The late joiner can now pick the new package.
    expect((await pickAs(t.late.token, t.projectId, 4)).status).toBe(200);
  });

  it("leaves started and finished tasks where they are", async () => {
    const t = await lateJoiner();
    const pkgs = await packagesOf(t.projectId);
    const [aTask] = await tasksIn(pkgs[1]!.id);
    const [bTask] = await tasksIn(pkgs[2]!.id);
    await startAs(t.a.token, t.projectId, aTask!.id);
    await devStatus(t.b.token, bTask!.id, "DONE");

    const pv = await preview(t.leader.token, t.projectId, 4);
    const [aId, bId] = [await memberId(t.projectId, t.a), await memberId(t.projectId, t.b)];
    expect(pv.data.lockedTasks).toHaveLength(2);
    expect(pv.data.lockedTasks).toEqual(
      expect.arrayContaining([
        { id: aTask!.id, title: aTask!.title, ownerMemberId: aId },
        { id: bTask!.id, title: bTask!.title, ownerMemberId: bId },
      ]),
    );
    expect((await apply(t.leader.token, t.projectId, 4, pv.data.version)).status).toBe(200);
    expect(await testDb.task.findUniqueOrThrow({ where: { id: aTask!.id } })).toMatchObject({
      packageId: pkgs[1]!.id,
      ownerId: aId,
      status: "DOING",
    });
    expect(await testDb.task.findUniqueOrThrow({ where: { id: bTask!.id } })).toMatchObject({
      packageId: pkgs[2]!.id,
      ownerId: bId,
      status: "DONE",
    });
    expect(await totals(t.projectId)).toEqual(pv.data.rows.map((r) => r.after));
  });

  it("removes free packages and renumbers the rest; owners hear their new number", async () => {
    const tasks = Array.from({ length: 10 }, (_, i) => ({ title: `任务 ${i + 1}`, kind: "DOC" as const, points: 100 }));
    const t = await activeWith(3, { teamSize: 5, tasks });
    const [a, b] = t.members;
    await pickAs(t.leader.token, t.projectId, 1);
    await pickAs(a!.token, t.projectId, 3);
    await pickAs(b!.token, t.projectId, 5);
    const pkgs = await packagesOf(t.projectId);
    // Package 4 holds work someone handed back (FAIL, nobody's): it must stay.
    const [kept] = await tasksIn(pkgs[3]!.id);
    await testDb.task.update({ where: { id: kept!.id }, data: { status: "FAIL" } });

    const tooFew = await preview(t.leader.token, t.projectId, 3);
    expect([tooFew.status, tooFew.error!.code]).toEqual([400, "VALIDATION"]);
    const pv = await preview(t.leader.token, t.projectId, 4);
    expect(pv.data.range).toEqual({ min: 4, max: 8 });
    expect(pv.data.rows.map((r) => [r.packageId, r.oldIndex, r.index, r.after === null])).toEqual([
      [pkgs[0]!.id, 1, 1, false],
      [pkgs[2]!.id, 3, 2, false],
      [pkgs[3]!.id, 4, 3, false],
      [pkgs[4]!.id, 5, 4, false],
      [pkgs[1]!.id, 2, null, true],
    ]);

    expect((await apply(t.leader.token, t.projectId, 4, pv.data.version)).status).toBe(200);
    const after = await packagesOf(t.projectId);
    expect(after.map((p) => [p.id, p.index])).toEqual([
      [pkgs[0]!.id, 1],
      [pkgs[2]!.id, 2],
      [pkgs[3]!.id, 3],
      [pkgs[4]!.id, 4],
    ]);
    expect(await testDb.package.findUnique({ where: { id: pkgs[1]!.id } })).toBeNull();
    expect(await testDb.task.findUniqueOrThrow({ where: { id: kept!.id } })).toMatchObject({ packageId: pkgs[3]!.id });
    expect(await testDb.task.count({ where: { projectId: t.projectId, packageId: null } })).toBe(0);
    expect(await totals(t.projectId)).toEqual(pv.data.rows.slice(0, 4).map((r) => r.after));
    expect((await projectRow(t.projectId)).teamSize).toBe(4);

    const payload = async (p: LoginResult) => (await notificationsOf(p.user.id, "RESPLIT")).map((n) => n.payload);
    expect(await payload(a!)).toEqual([
      { type: "RESPLIT", package: { index: 2, oldIndex: 3, points: pv.data.rows[1]!.after }, freePackages: 1, packageCount: 4 },
    ]);
    expect(await payload(b!)).toEqual([
      { type: "RESPLIT", package: { index: 4, oldIndex: 5, points: pv.data.rows[3]!.after }, freePackages: 1, packageCount: 4 },
    ]);
  });

  it("refuses a stale preview: preview → someone starts → apply", async () => {
    const t = await lateJoiner();
    const pv = await preview(t.leader.token, t.projectId, 4);
    const [aTask] = await tasksIn((await packagesOf(t.projectId))[1]!.id);
    await startAs(t.a.token, t.projectId, aTask!.id);

    const res = await apply(t.leader.token, t.projectId, 4, pv.data.version);
    expect([res.status, res.error!.code]).toEqual([409, "STALE_PREVIEW"]);
    expect(await packagesOf(t.projectId)).toHaveLength(3);

    const fresh = await preview(t.leader.token, t.projectId, 4);
    expect(fresh.data.version).toBeGreaterThan(pv.data.version);
    expect((await apply(t.leader.token, t.projectId, 4, fresh.data.version)).status).toBe(200);
  });

  it("ends every pending swap without SWAP_VOID (the RESPLIT notice covers it)", async () => {
    const t = await lateJoiner();
    const pkgs = await packagesOf(t.projectId);
    const [leaderId, aId, bId] = await Promise.all([t.leader, t.a, t.b].map((p) => memberId(t.projectId, p)));
    const now = Date.now();
    const swap = (requesterId: string, targetId: string, from: string, to: string) =>
      testDb.swapRequest.create({
        data: {
          projectId: t.projectId,
          requesterId,
          targetId,
          requesterPackageId: from,
          targetPackageId: to,
          createdAt: new Date(now - HOUR),
          expiresAt: new Date(now + 71 * HOUR),
        },
      });
    const one = await swap(aId!, bId!, pkgs[1]!.id, pkgs[2]!.id);
    const two = await swap(bId!, leaderId!, pkgs[2]!.id, pkgs[0]!.id);

    const pv = await preview(t.leader.token, t.projectId, 4);
    expect((await apply(t.leader.token, t.projectId, 4, pv.data.version)).status).toBe(200);
    for (const s of [one, two]) {
      expect(await testDb.swapRequest.findUniqueOrThrow({ where: { id: s.id } })).toMatchObject({
        status: "VOID",
        voidReason: "RESPLIT",
        voidedById: leaderId,
      });
    }
    expect(await testDb.notification.count({ where: { type: "SWAP_VOID" } })).toBe(0);
  });

  it("is for the leader only, within the range; a leader who only manages hears nothing and counts in teamSize", async () => {
    const t = await activeWith(3, { leaderManages: true });
    const [a, b] = t.members;
    expect((await preview(a!.token, t.projectId, 2)).status).toBe(403);
    expect((await apply(a!.token, t.projectId, 2, 0)).status).toBe(403);
    expect((await preview(t.leader.token, t.projectId, 8)).status).toBe(400);
    expect((await preview((await person(5)).token, t.projectId, 3)).status).toBe(404);

    const pv = await preview(t.leader.token, t.projectId, 7);
    expect(pv.data.range).toEqual({ min: 2, max: 7 });
    expect((await apply(t.leader.token, t.projectId, 7, pv.data.version)).status).toBe(200);
    expect(await packagesOf(t.projectId)).toHaveLength(7);
    expect((await projectRow(t.projectId)).teamSize).toBe(8);
    expect(await notificationsOf(t.leader.user.id, "RESPLIT")).toHaveLength(0);
    for (const p of [a!, b!]) {
      expect((await notificationsOf(p.user.id, "RESPLIT")).map((n) => n.payload)).toEqual([
        { type: "RESPLIT", package: null, freePackages: 7, packageCount: 7 },
      ]);
    }
  });
});
