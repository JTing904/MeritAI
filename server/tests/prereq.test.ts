// 前置任务 (M4 spec §2, §8): setting / clearing what a task waits for, WAITING_ON_YOU, and PREREQ_DONE when
// the prerequisite becomes finished (notifyPrereqDone, driven here through recomputeTask on attempt rows).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { NotificationPayload, TaskDetail } from "../../shared/types";
import type { ActivityType } from "../src/generated/prisma/client";
import { addAttempt, gradedAttempt, recompute } from "./attempt-rows";
import { call, testDb } from "./helpers";
import { createDraft, freshDb, person, taskOf, withPackages, type ActiveTeam } from "./project-fixtures";

beforeEach(freshDb);
afterAll(() => testDb.$disconnect());

const setPrereq = (token: string, projectId: string, taskId: string, prereqTaskId: string | null) =>
  call<TaskDetail>(`/api/projects/${projectId}/tasks/${taskId}/prereq`, { method: "PUT", token, body: { prereqTaskId } });
const notificationsOf = (userId: string, type: NotificationPayload["type"]) =>
  testDb.notification.findMany({ where: { userId, type }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
const allOf = (type: NotificationPayload["type"]) => testDb.notification.findMany({ where: { type } });
const eventsOf = (projectId: string, type: ActivityType) =>
  testDb.activityEvent.findMany({ where: { projectId, type }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });

/** 陈思远 leads 「任务包 1」, 林晓雯 「任务包 2」 (the prerequisite), 王子杰 「任务包 3」 (the waiting task). */
async function setup() {
  const t = await withPackages(3);
  const [lin, wang] = t.members as [ActiveTeam["leader"], ActiveTeam["leader"]];
  const id = (userId: string) => t.view.members.find((m) => m.userId === userId)!.id;
  return {
    t,
    lin,
    wang,
    leaderId: id(t.leader.user.id),
    linId: id(lin.user.id),
    wangId: id(wang.user.id),
    prereq: taskOf(t.view, 0, 2),
    task: taskOf(t.view, 0, 3),
  };
}

describe("PUT /api/projects/:id/tasks/:taskId/prereq", () => {
  it("set by the waiter: the prerequisite's owner and the leader hear it, the feed shows it", async () => {
    const { t, lin, wang, linId, wangId, prereq, task } = await setup();
    const res = await setPrereq(wang.token, t.projectId, task.id, prereq.id);
    expect(res.status).toBe(200);
    expect(res.data.prereq).toMatchObject({ taskId: prereq.id, ownerMemberId: linId, ownerName: "林晓雯", finished: false });
    expect(res.data.task.prereqTaskId).toBe(prereq.id);

    const payload = {
      type: "WAITING_ON_YOU",
      waitingTaskId: task.id,
      waitingTitle: task.title,
      prereqTaskId: prereq.id,
      prereqTitle: prereq.title,
      waiter: { memberId: wangId, name: "王子杰" },
      prereqOwner: { memberId: linId, name: "林晓雯" },
      setBy: { memberId: wangId, name: "王子杰" },
    };
    const toOwner = await notificationsOf(lin.user.id, "WAITING_ON_YOU");
    expect(toOwner).toHaveLength(1);
    expect(toOwner[0]).toMatchObject({ projectId: t.projectId, audience: "YOU_AND_LEADER", mine: true });
    expect(toOwner[0]!.payload).toEqual({ ...payload, forLeader: false });
    const toLeader = await notificationsOf(t.leader.user.id, "WAITING_ON_YOU");
    expect(toLeader).toHaveLength(1);
    expect(toLeader[0]).toMatchObject({ audience: "YOU_AND_LEADER" });
    expect(toLeader[0]!.payload).toEqual({ ...payload, forLeader: true });
    expect(await notificationsOf(wang.user.id, "WAITING_ON_YOU")).toEqual([]);

    const events = await eventsOf(t.projectId, "PREREQ_SET");
    expect(events.map((e) => [e.actorId, e.payload])).toEqual([
      [
        wangId,
        {
          type: "PREREQ_SET",
          taskId: task.id,
          title: task.title,
          prereqTaskId: prereq.id,
          prereqTitle: prereq.title,
          prereqOwner: { memberId: linId, name: "林晓雯" },
          cleared: false,
        },
      ],
    ]);
  });

  it("set by the leader: only the prerequisite's owner hears it (ONLY_YOU)", async () => {
    const { t, lin, wang, leaderId, prereq, task } = await setup();
    expect((await setPrereq(t.leader.token, t.projectId, task.id, prereq.id)).status).toBe(200);
    const told = await notificationsOf(lin.user.id, "WAITING_ON_YOU");
    expect(told).toHaveLength(1);
    expect(told[0]).toMatchObject({ audience: "ONLY_YOU" });
    expect(told[0]!.payload).toMatchObject({ setBy: { memberId: leaderId, name: "陈思远" }, forLeader: false });
    expect(await notificationsOf(t.leader.user.id, "WAITING_ON_YOU")).toEqual([]);
    expect(await notificationsOf(wang.user.id, "WAITING_ON_YOU")).toEqual([]);
  });

  it("sends the leader one ONLY_YOU when the leader owns the prerequisite", async () => {
    const { t, wang, task } = await setup();
    const leaders = taskOf(t.view, 0, 1);
    expect((await setPrereq(wang.token, t.projectId, task.id, leaders.id)).status).toBe(200);
    const told = await notificationsOf(t.leader.user.id, "WAITING_ON_YOU");
    expect(told).toHaveLength(1);
    expect(told[0]).toMatchObject({ audience: "ONLY_YOU" });
    expect(told[0]!.payload).toMatchObject({ forLeader: false, prereqOwner: { name: "陈思远" } });
    expect(await allOf("WAITING_ON_YOU")).toHaveLength(1);
  });

  it("tells nobody who is inactive; a prerequisite nobody owns tells the leader only", async () => {
    const { t, lin, wang, linId, prereq, task } = await setup();
    await testDb.member.update({ where: { id: linId }, data: { leftAt: new Date() } });
    expect((await setPrereq(wang.token, t.projectId, task.id, prereq.id)).status).toBe(200);
    expect(await notificationsOf(lin.user.id, "WAITING_ON_YOU")).toEqual([]);
    const toLeader = await notificationsOf(t.leader.user.id, "WAITING_ON_YOU");
    expect(toLeader).toHaveLength(1);
    expect(toLeader[0]).toMatchObject({ audience: "ONLY_YOU" });

    const other = taskOf(t.view, 1, 2);
    await testDb.task.update({ where: { id: other.id }, data: { ownerId: null } });
    const second = taskOf(t.view, 1, 3);
    expect((await setPrereq(wang.token, t.projectId, second.id, other.id)).status).toBe(200);
    const again = await notificationsOf(t.leader.user.id, "WAITING_ON_YOU");
    expect(again).toHaveLength(2);
    expect(again[1]!.payload).toMatchObject({ prereqOwner: null, forLeader: true });
  });

  it("clears it with a feed entry and no notification; setting the same one again changes nothing", async () => {
    const { t, wang, wangId, prereq, task } = await setup();
    await setPrereq(wang.token, t.projectId, task.id, prereq.id);
    const again = await setPrereq(wang.token, t.projectId, task.id, prereq.id);
    expect(again.status).toBe(200);
    expect(await allOf("WAITING_ON_YOU")).toHaveLength(2);
    expect(await eventsOf(t.projectId, "PREREQ_SET")).toHaveLength(1);

    const res = await setPrereq(wang.token, t.projectId, task.id, null);
    expect(res.status).toBe(200);
    expect(res.data.prereq).toBeNull();
    expect((await testDb.task.findUniqueOrThrow({ where: { id: task.id } })).prereqTaskId).toBeNull();
    expect(await allOf("WAITING_ON_YOU")).toHaveLength(2);
    const events = await eventsOf(t.projectId, "PREREQ_SET");
    expect(events).toHaveLength(2);
    expect(events[1]!.actorId).toBe(wangId);
    expect(events[1]!.payload).toEqual({
      type: "PREREQ_SET",
      taskId: task.id,
      title: task.title,
      prereqTaskId: null,
      prereqTitle: null,
      prereqOwner: null,
      cleared: true,
    });
    // Clearing nothing is a no-op.
    await setPrereq(wang.token, t.projectId, task.id, null);
    expect(await eventsOf(t.projectId, "PREREQ_SET")).toHaveLength(2);
  });

  it("refuses another project's task (404), itself (PREREQ_SELF) and a finished task, HALF under re-review too (PREREQ_FINISHED)", async () => {
    const { t, wang, prereq, task } = await setup();
    const zhang = await person(3);
    const draft = await createDraft(zhang.token, { teamSize: 2 });
    await call(`/api/projects/${draft.basics.id}/tasks`, { method: "PUT", token: zhang.token, body: { tasks: [{ title: "别的", kind: "DOC", points: 1000 }] } });
    const foreign = await testDb.task.findFirstOrThrow({ where: { projectId: draft.basics.id } });
    expect((await setPrereq(wang.token, t.projectId, task.id, foreign.id)).status).toBe(404);
    expect((await setPrereq(wang.token, t.projectId, task.id, "nope")).status).toBe(404);

    const self = await setPrereq(wang.token, t.projectId, task.id, task.id);
    expect([self.status, self.error?.code]).toEqual([400, "PREREQ_SELF"]);

    await gradedAttempt(prereq.id, 1, "PASS");
    const done = await setPrereq(wang.token, t.projectId, task.id, prereq.id);
    expect([done.status, done.error?.code]).toEqual([409, "PREREQ_FINISHED"]);

    const half = taskOf(t.view, 1, 2);
    await gradedAttempt(half.id, 1, "HALF");
    await addAttempt(half.id, { no: 2, status: "PENDING", links: 1 });
    await recompute(half.id);
    expect((await testDb.task.findUniqueOrThrow({ where: { id: half.id } })).status).toBe("REVIEWING");
    const reviewing = await setPrereq(wang.token, t.projectId, task.id, half.id);
    expect([reviewing.status, reviewing.error?.code]).toEqual([409, "PREREQ_FINISHED"]);

    // FAIL isn't finished: that one may be waited for.
    const failed = taskOf(t.view, 0, 1);
    await gradedAttempt(failed.id, 1, "FAIL");
    expect((await setPrereq(wang.token, t.projectId, task.id, failed.id)).status).toBe(200);
    expect(await testDb.notification.count({ where: { type: "WAITING_ON_YOU" } })).toBe(1);
  });

  it("refuses two tasks waiting for each other (PREREQ_CYCLE) and changes nothing", async () => {
    const { t, lin, wang, prereq, task } = await setup();
    expect((await setPrereq(wang.token, t.projectId, task.id, prereq.id)).status).toBe(200);
    const notesBefore = await testDb.notification.count();

    const back = await setPrereq(lin.token, t.projectId, prereq.id, task.id);
    expect([back.status, back.error?.code]).toEqual([409, "PREREQ_CYCLE"]);
    const byLeader = await setPrereq(t.leader.token, t.projectId, prereq.id, task.id);
    expect([byLeader.status, byLeader.error?.code]).toEqual([409, "PREREQ_CYCLE"]);
    expect((await testDb.task.findUniqueOrThrow({ where: { id: prereq.id } })).prereqTaskId).toBeNull();
    expect(await testDb.notification.count()).toBe(notesBefore);
    expect(await eventsOf(t.projectId, "PREREQ_SET")).toHaveLength(1);

    // Once the first one stops waiting, the other way round is fine.
    expect((await setPrereq(wang.token, t.projectId, task.id, null)).status).toBe(200);
    expect((await setPrereq(lin.token, t.projectId, prereq.id, task.id)).status).toBe(200);
  });

  it("refuses a longer loop (A → B → C → A) but allows the chain itself", async () => {
    const { t, lin, wang, prereq, task } = await setup();
    const leaders = taskOf(t.view, 0, 1);
    // 王子杰's task waits for 林晓雯's, which waits for the leader's: a chain, no loop.
    expect((await setPrereq(wang.token, t.projectId, task.id, prereq.id)).status).toBe(200);
    expect((await setPrereq(lin.token, t.projectId, prereq.id, leaders.id)).status).toBe(200);

    const loop = await setPrereq(t.leader.token, t.projectId, leaders.id, task.id);
    expect([loop.status, loop.error?.code]).toEqual([409, "PREREQ_CYCLE"]);
    expect((await testDb.task.findUniqueOrThrow({ where: { id: leaders.id } })).prereqTaskId).toBeNull();
    // Changing a link inside the chain to point back up it is a loop too.
    const inner = await setPrereq(lin.token, t.projectId, prereq.id, task.id);
    expect([inner.status, inner.error?.code]).toEqual([409, "PREREQ_CYCLE"]);
    expect((await testDb.task.findUniqueOrThrow({ where: { id: prereq.id } })).prereqTaskId).toBe(leaders.id);
    // Waiting for another task nobody in the chain waits on is fine.
    expect((await setPrereq(t.leader.token, t.projectId, leaders.id, taskOf(t.view, 1, 2).id)).status).toBe(200);
  });

  it("is for the task's owner or the leader: another member gets 403, an outsider 404", async () => {
    const { t, lin, prereq, task } = await setup();
    const res = await setPrereq(lin.token, t.projectId, task.id, prereq.id);
    expect([res.status, res.error?.code]).toEqual([403, "FORBIDDEN"]);
    const outsider = await person(5);
    expect((await setPrereq(outsider.token, t.projectId, task.id, prereq.id)).status).toBe(404);
    expect((await testDb.task.findUniqueOrThrow({ where: { id: task.id } })).prereqTaskId).toBeNull();
  });
});

describe("notifyPrereqDone (a prerequisite becomes finished)", () => {
  /** Tasks of 王子杰 and the leader wait for 林晓雯's task. */
  async function waiting() {
    const s = await setup();
    const leaders = taskOf(s.t.view, 0, 1);
    await testDb.task.updateMany({ where: { id: { in: [s.task.id, leaders.id] } }, data: { prereqTaskId: s.prereq.id } });
    return { ...s, leaders };
  }

  const prereqDone = (userId: string) => notificationsOf(userId, "PREREQ_DONE");

  it("tells the owner of every unfinished waiting task, never the actor", async () => {
    const { t, lin, wang, prereq, task } = await waiting();
    // The leader grades: the leader's own waiting task gets nothing (they acted).
    const res = await gradedAttempt(prereq.id, 1, "PASS", { actorUserId: t.leader.user.id });
    expect(res.becameFinished).toBe(true);

    const told = await prereqDone(wang.user.id);
    expect(told).toHaveLength(1);
    expect(told[0]).toMatchObject({ projectId: t.projectId, audience: "ONLY_YOU" });
    expect(told[0]!.payload).toEqual({
      type: "PREREQ_DONE",
      prereqTaskId: prereq.id,
      prereqTitle: prereq.title,
      waitingTaskId: task.id,
      waitingTitle: task.title,
    });
    expect(await prereqDone(t.leader.user.id)).toEqual([]);
    expect(await prereqDone(lin.user.id)).toEqual([]);
  });

  it("skips waiting tasks that are finished and owners who left", async () => {
    const { t, wang, prereq, task, leaders } = await waiting();
    await gradedAttempt(task.id, 1, "HALF");
    // Graded by 林晓雯's own meeting-done, say: the leader's waiting task hears it.
    await gradedAttempt(prereq.id, 1, "SELF", { actorUserId: wang.user.id });
    expect(await prereqDone(wang.user.id)).toEqual([]);
    const toLeader = await prereqDone(t.leader.user.id);
    expect(toLeader.map((n) => (n.payload as { waitingTaskId: string }).waitingTaskId)).toEqual([leaders.id]);

    // An inactive owner of an unfinished waiting task: nothing.
    const again = await waiting();
    await testDb.member.update({ where: { id: again.wangId }, data: { leftAt: new Date() } });
    await gradedAttempt(again.prereq.id, 1, "PASS", { actorUserId: again.lin.user.id });
    expect(await prereqDone(again.wang.user.id)).toEqual([]);
  });

  it("sends nothing new when a HALF task's re-review is graded PASS, but again after an override down to FAIL and back up", async () => {
    const { t, wang, prereq } = await waiting();
    const leaderUser = t.leader.user.id;
    const first = await gradedAttempt(prereq.id, 1, "HALF", { actorUserId: leaderUser });
    expect(first.becameFinished).toBe(true);
    expect(await prereqDone(wang.user.id)).toHaveLength(1);

    // Resubmitted, then graded PASS: it was finished all along.
    const second = await addAttempt(prereq.id, { no: 2, status: "PENDING", links: 1 });
    expect((await recompute(prereq.id, leaderUser)).becameFinished).toBe(false);
    await testDb.attempt.update({ where: { id: second.id }, data: { status: "GRADED", grade: "PASS", gradedAt: new Date() } });
    const pass = await recompute(prereq.id, leaderUser);
    expect([pass.after.status, pass.becameFinished]).toEqual(["DONE", false]);
    expect(await prereqDone(wang.user.id)).toHaveLength(1);

    // Overridden down to FAIL (both attempts): unfinished; nobody is un-notified.
    for (const a of [first.attempt, second]) {
      const from = (await testDb.attempt.findUniqueOrThrow({ where: { id: a.id } })).grade!;
      await testDb.gradeChange.create({ data: { attemptId: a.id, fromGrade: from, toGrade: "FAIL", reason: "抄袭" } });
      await testDb.attempt.update({ where: { id: a.id }, data: { grade: "FAIL" } });
    }
    const down = await recompute(prereq.id, leaderUser);
    expect([down.after.status, down.becameFinished]).toEqual(["FAIL", false]);
    expect(await prereqDone(wang.user.id)).toHaveLength(1);

    // Raised again: finished again, so the waiters hear it again.
    await testDb.attempt.update({ where: { id: second.id }, data: { grade: "PASS" } });
    const up = await recompute(prereq.id, leaderUser);
    expect(up.becameFinished).toBe(true);
    expect(await prereqDone(wang.user.id)).toHaveLength(2);
  });
});
