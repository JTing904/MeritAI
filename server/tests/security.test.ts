// Security hardening (docs/plan/hardening.md A3–A10; audit 2026-09-19): body limits, headers, the dev
// login gate, rate limits and quotas, leader self-grading, link evidence, legacy Office files, log redaction.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DraftView, EvidenceLink, InviteOutcome } from "../../shared/types";
import { createApp } from "../src/app";
import { assertNoDevLoginInProduction, devLoginEnabled } from "../src/lib/dev-gate";
import { consumeRate, RATE_RULES, type RateRule } from "../src/lib/rate-limit";
import { addAttempt } from "./attempt-rows";
import { call, testApp, testDb } from "./helpers";
import {
  basics,
  createActive,
  createDraft,
  fakeFile,
  freshDb,
  gradeAs,
  joinCode,
  linkEvidence,
  login,
  overrideAs,
  person,
  submitAs,
  taskOf,
  uploadEvidence,
  withPackages,
} from "./project-fixtures";

beforeEach(freshDb);
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
afterAll(() => testDb.$disconnect());

/** Puts a bucket at its limit, as if `rule.max` requests had just been counted. */
const fillBucket = (rule: RateRule, subject: string) =>
  testDb.rateLimitBucket.create({ data: { key: `${rule.name}:${subject}`, count: rule.max, windowStart: new Date() } });

describe("request body limit (A3)", () => {
  it("refuses JSON bodies over 1 MB with 413 BODY_TOO_LARGE, before reading them", async () => {
    const leader = await login(0);
    const huge = JSON.stringify({ ...basics(), name: "x".repeat(1024 * 1024) });
    const res = await call("/api/projects", { method: "POST", token: leader.token, body: huge });
    expect([res.status, res.error?.code]).toEqual([413, "BODY_TOO_LARGE"]);
    expect(await testDb.project.count()).toBe(0);
  });

  it("leaves the upload routes their own, larger limit", async () => {
    const t = await withPackages(2);
    const mine = taskOf(t.view, 0, 2);
    const res = await uploadEvidence(t.members[0]!.token, t.projectId, mine.id, fakeFile("big.pdf", "pdf", 2 * 1024 * 1024));
    expect(res.status).toBe(201);
  });
});

describe("security headers (A4)", () => {
  it("sends CSP, no-store and friends on JSON, and a request id", async () => {
    const res = await testApp.request("/api/health");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; frame-ancestors 'none'");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("x-request-id")).toMatch(/^[\w-]{8,}$/);
    // Errors too.
    const missing = await testApp.request("/api/nope");
    expect(missing.headers.get("cache-control")).toBe("no-store");
    expect(missing.headers.get("content-security-policy")).toContain("default-src 'none'");
  });

  it("lets the web app send its version and idempotency headers (CORS preflight)", async () => {
    const res = await testApp.request("/api/projects", {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:8081",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type,x-app-version,idempotency-key",
      },
    });
    expect(res.status).toBe(204);
    const allowed = (res.headers.get("access-control-allow-headers") ?? "").toLowerCase().split(/\s*,\s*/);
    expect(allowed).toEqual(expect.arrayContaining(["authorization", "content-type", "x-app-version", "idempotency-key"]));
    expect(res.headers.get("access-control-max-age")).toBe("7200");
    const get = await testApp.request("/api/health", { headers: { Origin: "http://localhost:8081" } });
    expect((get.headers.get("access-control-expose-headers") ?? "").toLowerCase()).toContain("retry-after");
  });
});

describe("served files (A4, A9)", () => {
  async function openFile(file: File) {
    const t = await withPackages(2);
    const a = t.members[0]!;
    const mine = taskOf(t.view, 0, 2);
    expect((await uploadEvidence(a.token, t.projectId, mine.id, file)).status).toBe(201);
    const row = await testDb.evidence.findFirstOrThrow({ where: { taskId: mine.id } });
    const link = await call<EvidenceLink>(`/api/evidence/${row.id}/link`, { token: a.token });
    return testApp.request(new URL(link.data.url).pathname + new URL(link.data.url).search);
  }

  it("serves legacy .doc files as attachments, sandboxed", async () => {
    const ole = Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    const res = await openFile(fakeFile("旧报告.doc", ole, 4096));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/msword");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; /);
    expect(res.headers.get("content-security-policy")).toBe("sandbox; default-src 'none'; frame-ancestors 'none'");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("still shows PDFs in place, under the same sandbox", async () => {
    const res = await openFile(fakeFile("report.pdf", "pdf", 2048));
    expect(res.headers.get("content-disposition")).toMatch(/^inline; /);
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    expect(res.headers.get("cache-control")).toBe("private, max-age=0");
  });
});

describe("dev login gate (A5)", () => {
  const base = { DEV_LOGIN: "true", APP_ENV: "development", NODE_ENV: "development" };

  it("needs DEV_LOGIN=true and APP_ENV=development, and never production or Vercel", () => {
    expect(devLoginEnabled(base)).toBe(true);
    expect(devLoginEnabled({ ...base, DEV_LOGIN: "false" })).toBe(false);
    expect(devLoginEnabled({ ...base, DEV_LOGIN: undefined })).toBe(false);
    expect(devLoginEnabled({ ...base, APP_ENV: undefined })).toBe(false);
    expect(devLoginEnabled({ ...base, APP_ENV: "production" })).toBe(false);
    expect(devLoginEnabled({ ...base, NODE_ENV: "production" })).toBe(false);
    expect(devLoginEnabled({ ...base, VERCEL: "1" })).toBe(false);
    // NODE_ENV unset (the old fail-open case) is fine only with the explicit APP_ENV.
    expect(devLoginEnabled({ DEV_LOGIN: "true" })).toBe(false);
  });

  it("refuses to start in production with DEV_LOGIN set", () => {
    expect(() => assertNoDevLoginInProduction({ ...base, NODE_ENV: "production" })).toThrow(/DEV_LOGIN/);
    expect(() => assertNoDevLoginInProduction({ DEV_LOGIN: "1", VERCEL: "1" })).toThrow(/DEV_LOGIN/);
    expect(() => assertNoDevLoginInProduction({ DEV_LOGIN: "true", APP_ENV: "production" })).toThrow(/DEV_LOGIN/);
    expect(() => assertNoDevLoginInProduction({ DEV_LOGIN: "false", VERCEL: "1", NODE_ENV: "production" })).not.toThrow();
    expect(() => assertNoDevLoginInProduction({ NODE_ENV: "production" })).not.toThrow();
    expect(() => assertNoDevLoginInProduction(base)).not.toThrow();

    vi.stubEnv("NODE_ENV", "production");
    expect(() => createApp({ db: () => testDb })).toThrow(/DEV_LOGIN/);
  });

  it("hides every /api/dev route without APP_ENV=development", async () => {
    const leader = await login(0);
    vi.stubEnv("APP_ENV", "");
    expect((await call("/api/dev/people")).status).toBe(404);
    expect((await call("/api/dev/login", { method: "POST", body: { userId: leader.user.id } })).status).toBe(404);
    expect((await call("/api/dev/tasks/x/status", { method: "POST", token: leader.token, body: { status: "DONE" } })).status).toBe(404);
    vi.stubEnv("APP_ENV", "development");
    vi.stubEnv("VERCEL", "1");
    expect((await call("/api/dev/people")).status).toBe(404);
  });
});

describe("invite codes and join limits (A6)", () => {
  it("makes 8 random characters after the prefix, and old 4-character codes still join", async () => {
    const leader = await login(0);
    const view = await createActive(leader.token, { teamSize: 3 });
    expect(view.inviteCode).toMatch(/^CS302-[A-Z2-9]{8}$/);
    await testDb.project.update({ where: { id: view.basics.id }, data: { inviteCode: "CS302-AB7Q" } });
    const joiner = await login(1);
    expect((await joinCode(joiner.token, "cs302-ab7q")).status).toBe(200);
  });

  it("locks a person out for an hour after 10 codes that don't exist; right codes never count", async () => {
    const leader = await login(0);
    const view = await createActive(leader.token, { teamSize: 3 });
    const guesser = await login(1);
    // Right codes (previews and joins) don't count.
    for (let i = 0; i < 12; i++) expect((await call(`/api/join/${view.inviteCode}`, { token: guesser.token })).status).toBe(200);
    for (let i = 0; i < 10; i++) {
      const miss = await call(`/api/join/CS302-NOPE${i}`, { token: guesser.token });
      expect([miss.status, miss.error?.code]).toEqual([404, "INVITE_CODE_INVALID"]);
    }
    // One more wrong code crosses the limit; from then on even the right code waits.
    expect((await call("/api/join/CS302-NOPEXX", { token: guesser.token })).status).toBe(404);
    const locked = await testApp.request(`/api/join/${view.inviteCode}`, { method: "POST", headers: { Authorization: `Bearer ${guesser.token}` } });
    expect(locked.status).toBe(429);
    expect(((await locked.json()) as { error: { code: string } }).error.code).toBe("RATE_LIMITED");
    const retry = Number(locked.headers.get("retry-after"));
    expect(retry).toBeGreaterThan(3500);
    expect(retry).toBeLessThanOrEqual(3600);
    expect(await testDb.member.count({ where: { projectId: view.basics.id } })).toBe(1);
    // Someone else is not affected by this person's lockout.
    expect((await joinCode((await login(2)).token, view.inviteCode!)).status).toBe(200);
  });

  it("locks out an IP after 30 wrong codes from anyone behind it", async () => {
    for (let i = 0; i < 4; i++) {
      const p = await person(i);
      for (let k = 0; k < 8; k++) await call(`/api/join/XX-${i}${k}`, { token: p.token });
    }
    const fresh = await person(4);
    expect((await call("/api/join/XX-NEW", { token: fresh.token })).status).toBe(429);
  });
});

describe("rate limits and quotas on creates (A6)", () => {
  it("counts per window and answers 429 with Retry-After once over", async () => {
    const rule: RateRule = { name: "test", max: 3, windowSec: 60 };
    const t0 = new Date("2026-09-20T00:00:00Z");
    for (let i = 0; i < 3; i++) await consumeRate(testDb, [{ rule, subject: "a" }], t0);
    await expect(consumeRate(testDb, [{ rule, subject: "a" }], t0)).rejects.toMatchObject({ status: 429, retryAfterSec: 60 });
    // Another subject has its own bucket; a new window starts after the old one ends.
    await consumeRate(testDb, [{ rule, subject: "b" }], t0);
    await consumeRate(testDb, [{ rule, subject: "a" }], new Date(t0.getTime() + 61_000));
  });

  it("limits invites per person and per project, and keeps at most 30 waiting", async () => {
    const leader = await login(0);
    const view = await createActive(leader.token, { teamSize: 3 });
    const invite = (targets: string) =>
      call<InviteOutcome[]>(`/api/projects/${view.basics.id}/invites`, { method: "POST", token: leader.token, body: { targets } });
    const first = await invite(Array.from({ length: 20 }, (_, i) => `p${i}@uni.edu`).join(","));
    expect(first.status).toBe(200);
    const over = await invite(Array.from({ length: 11 }, (_, i) => `q${i}@uni.edu`).join(","));
    expect([over.status, over.error?.code]).toEqual([409, "INVITE_LIMIT"]);
    expect(await testDb.invite.count({ where: { projectId: view.basics.id, status: "PENDING" } })).toBe(20);
    expect((await invite(Array.from({ length: 10 }, (_, i) => `q${i}@uni.edu`).join(","))).status).toBe(200);

    await testDb.rateLimitBucket.deleteMany();
    await fillBucket(RATE_RULES.invitesProject, view.basics.id);
    const limited = await invite("late@uni.edu");
    expect([limited.status, limited.error?.code]).toEqual([429, "RATE_LIMITED"]);
    // An outsider can't use up a project's invites.
    const outsider = await login(3);
    const res = await call(`/api/projects/${view.basics.id}/invites`, { method: "POST", token: outsider.token, body: { targets: "x@uni.edu" } });
    expect(res.status).not.toBe(429);
    expect(await testDb.rateLimitBucket.count({ where: { key: { startsWith: `invites:u:${outsider.user.id}` } } })).toBe(0);
  });

  it("keeps at most 20 unfinished drafts per person", async () => {
    const leader = await login(0);
    for (let i = 0; i < 20; i++) await createDraft(leader.token, { name: `草稿 ${i}` });
    const res = await call<DraftView>("/api/projects", { method: "POST", token: leader.token, body: basics() });
    expect([res.status, res.error?.code]).toEqual([409, "DRAFT_LIMIT"]);
    // Deleting one makes room again.
    const one = await testDb.project.findFirstOrThrow({ where: { createdById: leader.user.id } });
    expect((await call(`/api/projects/${one.id}`, { method: "DELETE", token: leader.token })).status).toBe(200);
    expect((await call("/api/projects", { method: "POST", token: leader.token, body: basics() })).status).toBe(201);
  });

  it("limits invite-code resets, brief uploads and evidence uploads per person", async () => {
    const t = await withPackages(2);
    const a = t.members[0]!;
    await fillBucket(RATE_RULES.codeResetUser, t.leader.user.id);
    expect((await call(`/api/projects/${t.projectId}/invite-code/reset`, { method: "POST", token: t.leader.token })).status).toBe(429);

    await fillBucket(RATE_RULES.evidenceUser, a.user.id);
    const up = await uploadEvidence(a.token, t.projectId, taskOf(t.view, 0, 2).id, fakeFile("a.pdf", "pdf"));
    expect([up.status, up.error?.code]).toEqual([429, "RATE_LIMITED"]);
    expect(await testDb.evidence.count()).toBe(0);

    const leader = await login(0);
    const draft = await createDraft(leader.token);
    await fillBucket(RATE_RULES.briefUser, leader.user.id);
    const brief = await call(`/api/projects/${draft.basics.id}/brief`, { method: "POST", token: leader.token, body: { text: "1. 报告\n2. 海报" } });
    expect([brief.status, brief.error?.code]).toEqual([429, "RATE_LIMITED"]);
  });
});

describe("the leader's own tasks (A7)", () => {
  it("are 合格（组长自评） on handing in, and can't be graded, overridden or graded outside", async () => {
    const t = await withPackages(2);
    const own = taskOf(t.view, 0, 1);
    const own2 = taskOf(t.view, 1, 1);
    const path = (taskId: string, action: string) => `/api/projects/${t.projectId}/tasks/${taskId}/${action}`;

    const outside = await call(path(own.id, "grade-outside"), { method: "POST", token: t.leader.token, body: { grade: "PASS" } });
    expect([outside.status, outside.error?.code]).toEqual([403, "SELF_GRADE_NOT_ALLOWED"]);

    // Handing in still counts as 合格（组长自评）.
    expect((await linkEvidence(t.leader.token, t.projectId, own.id, "https://docs.google.com/document/d/abc")).status).toBe(201);
    expect((await submitAs(t.leader.token, t.projectId, own.id)).status).toBe(200);
    expect(await testDb.task.findUniqueOrThrow({ where: { id: own.id } })).toMatchObject({ status: "DONE", grade: "PASS" });
    expect(await testDb.attempt.findFirstOrThrow({ where: { taskId: own.id } })).toMatchObject({ status: "GRADED", grade: "PASS", selfGraded: true });

    const override = await overrideAs(t.leader.token, t.projectId, own.id, "FAIL", "改一下");
    expect([override.status, override.error?.code]).toEqual([403, "SELF_GRADE_NOT_ALLOWED"]);
    const undo = await call(path(own.id, "undo-override"), { method: "POST", token: t.leader.token });
    expect([undo.status, undo.error?.code]).toEqual([403, "SELF_GRADE_NOT_ALLOWED"]);
    expect(await testDb.task.findUniqueOrThrow({ where: { id: own.id } })).toMatchObject({ status: "DONE", grade: "PASS" });

    // A waiting submission on the leader's own task (only possible from older data) can't be graded either.
    await addAttempt(own2.id, { no: 1, status: "PENDING" });
    const grade = await gradeAs(t.leader.token, t.projectId, own2.id, "PASS");
    expect([grade.status, grade.error?.code]).toEqual([403, "SELF_GRADE_NOT_ALLOWED"]);

    // Other people's tasks are graded as before.
    const theirs = taskOf(t.view, 0, 2);
    const a = t.members[0]!;
    expect((await linkEvidence(a.token, t.projectId, theirs.id, "https://example.com/x")).status).toBe(201);
    expect((await submitAs(a.token, t.projectId, theirs.id)).status).toBe(200);
    expect((await gradeAs(t.leader.token, t.projectId, theirs.id, "PASS")).status).toBe(200);
  });
});

describe("link evidence (A8)", () => {
  it("refuses a username or password in the URL and names links by their punycode host", async () => {
    const t = await withPackages(2);
    const a = t.members[0]!;
    const mine = taskOf(t.view, 0, 2);
    for (const url of ["https://docs.google.com@evil.example/doc", "https://user:pass@example.com/", "http://:secret@example.com"]) {
      const res = await linkEvidence(a.token, t.projectId, mine.id, url);
      expect([url, res.status, res.error?.code]).toEqual([url, 400, "LINK_CREDENTIALS"]);
    }
    expect((await linkEvidence(a.token, t.projectId, mine.id, "https://gооgle.com/docs/report?id=1#top")).status).toBe(201);
    expect((await linkEvidence(a.token, t.projectId, mine.id, "https://例子.测试")).status).toBe(201);
    const rows = await testDb.evidence.findMany({ where: { taskId: mine.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    expect(rows.map((r) => r.name)).toEqual(["xn--ggle-55da.com/docs/report", "xn--fsqu00a.xn--0zwm56d"]);
    // The URL itself is kept as typed; the app opens it after its own http(s) check.
    expect(rows[0]!.url).toBe("https://gооgle.com/docs/report?id=1#top");
  });
});

describe("error log redaction (A10)", () => {
  it("logs the error's name and code, the route and the request id, never its message", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = createApp({
      db: () => {
        throw Object.assign(new Error("connect failed for alice@example.com: 报告内容"), { code: "E_TEST" });
      },
    });
    const res = await broken.request("/api/me");
    expect(res.status).toBe(500);
    const logged = JSON.stringify(spy.mock.calls);
    expect(logged).not.toContain("alice@example.com");
    expect(logged).not.toContain("报告内容");
    const entry = spy.mock.calls.find((c) => c[0] === "unhandled error")![1] as Record<string, unknown>;
    expect(entry).toMatchObject({ name: "Error", code: "E_TEST", method: "GET" });
    expect(entry.requestId).toBe(res.headers.get("x-request-id"));
  });
});
