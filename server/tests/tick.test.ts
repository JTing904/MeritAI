// The reminders tick (M5 spec §1, §2): each job with an injected `now`, the dedupe keys, the tick
// endpoint, the time machine and two ticks at once.
import { afterEach, afterAll, beforeEach, describe, expect, it } from "vitest";
import type { NotificationPayload, ProjectView, TickResult, TimeMachineState } from "../../shared/types";
import { clock } from "../src/lib/clock";
import { zonedTime, wallClock } from "../src/lib/plan/dates";
import {
  expireAllSwaps,
  remindBlocked,
  remindDueSoon,
  remindOverdue,
  roastTemplate,
  runTick,
  sendWeekly,
  weeklyKey,
} from "../src/services/tick";
import { call, testDb } from "./helpers";
import { activeWith, DAY, finishTask, freshDb, KL, linkEvidence, submitAs, taskOf, withPackages } from "./project-fixtures";

beforeEach(freshDb);
afterEach(() => clock.setOffset(0));
afterAll(() => testDb.$disconnect());

const HOUR = 60 * 60 * 1000;
type Kind = NotificationPayload["type"];

const notes = (type: Kind, extra: Record<string, unknown> = {}) =>
  testDb.notification.findMany({ where: { type, ...extra }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
const payloadOf = <T extends Kind>(n: { payload: unknown }) => n.payload as Extract<NotificationPayload, { type: T }>;
const setDue = (taskId: string, dueAt: Date | null) => testDb.task.update({ where: { id: taskId }, data: { dueAt } });
const memberId = (view: ProjectView, userId: string) => view.members.find((m) => m.userId === userId)!.id;

describe("due soon (TASK_DUE_SOON, TASK_DUE_REVIEW, TASK_OWNERLESS_SOON)", () => {
  it("reminds the owner once, and again after a later due date or another owner", async () => {
    const t = await withPackages(3);
    const [a, b] = t.members;
    const task = taskOf(t.view, 0, 2);
    const now = new Date();
    await setDue(task.id, new Date(now.getTime() + 10 * HOUR));

    expect(await remindDueSoon(testDb, now)).toBe(1);
    const [first] = await notes("TASK_DUE_SOON");
    expect(first).toMatchObject({ userId: a!.user.id, audience: "ONLY_YOU", mine: true, projectId: t.projectId });
    expect(payloadOf<"TASK_DUE_SOON">(first!)).toEqual({
      type: "TASK_DUE_SOON",
      taskId: task.id,
      title: task.title,
      dueAt: new Date(now.getTime() + 10 * HOUR).toISOString(),
      timezone: KL,
    });
    // The next ticks: nothing new.
    expect(await remindDueSoon(testDb, now)).toBe(0);
    expect(await remindDueSoon(testDb, new Date(now.getTime() + HOUR))).toBe(0);

    // A later due date re-arms it.
    await setDue(task.id, new Date(now.getTime() + 20 * HOUR));
    expect(await remindDueSoon(testDb, now)).toBe(1);

    // Another owner gets their own reminder.
    const pkg3 = t.view.packages.find((p) => p.index === 3)!;
    const moved = await call(`/api/projects/${t.projectId}/tasks/${task.id}/move`, { method: "POST", token: t.leader.token, body: { packageId: pkg3.id } });
    expect(moved.status).toBe(200);
    expect(await remindDueSoon(testDb, now)).toBe(1);
    expect((await notes("TASK_DUE_SOON")).map((n) => n.userId).sort()).toEqual([a!.user.id, a!.user.id, b!.user.id].sort());
  });

  it("reminds right away when a task gets due within 24 h (5 h left), and not with less than 1 h left", async () => {
    const t = await withPackages(3);
    const now = new Date();
    const soon = taskOf(t.view, 0, 2);
    const tooLate = taskOf(t.view, 1, 2);
    await setDue(soon.id, new Date(now.getTime() + 5 * HOUR));
    await setDue(tooLate.id, new Date(now.getTime() + 59 * 60 * 1000));
    expect(await remindDueSoon(testDb, now)).toBe(1);
    expect((await notes("TASK_DUE_SOON")).map((n) => payloadOf<"TASK_DUE_SOON">(n).taskId)).toEqual([soon.id]);
    // More than 24 h away: not yet.
    await setDue(tooLate.id, new Date(now.getTime() + 25 * HOUR));
    expect(await remindDueSoon(testDb, now)).toBe(0);
  });

  it("tells the leader instead when it was handed in (not for the leader's own task)", async () => {
    const t = await withPackages(3);
    const [a] = t.members;
    const now = new Date();
    const aTask = taskOf(t.view, 0, 2);
    const leaderTask = taskOf(t.view, 0, 1);
    await setDue(aTask.id, new Date(now.getTime() + 12 * HOUR));
    await setDue(leaderTask.id, new Date(now.getTime() + 12 * HOUR));
    expect((await linkEvidence(a!.token, t.projectId, aTask.id, "https://example.com/report")).status).toBe(201);
    expect((await submitAs(a!.token, t.projectId, aTask.id)).status).toBe(200);
    await testDb.task.update({ where: { id: leaderTask.id }, data: { status: "REVIEWING" } });

    expect(await remindDueSoon(testDb, now)).toBe(1);
    expect(await notes("TASK_DUE_SOON")).toEqual([]);
    const [review] = await notes("TASK_DUE_REVIEW");
    expect(review).toMatchObject({ userId: t.leader.user.id, audience: "ONLY_LEADER" });
    expect(payloadOf<"TASK_DUE_REVIEW">(review!)).toMatchObject({
      taskId: aTask.id,
      owner: { memberId: memberId(t.view, a!.user.id), name: "林晓雯" },
    });
    expect(await remindDueSoon(testDb, now)).toBe(0);
  });

  it("tells the leader about a task nobody owns", async () => {
    const t = await activeWith(3);
    const now = new Date();
    const task = t.view.tasks[0]!;
    await setDue(task.id, new Date(now.getTime() + 3 * HOUR));
    expect(await remindDueSoon(testDb, now)).toBe(1);
    const [n] = await notes("TASK_OWNERLESS_SOON");
    expect(n).toMatchObject({ userId: t.leader.user.id, audience: "ONLY_LEADER" });
    expect(payloadOf<"TASK_OWNERLESS_SOON">(n!).taskId).toBe(task.id);

    // Assigned now: the new owner hears it at the next tick.
    const [a] = t.members;
    const pkg = t.view.packages.find((p) => p.taskIds.includes(task.id))!;
    const assigned = await call(`/api/projects/${t.projectId}/packages/${pkg.id}/assign`, {
      method: "POST",
      token: t.leader.token,
      body: { memberId: memberId(t.view, a!.user.id) },
    });
    expect(assigned.status).toBe(200);
    expect(await remindDueSoon(testDb, now)).toBe(1);
    expect((await notes("TASK_DUE_SOON"))[0]).toMatchObject({ userId: a!.user.id });
  });

  it("skips finished tasks, drafts' and deleted projects, and projects past their deadline", async () => {
    const t = await withPackages(3);
    const now = new Date();
    const [done, other] = [taskOf(t.view, 0, 2), taskOf(t.view, 0, 3)];
    await setDue(done.id, new Date(now.getTime() + 5 * HOUR));
    await finishTask(done.id, "PASS");
    await setDue(other.id, new Date(now.getTime() + 5 * HOUR));
    await testDb.project.update({ where: { id: t.projectId }, data: { deletedAt: now, purgeAfter: new Date(now.getTime() + 7 * DAY) } });
    expect(await remindDueSoon(testDb, now)).toBe(0);
    await testDb.project.update({ where: { id: t.projectId }, data: { deletedAt: null, purgeAfter: null, status: "AWAITING_CONFIRM" } });
    expect(await remindDueSoon(testDb, now)).toBe(0);
    await testDb.project.update({ where: { id: t.projectId }, data: { status: "ACTIVE" } });
    expect(await remindDueSoon(testDb, now)).toBe(1);
  });
});

describe("overdue (TASK_OVERDUE, TASK_OWNERLESS_OVERDUE)", () => {
  it("roasts the owner to the whole group once; the owner's copy is 「跟我有关」", async () => {
    const t = await withPackages(3);
    const [a] = t.members;
    const now = new Date();
    const task = taskOf(t.view, 0, 2);
    const due = new Date(now.getTime() - HOUR);
    await setDue(task.id, due);

    expect(await remindOverdue(testDb, now)).toBe(3);
    const rows = await notes("TASK_OVERDUE");
    expect(rows.map((n) => [n.userId, n.mine, n.audience]).sort()).toEqual(
      [
        [t.leader.user.id, false, "GROUP"],
        [a!.user.id, true, "GROUP"],
        [t.members[1]!.user.id, false, "GROUP"],
      ].sort(),
    );
    expect(payloadOf<"TASK_OVERDUE">(rows[0]!)).toEqual({
      type: "TASK_OVERDUE",
      taskId: task.id,
      title: task.title,
      dueAt: due.toISOString(),
      owner: { memberId: memberId(t.view, a!.user.id), name: "林晓雯" },
      template: roastTemplate(task.id),
      waitingFor: null,
    });
    expect(await remindOverdue(testDb, new Date(now.getTime() + 10 * 60 * 1000))).toBe(0);

    // Another due date (earlier or later) is a new reminder.
    await setDue(task.id, new Date(now.getTime() - 2 * HOUR));
    expect(await remindOverdue(testDb, now)).toBe(3);
  });

  it("says what the task waits for, skips tasks handed in, and names nobody when nobody owns it", async () => {
    const t = await withPackages(3);
    const [a, b] = t.members;
    const now = new Date();
    const waiting = taskOf(t.view, 0, 2);
    const prereq = taskOf(t.view, 0, 3);
    const handedIn = taskOf(t.view, 1, 2);
    await testDb.task.update({ where: { id: waiting.id }, data: { prereqTaskId: prereq.id, dueAt: new Date(now.getTime() - HOUR) } });
    await setDue(prereq.id, new Date(now.getTime() + 3 * DAY));
    await setDue(handedIn.id, new Date(now.getTime() - HOUR));
    await testDb.task.update({ where: { id: handedIn.id }, data: { status: "REVIEWING" } });

    expect(await remindOverdue(testDb, now)).toBe(3);
    const [n] = await notes("TASK_OVERDUE", { userId: a!.user.id });
    expect(payloadOf<"TASK_OVERDUE">(n!)).toMatchObject({
      taskId: waiting.id,
      waitingFor: { taskId: prereq.id, title: prereq.title, owner: { memberId: memberId(t.view, b!.user.id), name: "王子杰" } },
    });

    // B leaves: B's unfinished task has nobody now.
    expect((await call(`/api/projects/${t.projectId}/leave`, { method: "POST", token: b!.token })).status).toBe(200);
    await setDue(prereq.id, new Date(now.getTime() - HOUR));
    expect(await remindOverdue(testDb, now)).toBe(2);
    const ownerless = await notes("TASK_OWNERLESS_OVERDUE");
    expect(ownerless.map((x) => [x.userId, x.mine]).sort()).toEqual([[t.leader.user.id, true], [a!.user.id, false]].sort());
    expect(payloadOf<"TASK_OWNERLESS_OVERDUE">(ownerless[0]!)).toMatchObject({ taskId: prereq.id });
  });

  it("keeps one roast line per task (template 0-4, a stable hash of the id)", () => {
    const ids = Array.from({ length: 40 }, (_, i) => `cmtask${i}x${i * 7}`);
    const picks = ids.map(roastTemplate);
    expect(ids.map(roastTemplate)).toEqual(picks);
    expect(picks.every((p) => Number.isInteger(p) && p >= 0 && p < 5)).toBe(true);
    expect(new Set(picks).size).toBeGreaterThan(1);
  });

  it("doesn't dig up tasks overdue for more than 7 days", async () => {
    const t = await withPackages(2);
    const now = new Date();
    await setDue(taskOf(t.view, 0, 2).id, new Date(now.getTime() - 8 * DAY));
    expect(await remindOverdue(testDb, now)).toBe(0);
  });
});

describe("blocked by a prerequisite (PREREQ_BLOCKED)", () => {
  it("tells the leader once the prerequisite is 3 days past its due", async () => {
    const t = await withPackages(3);
    const [a, b] = t.members;
    const now = new Date();
    const waiting = taskOf(t.view, 0, 2);
    const prereq = taskOf(t.view, 0, 3);
    const prereqDue = new Date(now.getTime() - 3 * DAY - HOUR);
    await testDb.task.update({ where: { id: waiting.id }, data: { prereqTaskId: prereq.id, dueAt: new Date(now.getTime() + 2 * DAY) } });
    await setDue(prereq.id, new Date(now.getTime() - 2 * DAY));
    expect(await remindBlocked(testDb, now)).toBe(0);

    await setDue(prereq.id, prereqDue);
    expect(await remindBlocked(testDb, now)).toBe(1);
    const [n] = await notes("PREREQ_BLOCKED");
    expect(n).toMatchObject({ userId: t.leader.user.id, audience: "ONLY_LEADER" });
    const project = await testDb.project.findUniqueOrThrow({ where: { id: t.projectId } });
    expect(payloadOf<"PREREQ_BLOCKED">(n!)).toEqual({
      type: "PREREQ_BLOCKED",
      waitingTaskId: waiting.id,
      waitingTitle: waiting.title,
      waitingOwner: { memberId: memberId(t.view, a!.user.id), name: "林晓雯" },
      waitingDueAt: new Date(now.getTime() + 2 * DAY).toISOString(),
      prereqTaskId: prereq.id,
      prereqTitle: prereq.title,
      prereqOwner: { memberId: memberId(t.view, b!.user.id), name: "王子杰" },
      prereqDueAt: prereqDue.toISOString(),
      blockedDays: 3,
      projectDeadline: project.deadline.toISOString(),
      awaitingGrade: false,
    });
    expect(await remindBlocked(testDb, new Date(now.getTime() + DAY))).toBe(0);

    // Finished prerequisite: nothing more.
    await setDue(prereq.id, new Date(now.getTime() - 4 * DAY));
    await finishTask(prereq.id, "PASS");
    expect(await remindBlocked(testDb, now)).toBe(0);
  });

  it("asks the leader to grade a prerequisite that is handed in, instead of offering a delay", async () => {
    const t = await withPackages(3);
    const [, b] = t.members;
    const now = new Date();
    const waiting = taskOf(t.view, 0, 2);
    const prereq = taskOf(t.view, 0, 3);
    await testDb.task.update({ where: { id: waiting.id }, data: { prereqTaskId: prereq.id, dueAt: new Date(now.getTime() + 2 * DAY) } });
    await linkEvidence(b!.token, t.projectId, prereq.id, "https://example.com/done");
    await submitAs(b!.token, t.projectId, prereq.id);
    await setDue(prereq.id, new Date(now.getTime() - 3 * DAY - HOUR));

    expect(await remindBlocked(testDb, now)).toBe(1);
    const [n] = await notes("PREREQ_BLOCKED");
    expect(n).toMatchObject({ userId: t.leader.user.id, audience: "ONLY_LEADER" });
    expect(payloadOf<"PREREQ_BLOCKED">(n!)).toMatchObject({ prereqTaskId: prereq.id, awaitingGrade: true, blockedDays: 3 });
    expect(await remindBlocked(testDb, new Date(now.getTime() + DAY))).toBe(0);
  });

  it("skips a waiting task that is handed in, and prerequisites more than 14 days late", async () => {
    const t = await withPackages(3);
    const [a] = t.members;
    const now = new Date();
    const waiting = taskOf(t.view, 0, 2);
    const prereq = taskOf(t.view, 0, 3);
    await testDb.task.update({ where: { id: waiting.id }, data: { prereqTaskId: prereq.id, dueAt: new Date(now.getTime() + 2 * DAY) } });

    await setDue(prereq.id, new Date(now.getTime() - 15 * DAY));
    expect(await remindBlocked(testDb, now)).toBe(0);

    await setDue(prereq.id, new Date(now.getTime() - 4 * DAY));
    await linkEvidence(a!.token, t.projectId, waiting.id, "https://example.com/mine");
    await submitAs(a!.token, t.projectId, waiting.id);
    expect(await remindBlocked(testDb, now)).toBe(0);
  });
});

describe("weekly summary (WEEKLY_SUMMARY)", () => {
  it("is due from Sunday 20:00 in the project's zone until that Sunday ends", () => {
    // Asia/Kuala_Lumpur (UTC+8, no DST): Sunday 2026-09-27.
    expect(weeklyKey("p", new Date("2026-09-27T11:59:00Z"), KL)).toBeNull();
    expect(weeklyKey("p", new Date("2026-09-27T12:00:00Z"), KL)).toBe("weekly:p:2026-09-27");
    expect(weeklyKey("p", new Date("2026-09-27T15:59:00Z"), KL)).toBe("weekly:p:2026-09-27");
    expect(weeklyKey("p", new Date("2026-09-27T16:00:00Z"), KL)).toBeNull(); // Monday 00:00 there
    expect(weeklyKey("p", new Date("2026-09-26T12:00:00Z"), KL)).toBeNull(); // Saturday
    // Europe/London in summer time (UTC+1)…
    const LON = "Europe/London";
    expect(weeklyKey("p", new Date("2026-07-05T18:59:00Z"), LON)).toBeNull();
    expect(weeklyKey("p", new Date("2026-07-05T19:00:00Z"), LON)).toBe("weekly:p:2026-07-05");
    // …and on the Sunday the clocks go back (2026-10-25, GMT from 02:00): 20:00 is 20:00 UTC.
    expect(weeklyKey("p", new Date("2026-10-25T19:30:00Z"), LON)).toBeNull();
    expect(weeklyKey("p", new Date("2026-10-25T20:00:00Z"), LON)).toBe("weekly:p:2026-10-25");
    // New York in winter (UTC−5): still Sunday there late in the UTC Monday.
    expect(weeklyKey("p", new Date("2026-12-07T01:00:00Z"), "America/New_York")).toBe("weekly:p:2026-12-06");
  });

  it("sends each member who wants it one summary per Sunday, with the week's numbers", async () => {
    const t = await withPackages(3, { timezone: "Europe/London" });
    const [a, b] = t.members;
    const tz = "Europe/London";
    // The next Sunday in London, 20:00 local.
    let probe = new Date(Date.now() + DAY);
    while (new Date(Date.UTC(wallClock(probe, tz).year, wallClock(probe, tz).month - 1, wallClock(probe, tz).day)).getUTCDay() !== 0) {
      probe = new Date(probe.getTime() + DAY);
    }
    const w = wallClock(probe, tz);
    const at = zonedTime(w.year, w.month, w.day, 20, 0, tz);

    // This week: A finished a task (full points) and B one at half; one of B's is overdue; one of A's is due next week.
    const [aDone, aNext] = [taskOf(t.view, 0, 2), taskOf(t.view, 1, 2)];
    const [bHalf, bLate] = [taskOf(t.view, 0, 3), taskOf(t.view, 1, 3)];
    await finishTask(aDone.id, "PASS", new Date(at.getTime() - 2 * DAY));
    await finishTask(bHalf.id, "HALF", new Date(at.getTime() - 3 * DAY));
    await setDue(bLate.id, new Date(at.getTime() - DAY));
    await setDue(aNext.id, new Date(at.getTime() + 3 * DAY));
    // An old one doesn't count as this week's.
    await finishTask(taskOf(t.view, 0, 1).id, "PASS", new Date(at.getTime() - 9 * DAY));
    await testDb.user.update({ where: { id: b!.user.id }, data: { weeklyEnabled: false } });

    expect(await sendWeekly(testDb, new Date(at.getTime() - 60 * 1000))).toBe(0);
    expect(await sendWeekly(testDb, at)).toBe(2);
    expect(await sendWeekly(testDb, new Date(at.getTime() + 30 * 60 * 1000))).toBe(0);
    const rows = await notes("WEEKLY_SUMMARY");
    expect(rows.map((n) => n.userId).sort()).toEqual([t.leader.user.id, a!.user.id].sort());
    expect(rows[0]).toMatchObject({ audience: "GROUP", mine: false });
    const tasks = await testDb.task.findMany({ where: { projectId: t.projectId } });
    const pts = (id: string) => tasks.find((x) => x.id === id)!.points;
    expect(payloadOf<"WEEKLY_SUMMARY">(rows[0]!)).toEqual({
      type: "WEEKLY_SUMMARY",
      weekEnding: `${w.year}-${String(w.month).padStart(2, "0")}-${String(w.day).padStart(2, "0")}`,
      finishedCount: 2,
      finishedPoints: pts(aDone.id) + Math.round(pts(bHalf.id) / 2),
      totalPoints: pts(aDone.id) + Math.round(pts(bHalf.id) / 2) + pts(taskOf(t.view, 0, 1).id),
      overdueCount: 1,
      dueNextWeekCount: 1,
      top: { member: { memberId: memberId(t.view, a!.user.id), name: "林晓雯" }, points: pts(aDone.id) },
    });

    // The next Sunday is a new one, even without progress; an ENDED project gets none.
    expect(await sendWeekly(testDb, new Date(at.getTime() + 7 * DAY))).toBe(2);
    await testDb.project.update({ where: { id: t.projectId }, data: { status: "ENDED" } });
    expect(await sendWeekly(testDb, new Date(at.getTime() + 14 * DAY))).toBe(0);
  });
});

describe("swaps in the tick", () => {
  it("expires pending swaps past their 72 hours", async () => {
    const t = await withPackages(3);
    const [a] = t.members;
    const pkg3 = t.view.packages.find((p) => p.index === 3)!;
    expect((await call(`/api/projects/${t.projectId}/swaps`, { method: "POST", token: a!.token, body: { packageId: pkg3.id } })).status).toBe(200);
    expect(await expireAllSwaps(testDb, new Date(Date.now() + 71 * HOUR))).toBe(0);
    expect(await expireAllSwaps(testDb, new Date(Date.now() + 73 * HOUR))).toBe(1);
    expect(await notes("SWAP_EXPIRED")).toHaveLength(1);
  });
});

describe("runTick", () => {
  it("sends each reminder once when two ticks run at the same time", async () => {
    const t = await withPackages(3);
    const now = new Date();
    await setDue(taskOf(t.view, 0, 2).id, new Date(now.getTime() + 5 * HOUR));
    await setDue(taskOf(t.view, 0, 3).id, new Date(now.getTime() - HOUR));
    const other = await withPackages(2, { shortCode: "OTHER" });
    await setDue(taskOf(other.view, 0, 2).id, new Date(now.getTime() + 6 * HOUR));

    const results = await Promise.all([runTick(testDb, now), runTick(testDb, now), runTick(testDb, now)]);
    expect(results.every((r) => r.errors === 0)).toBe(true);
    expect(results.reduce((sum, r) => sum + r.dueSoon, 0)).toBe(2);
    expect(results.reduce((sum, r) => sum + r.overdue, 0)).toBe(3);
    expect(await notes("TASK_DUE_SOON")).toHaveLength(2);
    expect(await notes("TASK_OVERDUE")).toHaveLength(3);
    expect(await testDb.reminderLog.count({ where: { NOT: { key: { startsWith: "weekly:" } } } })).toBe(3);
    // And again later: nothing new.
    const again = await runTick(testDb, now);
    expect([again.dueSoon, again.overdue]).toEqual([0, 0]);
  });
});

describe("POST /api/internal/tick", () => {
  const saved = process.env.CRON_SECRET;
  afterEach(() => {
    if (saved === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = saved;
  });

  it("doesn't exist without CRON_SECRET and needs the secret as a bearer token", async () => {
    delete process.env.CRON_SECRET;
    expect((await call("/api/internal/tick", { method: "POST", headers: { Authorization: "Bearer x" } })).status).toBe(404);

    process.env.CRON_SECRET = "tick-secret-for-tests";
    expect((await call("/api/internal/tick", { method: "POST" })).status).toBe(401);
    expect((await call("/api/internal/tick", { method: "POST", headers: { Authorization: "Bearer wrong" } })).status).toBe(401);
    const res = await call<TickResult>("/api/internal/tick", { method: "POST", headers: { Authorization: "Bearer tick-secret-for-tests" } });
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({ dueSoon: 0, overdue: 0, projectsDue: 0, purged: 0, errors: 0 });
    // Not a GET.
    expect((await call("/api/internal/tick", { headers: { Authorization: "Bearer tick-secret-for-tests" } })).status).toBe(404);
  });
});

describe("the time machine (/api/dev/time-machine)", () => {
  it("moves the server clock and runs a tick at the new time", async () => {
    const t = await withPackages(2);
    const task = taskOf(t.view, 0, 2);
    await setDue(task.id, new Date(Date.now() + 30 * HOUR));

    const before = await call<TimeMachineState>("/api/dev/time-machine");
    expect(before.data).toMatchObject({ offsetMs: 0, tick: null });

    const moved = await call<TimeMachineState>("/api/dev/time-machine", { method: "POST", body: { advanceMs: 10 * HOUR } });
    expect(moved.status).toBe(200);
    expect(moved.data.offsetMs).toBe(10 * HOUR);
    expect(new Date(moved.data.now).getTime() - new Date(moved.data.realNow).getTime()).toBeGreaterThanOrEqual(10 * HOUR - 1000);
    expect(moved.data.tick).toMatchObject({ dueSoon: 1, errors: 0 });
    // The routes see the new time: the task is due in ~20 h, and a day later it is overdue.
    await call("/api/dev/time-machine", { method: "POST", body: { advanceMs: DAY } });
    const detail = await call<{ task: { overdue: boolean } }>(`/api/projects/${t.projectId}/tasks/${task.id}`, { token: t.members[0]!.token });
    expect(detail.data.task.overdue).toBe(true);

    expect((await call<TimeMachineState>("/api/dev/time-machine", { method: "POST", body: { offsetMs: 5 } })).data.offsetMs).toBe(5);
    expect((await call<TimeMachineState>("/api/dev/time-machine", { method: "POST", body: { reset: true } })).data.offsetMs).toBe(0);
    expect((await call("/api/dev/time-machine", { method: "POST", body: { offsetMs: 500 * DAY } })).status).toBe(400);
    expect((await call("/api/dev/time-machine", { method: "POST", body: { offsetMs: 1, reset: true } })).status).toBe(400);
  });

  it("is only there behind the dev gate", async () => {
    const saved = { DEV_LOGIN: process.env.DEV_LOGIN, APP_ENV: process.env.APP_ENV };
    try {
      process.env.DEV_LOGIN = "false";
      expect((await call("/api/dev/time-machine")).status).toBe(404);
      expect((await call("/api/dev/time-machine", { method: "POST", body: { reset: true } })).status).toBe(404);
      expect(() => clock.setOffset(1000)).toThrow();
      process.env.DEV_LOGIN = "true";
      process.env.APP_ENV = "production";
      expect((await call("/api/dev/time-machine")).status).toBe(404);
      expect(() => clock.setOffset(1000)).toThrow();
    } finally {
      process.env.DEV_LOGIN = saved.DEV_LOGIN;
      process.env.APP_ENV = saved.APP_ENV;
    }
    expect(clock.offsetMs()).toBe(0);
  });
});
