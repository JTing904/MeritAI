// M6 spec §6–§7: AI review of handed-in work — the grade bands, the limits (3 per task, 30 per project), the
// good → light fallback, pacing, falling back to the leader (QUOTA, INVALID, LINKS_ONLY) with its
// notifications, overriding an AI grade, and the task's ETag when a result lands.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { NotificationPayload, ProjectView, TaskDetail } from "../../shared/types";
import { resetGoneModels } from "../src/services/ai-call";
import { projectToken } from "../src/services/cache-tokens";
import { call, testApp, testDb } from "./helpers";
import { csvFile, drain, jobsOf, mockAi, resetMock, setKey } from "./ai-fixtures";
import { detailAs, fakeFile, freshDb, gradeAs, linkEvidence, overrideAs, submitAs, taskOf, uploadEvidence, viewAs, withPackages } from "./project-fixtures";

beforeEach(async () => {
  await freshDb();
  resetMock();
  delete process.env.GEMINI_GOOD_RPD;
  delete process.env.GEMINI_GOOD_RPM;
  delete process.env.GEMINI_GOOD_CHAIN;
  resetGoneModels();
});
afterAll(() => testDb.$disconnect());

/** Three people with packages; the leader has a Gemini key. `a` owns package 2. */
async function team({ key = true } = {}) {
  const t = await withPackages(3);
  if (key) await setKey(t.leader.token);
  const a = t.members[0]!;
  return { ...t, a, aTask: taskOf(t.view, 0, 2), aTask2: taskOf(t.view, 1, 2), leaderTask: taskOf(t.view, 0, 1) };
}
type Team = Awaited<ReturnType<typeof team>>;

async function handIn(t: Team, taskId: string, file: File = csvFile("做完了")) {
  expect((await uploadEvidence(t.a.token, t.projectId, taskId, file)).status).toBe(201);
  const res = await submitAs(t.a.token, t.projectId, taskId);
  expect(res.status).toBe(200);
  return res.data;
}

const current = async (t: Team, taskId: string, token = t.a.token) => (await detailAs(token, t.projectId, taskId)).data;
const notes = (userId: string, type: NotificationPayload["type"]) => testDb.notification.findMany({ where: { userId, type }, orderBy: { createdAt: "asc" } });

describe("AI review on submit", () => {
  it("queues instead of asking the leader, then grades with the smartest good model", async () => {
    const t = await team();
    const detail = await handIn(t, t.aTask.id, csvFile("访谈 5 人 #excellent"));
    expect(detail.current).toMatchObject({ status: "PENDING", aiState: "QUEUED" });
    expect(detail.task.aiReviewing).toBe(true);
    expect(detail.aiReviewsLeftToday).toBe(2);
    expect(detail.project.ai).toMatchObject({ provider: "GEMINI", configured: true, reviewsToday: 1 });
    // Not in 待我审核 while the AI has it, and the leader isn't asked.
    expect((await viewAs(t.leader.token, t.projectId)).pendingReviews).toEqual([]);
    expect(await notes(t.leader.user.id, "SUBMITTED")).toHaveLength(0);

    await drain();
    expect(mockAi.calls().map((c) => [c.purpose, c.model])).toEqual([["grade", "gemini-3.8-flash"]]);
    const graded = await current(t, t.aTask.id);
    const attempt = graded.attempts[0]!;
    expect(attempt).toMatchObject({ status: "GRADED", grade: "EXCELLENT", gradedByAi: true, aiState: "DONE", aiProvider: "GEMINI", aiModel: "gemini-3.8-flash", gradedByMemberId: null });
    expect(attempt.gradeNote).toBeTruthy();
    expect(graded.task.status).toBe("DONE");
    const [n] = await notes(t.a.user.id, "GRADED");
    expect(n!.payload).toMatchObject({ grade: "EXCELLENT", byAi: true, reasonsCount: 0, earned: graded.task.points });
    const feed = await testDb.activityEvent.findFirstOrThrow({ where: { projectId: t.projectId, type: "GRADED" } });
    expect([feed.actorId, (feed.payload as { byAi?: boolean }).byAi]).toEqual([null, true]);
  });

  it("maps the score to the four bands, with reasons and suggestions for the low ones", async () => {
    const t = await team();
    await handIn(t, t.aTask.id, csvFile("只做了一部分 #half"));
    await handIn(t, t.aTask2.id, csvFile("#fail"));
    await drain();
    const half = (await current(t, t.aTask.id)).attempts[0]!;
    expect(half.grade).toBe("HALF");
    expect(half.aiReasons.length).toBeGreaterThanOrEqual(2);
    expect(half.aiSuggestions.length).toBeGreaterThanOrEqual(1);
    const fail = await current(t, t.aTask2.id);
    expect([fail.attempts[0]!.grade, fail.task.status]).toEqual(["FAIL", "FAIL"]);
    // A PDF the model looks at itself (no marker in text): the default PASS.
    const b = t.members[1]!;
    const bTask = taskOf(t.view, 0, 3);
    await uploadEvidence(b.token, t.projectId, bTask.id, fakeFile("r.pdf", "pdf", 200));
    await submitAs(b.token, t.projectId, bTask.id);
    await drain();
    expect((await current(t, bTask.id, b.token)).attempts[0]!.grade).toBe("PASS");
    expect(mockAi.calls().at(-1)!.text).toContain("[file r.pdf application/pdf]");
  });

  it("lets the leader override the AI's grade like their own", async () => {
    const t = await team();
    await handIn(t, t.aTask.id, csvFile("#half"));
    await drain();
    const res = await overrideAs(t.leader.token, t.projectId, t.aTask.id, "PASS", "访谈其实够了");
    expect(res.status).toBe(200);
    expect(res.data.attempts[0]).toMatchObject({ grade: "PASS", gradedByAi: true });
    expect(res.data.attempts[0]!.changes[0]).toMatchObject({ fromGrade: "HALF", toGrade: "PASS" });
  });

  it("leaves the leader's own tasks and meetings alone, and the leader can still grade first", async () => {
    const t = await team();
    await uploadEvidence(t.leader.token, t.projectId, t.leaderTask.id, csvFile("x"));
    const own = await submitAs(t.leader.token, t.projectId, t.leaderTask.id);
    expect(own.data.attempts[0]).toMatchObject({ selfGraded: true, aiState: null });

    await handIn(t, t.aTask.id, csvFile("#fail"));
    expect((await gradeAs(t.leader.token, t.projectId, t.aTask.id, "PASS")).status).toBe(200);
    await drain();
    const after = (await current(t, t.aTask.id)).attempts[0]!;
    expect([after.grade, after.gradedByAi, after.aiState]).toEqual(["PASS", false, null]);
    expect((await jobsOf(t.projectId)).at(-1)!.result).toMatchObject({ discarded: "not waiting any more" });
  });

  it("drops the job when the owner withdraws the submission", async () => {
    const t = await team();
    await handIn(t, t.aTask.id, csvFile("#fail"));
    await call(`/api/projects/${t.projectId}/tasks/${t.aTask.id}/withdraw`, { method: "POST", token: t.a.token });
    await drain();
    expect(mockAi.calls()).toHaveLength(0);
    expect((await current(t, t.aTask.id)).current).toMatchObject({ status: "DRAFT", aiState: null });
  });

  it("only links: straight to the leader (LINKS_ONLY), the server never opens them", async () => {
    const t = await team();
    expect((await linkEvidence(t.a.token, t.projectId, t.aTask.id, "https://docs.example.com/report")).status).toBe(201);
    const res = await submitAs(t.a.token, t.projectId, t.aTask.id);
    expect(res.data.current).toMatchObject({ status: "PENDING", aiState: "FAILED", aiFailReason: "LINKS_ONLY" });
    expect(await jobsOf(t.projectId)).toEqual([]);
    const review = (await viewAs(t.leader.token, t.projectId)).pendingReviews;
    expect(review.map((r) => r.aiFailReason)).toEqual(["LINKS_ONLY"]);
    const [n] = await notes(t.leader.user.id, "AI_REVIEW_FAILED");
    expect(n!.payload).toMatchObject({ reason: "LINKS_ONLY", provider: "GEMINI", taskId: t.aTask.id });
  });

  it("without a key the leader grades as before", async () => {
    const t = await team({ key: false });
    const detail = await handIn(t, t.aTask.id);
    expect(detail.current).toMatchObject({ aiState: null });
    expect(detail.aiReviewsLeftToday).toBeNull();
    expect(await notes(t.leader.user.id, "SUBMITTED")).toHaveLength(1);
  });
});

describe("limits", () => {
  async function fakeReviews(t: Team, n: number, taskId: string) {
    await testDb.aiJob.createMany({
      data: Array.from({ length: n }, (_, i) => ({ kind: "GRADE" as const, projectId: t.projectId, taskId, dedupeKey: `x${i}:${taskId}`, status: "DONE" as const })),
    });
  }

  it("3 per task per day, then the leader grades (SKIPPED, TASK_LIMIT)", async () => {
    const t = await team();
    await fakeReviews(t, 3, t.aTask.id);
    const detail = await handIn(t, t.aTask.id);
    expect(detail.current).toMatchObject({ aiState: "SKIPPED", aiFailReason: "TASK_LIMIT" });
    expect(detail.aiReviewsLeftToday).toBe(0);
    expect(await notes(t.leader.user.id, "SUBMITTED")).toHaveLength(1);
    expect((await viewAs(t.leader.token, t.projectId)).pendingReviews[0]!.aiFailReason).toBe("TASK_LIMIT");
  });

  it("30 per project per day (PROJECT_LIMIT)", async () => {
    const t = await team();
    await fakeReviews(t, 30, t.aTask2.id);
    const detail = await handIn(t, t.aTask.id);
    expect(detail.current).toMatchObject({ aiState: "SKIPPED", aiFailReason: "PROJECT_LIMIT" });
    expect((await viewAs(t.leader.token, t.projectId)).ai.reviewsToday).toBe(30);
  });

  it("walks the good chain as each model's daily limit is reached, then the light model", async () => {
    const t = await team();
    process.env.GEMINI_GOOD_CHAIN = "gemini-a,gemini-b";
    process.env.GEMINI_GOOD_RPD = "1";
    const b = t.members[1]!;
    const bTask = taskOf(t.view, 0, 3);
    await handIn(t, t.aTask.id, csvFile("#excellent"));
    await handIn(t, t.aTask2.id, csvFile("#excellent"));
    await uploadEvidence(b.token, t.projectId, bTask.id, csvFile("#excellent"));
    await submitAs(b.token, t.projectId, bTask.id);
    await drain();
    expect(mockAi.calls().map((c) => c.model)).toEqual(["gemini-a", "gemini-b", "gemini-flash-lite-latest"]);
    // Each attempt says which model graded it (the byline).
    expect((await current(t, t.aTask.id)).attempts[0]!.aiModel).toBe("gemini-a");
    expect((await current(t, t.aTask2.id)).attempts[0]!.aiModel).toBe("gemini-b");
    expect((await current(t, bTask.id, b.token)).attempts[0]).toMatchObject({ grade: "EXCELLENT", aiModel: "gemini-flash-lite-latest" });
    const me = await call<{ ai: { usageToday: { good: { used: number; limit: number }; light: { used: number }; models: { model: string; used: number }[] } } }>("/api/me", { token: t.leader.token });
    expect(me.data.ai.usageToday).toMatchObject({ good: { used: 2, limit: 2 }, light: { used: 1 } });
    expect(me.data.ai.usageToday.models.map((m) => [m.model, m.used])).toEqual([
      ["gemini-a", 1],
      ["gemini-b", 1],
      ["gemini-flash-lite-latest", 1],
    ]);
  });

  it("a 429 from one model marks it used up for the day and moves to the next", async () => {
    const t = await team();
    mockAi.failNext("QUOTA", { model: "gemini-3.8-flash" });
    await handIn(t, t.aTask.id, csvFile("#excellent"));
    await handIn(t, t.aTask2.id, csvFile("#excellent"));
    await drain();
    // 3.8 answered 429 once; both reviews then went to 3.7 without asking 3.8 again.
    expect(mockAi.calls().map((c) => c.model)).toEqual(["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.7-flash"]);
    expect((await current(t, t.aTask.id)).attempts[0]!.aiModel).toBe("gemini-3.7-flash");
    const usage = await testDb.aiUsage.findMany({ where: { userId: t.leader.user.id }, orderBy: { model: "asc" } });
    expect(usage.map((u) => [u.model, u.count])).toEqual([
      ["gemini-3.7-flash", 2],
      ["gemini-3.8-flash", 20],
    ]);
  });

  it("skips a model the provider doesn't know (404) and says so once", async () => {
    const t = await team();
    mockAi.failNext("MODEL_GONE", { model: "gemini-3.8-flash" });
    await handIn(t, t.aTask.id, csvFile("#excellent"));
    await handIn(t, t.aTask2.id, csvFile("#excellent"));
    await drain();
    expect(mockAi.calls().map((c) => c.model)).toEqual(["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.7-flash"]);
    expect((await current(t, t.aTask2.id)).attempts[0]).toMatchObject({ grade: "EXCELLENT", aiModel: "gemini-3.7-flash" });
  });

  it("paces calls per minute: the rest wait for the next window", async () => {
    const t = await team();
    process.env.GEMINI_GOOD_RPM = "1";
    await handIn(t, t.aTask.id, csvFile("#excellent"));
    await handIn(t, t.aTask2.id, csvFile("#excellent"));
    const now = new Date();
    await drain(now);
    expect(mockAi.calls()).toHaveLength(1);
    const waiting = (await jobsOf(t.projectId)).find((j) => j.status === "QUEUED")!;
    expect(waiting.tries).toBe(0);
    expect(waiting.runAfter.getTime()).toBeGreaterThan(now.getTime());
    await drain(new Date(waiting.runAfter.getTime() + 1));
    expect(mockAi.calls()).toHaveLength(2);
  });
});

describe("key problems", () => {
  it("QUOTA on every model down to light: the leader grades; AI_KEY_PROBLEM once a day, AI_REVIEW_FAILED per attempt", async () => {
    const t = await team();
    // The four good models and the light one each answer 429 once; the second review then asks nobody.
    mockAi.failNext("QUOTA", { times: 5 });
    await handIn(t, t.aTask.id);
    await handIn(t, t.aTask2.id);
    await drain();
    for (const id of [t.aTask.id, t.aTask2.id]) {
      expect((await current(t, id)).current).toMatchObject({ status: "PENDING", aiState: "FAILED", aiFailReason: "QUOTA" });
    }
    const review = (await viewAs(t.leader.token, t.projectId)).pendingReviews;
    expect(review).toHaveLength(2);
    expect(await notes(t.leader.user.id, "AI_REVIEW_FAILED")).toHaveLength(2);
    const problems = await notes(t.leader.user.id, "AI_KEY_PROBLEM");
    expect(problems).toHaveLength(1);
    expect(problems[0]!.payload).toMatchObject({ provider: "GEMINI", problem: "QUOTA" });
    expect(problems[0]!.projectId).toBeNull();
    expect(mockAi.calls()).toHaveLength(5);
    expect((await testDb.user.findUniqueOrThrow({ where: { id: t.leader.user.id } })).aiKeyStatus).toBe("QUOTA");
    // The leader grades it the usual way.
    expect((await gradeAs(t.leader.token, t.projectId, t.aTask.id, "PASS")).status).toBe(200);
  });

  it("INVALID: status INVALID (no more AI reviews until a new key), one problem notice", async () => {
    const t = await team();
    mockAi.failNext("INVALID");
    await handIn(t, t.aTask.id);
    await drain();
    expect((await current(t, t.aTask.id)).current).toMatchObject({ aiState: "FAILED", aiFailReason: "INVALID" });
    expect((await viewAs(t.a.token, t.projectId)).ai.status).toBe("INVALID");
    const next = await handIn(t, t.aTask2.id);
    expect(next.current).toMatchObject({ aiState: null });
    expect(next.aiReviewsLeftToday).toBeNull();
    expect(await notes(t.leader.user.id, "AI_KEY_PROBLEM")).toHaveLength(1);
    // A new key brings it back.
    await setKey(t.leader.token);
    expect((await viewAs(t.a.token, t.projectId)).ai.status).toBe("OK");
  });
});

describe("GET /api/projects/:id/tasks/:taskId ETag", () => {
  it("changes when the AI's grade lands", async () => {
    const t = await team();
    await handIn(t, t.aTask.id, csvFile("#half"));
    const path = `/api/projects/${t.projectId}/tasks/${t.aTask.id}`;
    const first = await testApp.request(path, { headers: { Authorization: `Bearer ${t.a.token}` } });
    const etag = first.headers.get("etag")!;
    expect((await testApp.request(path, { headers: { Authorization: `Bearer ${t.a.token}`, "If-None-Match": etag } })).status).toBe(304);
    await drain();
    const after = await testApp.request(path, { headers: { Authorization: `Bearer ${t.a.token}`, "If-None-Match": etag } });
    expect(after.status).toBe(200);
    const body = (await after.json()) as { data: TaskDetail };
    expect(body.data.attempts[0]!.grade).toBe("HALF");
    const view = await call<ProjectView>(`/api/projects/${t.projectId}`, { token: t.a.token });
    expect(view.data.tasks.find((x) => x.id === t.aTask.id)!.status).toBe("HALF");
  });

  it("the project token moves when the key's usage day resets (today's review count starts again)", async () => {
    const t = await team();
    const user = await testDb.user.findUniqueOrThrow({ where: { id: t.a.user.id } });
    const now = new Date("2026-09-23T06:00:00Z");
    const before = await projectToken(testDb, t.projectId, user, now);
    expect(await projectToken(testDb, t.projectId, user, new Date("2026-09-23T06:50:00Z"))).toBe(before);
    // 07:00 UTC = midnight Pacific (Gemini's reset).
    expect(await projectToken(testDb, t.projectId, user, new Date("2026-09-23T07:10:00Z"))).not.toBe(before);
  });
});
