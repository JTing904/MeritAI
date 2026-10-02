// M6 spec §3–§4: the AI reads the brief in a background job (success, failure, retry, stale lease, the
// free-rules fallback), the 选择题 in the draft (counts, confirm), and the draft's ETag.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { BriefResult, DraftView, ProjectView } from "../../shared/types";
import { BACKOFF_MS } from "../src/services/ai-jobs";
import { call, testApp, testDb } from "./helpers";
import { drain, jobsOf, mockAi, resetMock, setKey } from "./ai-fixtures";
import { createDraft, fakeFile, freshDb, login, upload } from "./project-fixtures";

beforeEach(async () => {
  await freshDb();
  resetMock();
});
afterAll(() => testDb.$disconnect());

const BRIEF = [
  "1. 市场调研报告",
  "2. 从 5 个二手平台中任选 2 个做案例分析",
  "3. 从 Waterfall、Agile、RAD 中选一种开发流程",
  "4. 登录 API",
  "5. 聊天 API",
].join("\n");

async function aiDraft() {
  const leader = await login(0);
  await setKey(leader.token);
  const draft = await createDraft(leader.token);
  return { leader, id: draft.basics.id };
}

const typed = (token: string, id: string, text = BRIEF) => call<BriefResult>(`/api/projects/${id}/brief`, { method: "POST", token, body: { text } });
const draftOf = (token: string, id: string) => call<DraftView>(`/api/projects/${id}/draft`, { token });

describe("POST /api/projects/:id/brief with a key", () => {
  it("saves the brief, runs the AI in a job, and fills the plan with its answer", async () => {
    const { leader, id } = await aiDraft();
    const res = await typed(leader.token, id);
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({ ok: true, source: "AI", method: "AI" });
    const running = res.data.ok ? res.data.draft : null;
    expect(running?.analysis).toMatchObject({ status: "running", provider: "GEMINI", error: null });
    expect(running?.analysis?.steps.map((s) => `${s.key}:${s.state}`)).toEqual(["READ:done", "TASKS:running", "CHOICES:waiting", "ESTIMATE:waiting"]);
    expect(running?.tasks).toEqual([]);

    expect(await drain()).toBe(1);
    // The good chain answers. 9 tasks (with the recommended options) for 5 packages is too coarse (< 10), so
    // it is asked once more; the mock answers the same, so the first answer stays. Option labels in English
    // ("Carousell") get one light repair call, which keeps product names as they are.
    expect(mockAi.calls().map((c) => [c.purpose, c.tier, c.model])).toEqual([
      ["brief", "good", "gemini-3.8-flash"],
      ["brief", "good", "gemini-3.8-flash"],
      ["brief-fix", "light", "gemini-flash-lite-latest"],
    ]);
    expect(mockAi.calls()[1]!.text).toContain("至少拆成 10 个");
    const done = (await draftOf(leader.token, id)).data;
    expect(done.analysis).toMatchObject({ status: "done", taskCount: 4, questionCount: 2 });
    expect(done.basics.planSource).toBe("AI");
    expect(done.basics.draftStep).toBe(4);
    // The meeting first, then the brief's own tasks; the choice tasks only once picked.
    expect(done.tasks.map((t) => [t.title, t.kind])).toEqual([
      ["一起定好接口和数据格式", "MEETING"],
      ["市场调研报告", "RESEARCH"],
      ["登录 API", "CODE"],
      ["聊天 API", "CODE"],
    ]);
    // 登录 waits for the meeting; 聊天 waits for 登录 (a prerequisite between two code features is what keeps the meeting).
    const [meeting, , login, chat] = done.tasks;
    expect([login!.prereqTaskId, chat!.prereqTaskId]).toEqual([meeting!.id, login!.id]);
    const rows = await testDb.task.findMany({ where: { projectId: id }, include: { checklist: true }, omit: { briefExcerpt: false }, orderBy: { order: "asc" } });
    expect(rows.every((r) => r.howto.length >= 2 && r.howtoByAi && r.checklistByAi && r.checklist.length >= 2)).toBe(true);
    // 作业要求（原文）: the lines the model pointed at (typed text is kept and quoted too).
    expect(rows[1]!.briefExcerpt).toBe("1. 市场调研报告");
    expect([rows[1]!.briefFrom, rows[1]!.briefTo]).toEqual([0, 1]);

    expect(done.questions.map((q) => [q.type, q.pickCount, q.options.length, q.options.filter((o) => o.recommended).length])).toEqual([
      ["PICK_N", 2, 5, 2],
      ["METHOD", 1, 3, 1],
    ]);
    expect(done.questions[0]!.options[0]).toMatchObject({ key: "A", label: "Carousell", taskCount: 2, picked: false, lockedBy: null });
  });

  it("gives the AI a photo brief as a file (the rules can't read it)", async () => {
    const { leader, id } = await aiDraft();
    const res = await upload(`/api/projects/${id}/brief`, leader.token, fakeFile("作业.png", "png", 400));
    expect(res.data).toMatchObject({ ok: true, source: "AI" });
    const row = await testDb.project.findUniqueOrThrow({ where: { id } });
    expect(row.briefFileKey).toMatch(new RegExp(`^${id}/brief/[a-z0-9]+\\.png$`));
    expect(row.briefFileMime).toBe("image/png");
    await drain();
    expect(mockAi.calls()[0]!.text).toContain("[file 作业.png image/png]");
    expect((await draftOf(leader.token, id)).data.analysis?.status).toBe("done");
  });

  it("uses the free rules without a key", async () => {
    const leader = await login(0);
    const draft = await createDraft(leader.token);
    const res = await typed(leader.token, draft.basics.id);
    expect(res.data).toMatchObject({ ok: true, source: "RULES" });
    expect((await draftOf(leader.token, draft.basics.id)).data.analysis).toBeNull();
    expect(await jobsOf(draft.basics.id)).toEqual([]);
  });
});

describe("failures", () => {
  it("QUOTA fails at once when every model's quota is gone; 再试一次 runs a new job", async () => {
    const { leader, id } = await aiDraft();
    await typed(leader.token, id);
    // The four good models, then the light fallback.
    mockAi.failNext("QUOTA", { times: 5 });
    await drain();
    expect(mockAi.calls().map((c) => c.model)).toEqual(["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-flash-lite-latest"]);
    const failed = (await draftOf(leader.token, id)).data;
    expect(failed.analysis).toMatchObject({ status: "failed", error: "QUOTA" });
    expect((await testDb.user.findUniqueOrThrow({ where: { id: leader.user.id } })).aiKeyStatus).toBe("QUOTA");

    // Every model's quota is gone for today: a retry fails at once, without another call…
    const retry = await call<DraftView>(`/api/projects/${id}/brief/retry`, { method: "POST", token: leader.token });
    expect(retry.data.analysis?.status).toBe("running");
    await drain();
    expect((await draftOf(leader.token, id)).data.analysis).toMatchObject({ status: "failed", error: "QUOTA" });
    expect(mockAi.calls()).toHaveLength(5);
    // …and works once the usage day has reset.
    await call(`/api/projects/${id}/brief/retry`, { method: "POST", token: leader.token });
    await drain(new Date(Date.now() + 24 * 60 * 60 * 1000));
    expect((await draftOf(leader.token, id)).data.analysis?.status).toBe("done");
    // A call that worked clears the status.
    expect((await testDb.user.findUniqueOrThrow({ where: { id: leader.user.id } })).aiKeyStatus).toBe("OK");
  });

  it("503 on the first good model: the next model in the chain answers at once", async () => {
    const { leader, id } = await aiDraft();
    // Long enough that nobody asks for a finer split.
    const longer = [BRIEF, "6. 用户测试", "7. 测试报告", "8. 使用说明书", "9. 会议记录", "10. 期末演示"];
    await typed(leader.token, id, longer.join("\n"));
    mockAi.failNext("TRANSIENT", { model: "gemini-3.8-flash" });
    expect(await drain()).toBe(1);
    expect(mockAi.calls().filter((c) => c.purpose === "brief").map((c) => c.model)).toEqual(["gemini-3.8-flash", "gemini-3.7-flash"]);
    const [job] = await jobsOf(id);
    expect([job!.status, job!.tries, (job!.result as { model?: string }).model]).toEqual(["DONE", 1, "gemini-3.7-flash"]);
    expect((await draftOf(leader.token, id)).data.analysis).toMatchObject({ status: "done" });
  });

  it("retries after 30 s when every model had a transient error, and gives up after 3 tries", async () => {
    const { leader, id } = await aiDraft();
    await typed(leader.token, id);
    const t0 = new Date();
    // Each try walks the whole chain (four good models and the light one) before the job waits.
    mockAi.failNext("TRANSIENT", { times: 15 });
    await drain(t0);
    let [job] = await jobsOf(id);
    expect([job!.status, job!.tries]).toEqual(["QUEUED", 1]);
    expect(job!.runAfter.getTime()).toBe(t0.getTime() + BACKOFF_MS[0]!);
    expect((await draftOf(leader.token, id)).data.analysis?.status).toBe("running");
    // Not due yet.
    expect(await drain(new Date(t0.getTime() + 10_000))).toBe(0);
    const t1 = new Date(t0.getTime() + BACKOFF_MS[0]! + 1);
    await drain(t1);
    const t2 = new Date(t1.getTime() + BACKOFF_MS[1]! + 1);
    await drain(t2);
    [job] = await jobsOf(id);
    expect([job!.status, job!.tries, job!.error]).toEqual(["FAILED", 3, "ERROR"]);
    expect((await draftOf(leader.token, id)).data.analysis).toMatchObject({ status: "failed", error: "ERROR" });
  });

  it("recovers a job whose worker died (stale lease)", async () => {
    const { leader, id } = await aiDraft();
    await typed(leader.token, id);
    const [job] = await jobsOf(id);
    await testDb.aiJob.update({ where: { id: job!.id }, data: { status: "RUNNING", tries: 1, leaseUntil: new Date(Date.now() - 1000) } });
    expect(await drain()).toBe(1);
    const after = (await jobsOf(id))[0]!;
    expect([after.status, after.tries]).toEqual(["DONE", 2]);
  });

  it("「改用免费规则拆」 stops the AI and parses the saved brief with the rules", async () => {
    const { leader, id } = await aiDraft();
    await typed(leader.token, id);
    const rules = await call<BriefResult>(`/api/projects/${id}/brief/rules`, { method: "POST", token: leader.token });
    expect(rules.data).toMatchObject({ ok: true, source: "RULES", method: "LIST", found: 5 });
    expect((await jobsOf(id))[0]).toMatchObject({ status: "FAILED", error: "CANCELLED" });
    // The job that was about to run finds itself cancelled and changes nothing.
    await drain();
    const draft = (await draftOf(leader.token, id)).data;
    expect(draft.basics.planSource).toBe("RULES");
    expect(draft.tasks).toHaveLength(5);
    expect(draft.analysis).toMatchObject({ status: "failed", error: "CANCELLED" });
    expect(mockAi.calls()).toHaveLength(0);
  });

  it("a key removed before the job runs fails it as NO_KEY", async () => {
    const { leader, id } = await aiDraft();
    await typed(leader.token, id);
    await call("/api/me/ai-key", { method: "DELETE", token: leader.token });
    await drain();
    expect((await draftOf(leader.token, id)).data.analysis).toMatchObject({ status: "failed", error: "NO_KEY" });
    const retry = await call(`/api/projects/${id}/brief/retry`, { method: "POST", token: leader.token });
    expect([retry.status, retry.error?.code]).toEqual([409, "NO_AI_KEY"]);
  });
});

describe("选择题 in the draft", () => {
  async function analysed() {
    const d = await aiDraft();
    await typed(d.leader.token, d.id);
    await drain();
    const draft = (await draftOf(d.leader.token, d.id)).data;
    return { ...d, draft, pick: draft.questions[0]!, method: draft.questions[1]! };
  }

  it("needs exactly pickCount per question, and every question before confirming", async () => {
    const { leader, id, pick, method } = await analysed();
    const put = (answers: Record<string, string[]>) => call<DraftView>(`/api/projects/${id}/choices`, { method: "PUT", token: leader.token, body: { answers } });
    for (const answers of [{ [pick.id]: ["A"], [method.id]: ["B"] }, { [pick.id]: ["A", "B", "C"], [method.id]: ["B"] }, { [pick.id]: ["A", "A"], [method.id]: ["B"] }, { [pick.id]: ["A", "Z"], [method.id]: ["B"] }, { [pick.id]: ["A", "B"] }]) {
      const res = await put(answers);
      expect([res.status, res.error?.code]).toEqual([400, "CHOICE_COUNT"]);
    }
    const early = await call(`/api/projects/${id}/confirm`, { method: "POST", token: leader.token });
    expect([early.status, early.error?.code]).toEqual([409, "CHOICES_REQUIRED"]);

    const ok = await put({ [pick.id]: ["B", "D"], [method.id]: ["A"] });
    expect(ok.status).toBe(200);
    const titles = ok.data.tasks.map((t) => t.title);
    expect(titles.slice(4)).toEqual(["闲鱼 案例分析", "闲鱼 流程截图", "Mudah.my 案例分析", "Mudah.my 流程截图", "Waterfall 瀑布式 计划书", "Waterfall 瀑布式 过程记录"]);
    expect(ok.data.questions[0]!.options.filter((o) => o.picked).map((o) => o.key)).toEqual(["B", "D"]);
    // Choosing again swaps the option tasks (no duplicates).
    const again = await put({ [pick.id]: ["A", "B"], [method.id]: ["B"] });
    expect(again.data.tasks).toHaveLength(10);
    expect(again.data.tasks.some((t) => t.title.startsWith("Mudah.my"))).toBe(false);

    const confirmed = await call<ProjectView>(`/api/projects/${id}/confirm`, { method: "POST", token: leader.token });
    expect(confirmed.status).toBe(200);
    expect(confirmed.data.tasks.reduce((s, t) => s + t.points, 0)).toBe(1000);
    expect(confirmed.data.choices[0]!.options.find((o) => o.key === "A")!.taskIds).toHaveLength(2);
    const optionTasks = await testDb.task.findMany({ where: { projectId: id, choiceOptionId: { not: null } }, include: { checklist: true } });
    expect(optionTasks).toHaveLength(6);
    expect(optionTasks.every((t) => t.howtoByAi && t.checklist.length === 2)).toBe(true);
  });

  it("a manual plan replaces the AI's plan and its questions", async () => {
    const { leader, id } = await analysed();
    await call(`/api/projects/${id}/tasks`, { method: "PUT", token: leader.token, body: { tasks: [{ title: "只有一个", kind: "DOC", points: 100 }] } });
    const draft = (await draftOf(leader.token, id)).data;
    expect(draft.questions).toEqual([]);
    expect((await call(`/api/projects/${id}/confirm`, { method: "POST", token: leader.token })).status).toBe(200);
  });
});

describe("GET /api/projects/:id/draft ETag", () => {
  it("changes when the AI's answer lands", async () => {
    const { leader, id } = await aiDraft();
    await typed(leader.token, id);
    const get = (etag?: string) =>
      testApp.request(`/api/projects/${id}/draft`, { headers: { Authorization: `Bearer ${leader.token}`, ...(etag ? { "If-None-Match": etag } : {}) } });
    const first = await get();
    const etag = first.headers.get("etag")!;
    expect(etag).toBeTruthy();
    expect((await get(etag)).status).toBe(304);
    await drain();
    const after = await get(etag);
    expect(after.status).toBe(200);
    expect(after.headers.get("etag")).not.toBe(etag);
    // Someone else never gets a cached 404.
    const other = await login(1);
    const res = await testApp.request(`/api/projects/${id}/draft`, { headers: { Authorization: `Bearer ${other.token}` } });
    expect([res.status, res.headers.get("etag")]).toEqual([404, null]);
  });
});
