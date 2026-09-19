// The data-layer hardening (docs/plan/hardening.md A12–A22): brief text kept out of queries, transient
// database errors, sessions, app versions, idempotent creates, storage caps, RLS and the local-DB guard.
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAX_PROJECT_STORAGE_BYTES } from "../../shared/constants";
import type { BriefResult, DraftView, InviteOutcome, ProjectView, TaskDetail } from "../../shared/types";
import { assertLocalDatabaseUrl, isLocalDatabaseUrl } from "../scripts/local-db-guard";
import { createApp } from "../src/app";
import { isTooOld, parseVersion } from "../src/lib/app-version";
import { hashToken, SESSION_DAYS } from "../src/lib/auth";
import { createDb } from "../src/lib/db";
import { isTransientDbError } from "../src/lib/db-errors";
import { capBriefText, MAX_BRIEF_TEXT_BYTES } from "../src/services/brief";
import { call, testApp, testDb } from "./helpers";
import {
  basics,
  createActive,
  createDraft,
  DAY,
  detailAs,
  fakeFile,
  freshDb,
  linkEvidence,
  login,
  upload,
  withPackages,
} from "./project-fixtures";

beforeEach(freshDb);

describe("A12 brief text stays out of ordinary queries", () => {
  it("omits Project.briefText and Task.briefExcerpt unless a query asks for them", async () => {
    const { token } = await login(0);
    const draft = await createDraft(token);
    await testDb.project.update({ where: { id: draft.basics.id }, data: { briefText: "x", briefBytes: 1 } });
    const plain = await testDb.project.findUniqueOrThrow({ where: { id: draft.basics.id } });
    expect("briefText" in plain).toBe(false);
    const asked = await testDb.project.findUniqueOrThrow({ where: { id: draft.basics.id }, select: { briefText: true } });
    expect(asked.briefText).toBe("x");
  });

  it("stores at most 200 KB of a long brief, cut at a line with a note, and still finds every task", async () => {
    const { token } = await login(0);
    const draft = await createDraft(token);
    const filler = Array.from({ length: 6000 }, (_, i) => `背景说明第 ${i + 1} 行：这一段只是介绍课程背景，不是要做的事。`);
    const text = ["1. 书面报告（40 分）", "2. 口头报告（30 分）", "3. 问卷调查（30 分）", "", ...filler].join("\n");
    expect(Buffer.byteLength(text)).toBeGreaterThan(MAX_BRIEF_TEXT_BYTES);
    const res = await call<BriefResult>(`/api/projects/${draft.basics.id}/brief`, { method: "POST", token, body: { text } });
    expect(res.status).toBe(200);
    expect(res.data.ok && res.data.found).toBe(3);

    const stored = await testDb.project.findUniqueOrThrow({
      where: { id: draft.basics.id },
      select: { briefText: true, briefBytes: true },
    });
    expect(stored.briefBytes).toBe(Buffer.byteLength(stored.briefText!));
    expect(stored.briefBytes!).toBeLessThanOrEqual(MAX_BRIEF_TEXT_BYTES);
    expect(stored.briefText!.startsWith("1. 书面报告（40 分）\n")).toBe(true);
    expect(stored.briefText!.endsWith("完整内容请看原来的文件。）")).toBe(true);
    const draftView = await call<DraftView>(`/api/projects/${draft.basics.id}/draft`, { token });
    expect(draftView.data.hasBriefText).toBe(true);
  });

  it("capBriefText keeps short texts whole and cuts long ones at a line", () => {
    expect(capBriefText("a\nb", "en")).toEqual({ text: "a\nb", keptLines: 2, cut: false });
    const long = Array.from({ length: 50_000 }, () => "0123456789").join("\n");
    const cut = capBriefText(long, "en");
    expect(cut.cut).toBe(true);
    expect(Buffer.byteLength(cut.text)).toBeLessThanOrEqual(MAX_BRIEF_TEXT_BYTES);
    expect(cut.text.split("\n").slice(0, cut.keptLines).every((l) => l === "0123456789")).toBe(true);
  });

  it("sends the quoted brief lines on the task page only, not in the project's task list", async () => {
    const { token } = await login(0);
    const draft = await createDraft(token, { teamSize: 2 });
    const text = "作业要求\n1. 书面报告（60 分）：不少于 3000 字。\n2. 口头报告（40 分）：十分钟。";
    // Uploaded as a file: a typed description keeps no quotes.
    await upload(`/api/projects/${draft.basics.id}/brief`, token, new File([text], "brief.txt", { type: "text/plain" }));
    const view = (await call<ProjectView>(`/api/projects/${draft.basics.id}/confirm`, { method: "POST", token })).data;
    expect(view.briefAvailable).toBe(true);
    expect(view.tasks.map((t) => t.briefExcerpt)).toEqual([null, null]);
    const detail = await detailAs(token, view.basics.id, view.tasks[0]!.id);
    expect(detail.data.task.briefExcerpt).toContain("书面报告");
  });
});

describe("A14 confirm in one statement", () => {
  it("confirms a 200-task plan with numbers, order, points and packages set", async () => {
    const { token } = await login(0);
    const tasks = Array.from({ length: 200 }, (_, i) => ({ title: `任务 ${i + 1}`, kind: "DOC" as const, points: 1 + (i % 7) }));
    const view = await createActive(token, { teamSize: 5, tasks });
    expect(view.tasks).toHaveLength(200);
    expect(view.tasks.map((t) => t.number)).toEqual(Array.from({ length: 200 }, (_, i) => i + 1));
    expect(view.tasks.reduce((s, t) => s + t.points, 0)).toBe(1000);
    expect(view.tasks.every((t) => t.packageId !== null)).toBe(true);
    expect(new Set(view.tasks.map((t) => t.packageId)).size).toBe(5);
  });
});

describe("A15 transient database errors answer 503 RETRY", () => {
  it("recognises lock timeouts, transaction timeouts and lost connections", async () => {
    expect(isTransientDbError({ code: "P2028" })).toBe(true);
    expect(isTransientDbError({ code: "P2034" })).toBe(true);
    expect(isTransientDbError({ code: "P2002" })).toBe(false);
    expect(isTransientDbError(new Error("boom"))).toBe(false);
    expect(isTransientDbError({ name: "X", cause: { code: "ECONNREFUSED" } })).toBe(true);

    // An interactive transaction that outlives its timeout.
    const timedOut = await testDb
      .$transaction(
        async (tx) => {
          await new Promise((r) => setTimeout(r, 150));
          await tx.user.count();
        },
        { timeout: 50 },
      )
      .catch((e: unknown) => e);
    expect(isTransientDbError(timedOut)).toBe(true);

    // A row lock not granted within lock_timeout (another transaction holds it).
    const { token } = await login(0);
    const draft = await createDraft(token);
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const isLocked = new Promise<void>((r) => (locked = r));
    const holder = testDb.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${draft.basics.id} FOR UPDATE`;
      locked();
      await held;
    });
    await isLocked;
    const waiter = await testDb
      .$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '100ms'`;
        await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${draft.basics.id} FOR UPDATE`;
      })
      .catch((e: unknown) => e);
    release();
    await holder;
    expect(isTransientDbError(waiter)).toBe(true);
  });

  it("answers 503 RETRY when the database can't be reached", async () => {
    const down = createDb("postgresql://nobody:nothing@127.0.0.1:1/none");
    const app = createApp({ db: () => down });
    const res = await app.request("/api/me", { headers: { Authorization: "Bearer whatever" } });
    const body = (await res.json()) as { error: { code: string } };
    expect([res.status, body.error.code]).toEqual([503, "RETRY"]);
    expect(res.headers.get("Retry-After")).toBe("1");
    await down.$disconnect();
  });
});

describe("A16 sessions", () => {
  const sessionOf = async (token: string) => testDb.session.findUniqueOrThrow({ where: { tokenHash: hashToken(token) } });

  it("slides the expiry when the daily use is recorded, and prunes expired sessions", async () => {
    const { token, user } = await login(0);
    const old = new Date(Date.now() - 3 * DAY);
    await testDb.session.update({ where: { tokenHash: hashToken(token) }, data: { lastUsedAt: old, expiresAt: new Date(Date.now() + DAY) } });
    const stale = await testDb.session.create({ data: { userId: user.id, tokenHash: "expired-1", expiresAt: new Date(Date.now() - DAY) } });

    expect((await call("/api/me", { token })).status).toBe(200);
    const after = await sessionOf(token);
    expect(after.lastUsedAt.getTime()).toBeGreaterThan(old.getTime());
    expect(after.expiresAt.getTime()).toBeGreaterThan(Date.now() + (SESSION_DAYS - 1) * DAY);
    expect(await testDb.session.findUnique({ where: { id: stale.id } })).toBeNull();

    // Used again within the day: no write.
    const again = await sessionOf(token);
    expect((await call("/api/me", { token })).status).toBe(200);
    expect((await sessionOf(token)).lastUsedAt).toEqual(again.lastUsedAt);
  });

  it("refuses and deletes an expired session", async () => {
    const { token } = await login(0);
    await testDb.session.update({ where: { tokenHash: hashToken(token) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await call("/api/me", { token })).status).toBe(401);
    expect(await testDb.session.findUnique({ where: { tokenHash: hashToken(token) } })).toBeNull();
  });

  it("DELETE /api/auth/sessions signs out every device of the user only", async () => {
    const a = await login(0);
    const b = await login(0);
    const other = await login(1);
    const res = await call<{ signedOut: number }>("/api/auth/sessions", { method: "DELETE", token: a.token });
    expect([res.status, res.data.signedOut]).toEqual([200, 2]);
    expect((await call("/api/me", { token: a.token })).status).toBe(401);
    expect((await call("/api/me", { token: b.token })).status).toBe(401);
    expect((await call("/api/me", { token: other.token })).status).toBe(200);
    expect((await call("/api/auth/sessions", { method: "DELETE" })).status).toBe(401);
  });
});

describe("A17 app version", () => {
  const app = createApp({ db: () => testDb, minAppVersion: "1.2.0" });
  const get = async (path: string, version?: string, token?: string) => {
    const headers: Record<string, string> = {};
    if (version !== undefined) headers["X-App-Version"] = version;
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await app.request(path, { headers });
    return { status: res.status, body: (await res.json()) as { error: { code: string; details?: unknown } | null } };
  };

  it("parses and compares versions", () => {
    expect(parseVersion("1.2.3")).toEqual([1, 2, 3]);
    expect(parseVersion("v2.0.0-beta.1")).toEqual([2, 0, 0]);
    expect(parseVersion("1.2")).toBeNull();
    expect(isTooOld("1.1.9", [1, 2, 0])).toBe(true);
    expect(isTooOld("1.10.0", [1, 2, 0])).toBe(false);
    expect(isTooOld(undefined, [0, 0, 0])).toBe(false);
  });

  it("answers 426 UPDATE_REQUIRED below MIN_APP_VERSION, except for the health check", async () => {
    const { token } = await login(0);
    const old = await get("/api/me", "1.1.9", token);
    expect([old.status, old.body.error?.code, old.body.error?.details]).toEqual([426, "UPDATE_REQUIRED", { minVersion: "1.2.0" }]);
    expect((await get("/api/me", undefined, token)).status).toBe(426);
    expect((await get("/api/me", "1.2.0", token)).status).toBe(200);
    expect((await get("/api/me", "2.0.0", token)).status).toBe(200);
    expect((await get("/api/health", "0.0.1")).status).toBe(200);
    // Without a minimum (the default) nothing is refused.
    expect((await call("/api/me", { token, headers: { "X-App-Version": "0.0.1" } })).status).toBe(200);
  });
});

describe("A18 idempotent creates", () => {
  const key = () => randomUUID();

  it("creates one draft for two requests with the same key, and replays the first answer", async () => {
    const { token } = await login(0);
    const k = key();
    const first = await call<DraftView>("/api/projects", { method: "POST", token, body: basics(), headers: { "Idempotency-Key": k } });
    const res = await testApp.request("/api/projects", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Idempotency-Key": k },
      body: JSON.stringify(basics()),
    });
    const second = (await res.json()) as { data: DraftView };
    expect(first.status).toBe(201);
    expect(res.status).toBe(201);
    expect(res.headers.get("Idempotent-Replayed")).toBe("true");
    expect(second.data.basics.id).toBe(first.data.basics.id);
    expect(await testDb.project.count()).toBe(1);
    // A new key is a new draft.
    await call("/api/projects", { method: "POST", token, body: basics(), headers: { "Idempotency-Key": key() } });
    expect(await testDb.project.count()).toBe(2);
  });

  it("keys are per user, refused on another route, and must be UUIDs", async () => {
    const a = await login(0);
    const b = await login(1);
    const k = key();
    await call("/api/projects", { method: "POST", token: a.token, body: basics(), headers: { "Idempotency-Key": k } });
    const other = await call<DraftView>("/api/projects", { method: "POST", token: b.token, body: basics(), headers: { "Idempotency-Key": k } });
    expect(other.status).toBe(201);
    expect(await testDb.project.count()).toBe(2);

    const drafts = await testDb.project.findMany({ where: { createdBy: { id: a.user.id } } });
    const elsewhere = await call(`/api/projects/${drafts[0]!.id}/tasks`, {
      method: "POST",
      token: a.token,
      body: { title: "x", kind: "DOC", points: 10 },
      headers: { "Idempotency-Key": k },
    });
    expect([elsewhere.status, elsewhere.error?.code]).toEqual([400, "BAD_REQUEST"]);
    const bad = await call("/api/projects", { method: "POST", token: a.token, body: basics(), headers: { "Idempotency-Key": "abc" } });
    expect([bad.status, bad.error?.code]).toEqual([400, "BAD_REQUEST"]);
  });

  it("a refused first request frees the key, so the retry runs", async () => {
    const { token } = await login(0);
    const k = key();
    const refused = await call("/api/projects", { method: "POST", token, body: { ...basics(), name: "" }, headers: { "Idempotency-Key": k } });
    expect(refused.status).toBe(400);
    const retry = await call<DraftView>("/api/projects", { method: "POST", token, body: basics(), headers: { "Idempotency-Key": k } });
    expect(retry.status).toBe(201);
    expect(await testDb.idempotencyKey.count()).toBe(1);
  });

  it("answers 409 RETRY while the first request with the key is still running", async () => {
    const { token, user } = await login(0);
    const k = key();
    await testDb.idempotencyKey.create({ data: { userId: user.id, key: k, route: "POST /api/projects" } });
    const busy = await call("/api/projects", { method: "POST", token, body: basics(), headers: { "Idempotency-Key": k } });
    expect([busy.status, busy.error?.code]).toEqual([409, "RETRY"]);
    expect(await testDb.project.count()).toBe(0);
  });

  it("adds one task, one invite and one piece of evidence per key", async () => {
    const team = await withPackages(2);
    const { leader, projectId } = team;
    const k1 = key();
    for (let i = 0; i < 2; i++) {
      const res = await call<ProjectView>(`/api/projects/${projectId}/tasks`, {
        method: "POST",
        token: leader.token,
        body: { title: "新任务", kind: "DOC", points: 50 },
        headers: { "Idempotency-Key": k1 },
      });
      expect(res.status).toBe(201);
    }
    expect(await testDb.task.count({ where: { projectId, title: "新任务" } })).toBe(1);

    const k2 = key();
    for (let i = 0; i < 2; i++) {
      const res = await call<InviteOutcome[]>(`/api/projects/${projectId}/invites`, {
        method: "POST",
        token: leader.token,
        body: { targets: "someone@example.com" },
        headers: { "Idempotency-Key": k2 },
      });
      expect(res.status).toBe(200);
    }
    expect(await testDb.invite.count({ where: { projectId } })).toBe(1);

    const mine = team.view.tasks.find((t) => t.ownerMemberId === team.view.viewerMemberId)!;
    const k3 = key();
    for (let i = 0; i < 2; i++) {
      const res = await call<TaskDetail>(`/api/projects/${projectId}/tasks/${mine.id}/evidence/link`, {
        method: "POST",
        token: leader.token,
        body: { url: "https://docs.google.com/document/d/abc/edit" },
        headers: { "Idempotency-Key": k3 },
      });
      expect(res.status).toBe(201);
    }
    expect(await testDb.evidence.count({ where: { taskId: mine.id } })).toBe(1);

    const k4 = key();
    const path = `/api/projects/${projectId}/tasks/${mine.id}/evidence/file`;
    for (let i = 0; i < 2; i++) {
      const form = new FormData();
      form.append("file", fakeFile("报告.pdf", "pdf", 2048));
      const res = await testApp.request(path, {
        method: "POST",
        headers: { Authorization: `Bearer ${leader.token}`, "Idempotency-Key": k4 },
        body: form,
      });
      expect(res.status).toBe(201);
    }
    expect(await testDb.evidence.count({ where: { taskId: mine.id, kind: "FILE" } })).toBe(1);
  });
});

describe("A19 date-only due dates", () => {
  it("end at 23:59:59.999 in the project's time zone", async () => {
    const { token } = await login(0);
    const draft = await createDraft(token, { deadline: "2099-10-31" });
    expect(draft.basics.deadline).toBe("2099-10-31T15:59:59.999Z");
  });
});

describe("A20 storage caps", () => {
  afterEach(() => {
    delete process.env.MAX_SITE_STORAGE_BYTES;
  });

  it("caps a project's files at 20 MB (PROJECT_STORAGE_FULL)", async () => {
    expect(MAX_PROJECT_STORAGE_BYTES).toBe(20 * 1024 * 1024);
    const team = await withPackages(2);
    const mine = team.view.tasks.find((t) => t.ownerMemberId === team.view.viewerMemberId)!;
    const attempt = await testDb.attempt.create({ data: { taskId: mine.id, no: 1, status: "GRADED", grade: "PASS" } });
    await testDb.evidence.create({
      data: { attemptId: attempt.id, taskId: mine.id, kind: "FILE", name: "old.pdf", storageKey: `${team.projectId}/${mine.id}/${"a".repeat(24)}.pdf`, sizeBytes: MAX_PROJECT_STORAGE_BYTES - 1000, mimeType: "application/pdf" },
    });
    const res = await upload(`/api/projects/${team.projectId}/tasks/${mine.id}/evidence/file`, team.leader.token, fakeFile("a.pdf", "pdf", 2000));
    expect([res.status, res.error?.code]).toEqual([409, "PROJECT_STORAGE_FULL"]);
  });

  it("stops every upload at the site-wide cap (507 STORAGE_FULL); links still work", async () => {
    const team = await withPackages(2);
    const mine = team.view.tasks.find((t) => t.ownerMemberId === team.view.viewerMemberId)!;
    process.env.MAX_SITE_STORAGE_BYTES = "3000";
    const res = await upload(`/api/projects/${team.projectId}/tasks/${mine.id}/evidence/file`, team.leader.token, fakeFile("a.pdf", "pdf", 4000));
    expect([res.status, res.error?.code]).toEqual([507, "STORAGE_FULL"]);
    const link = await linkEvidence(team.leader.token, team.projectId, mine.id, "https://docs.google.com/document/d/abc/edit");
    expect(link.status).toBe(201);
  });
});

describe("A21 row level security", () => {
  it("is enabled on every table in the schema", async () => {
    const rows = await testDb.$queryRaw<{ relname: string; relrowsecurity: boolean }[]>`
      SELECT c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = current_schema() AND c.relkind IN ('r', 'p')`;
    expect(rows.length).toBeGreaterThan(15);
    expect(rows.filter((r) => !r.relrowsecurity).map((r) => r.relname)).toEqual([]);
  });
});

describe("A22 only local databases are wiped", () => {
  it("accepts localhost and refuses anything else", () => {
    expect(isLocalDatabaseUrl("postgresql://u:p@localhost:5432/x")).toBe(true);
    expect(isLocalDatabaseUrl("postgresql://u:p@127.0.0.1/x")).toBe(true);
    expect(isLocalDatabaseUrl("postgres://u:p@[::1]:5432/x")).toBe(true);
    expect(isLocalDatabaseUrl("postgresql://u:p@db.abc.supabase.co:5432/postgres")).toBe(false);
    expect(isLocalDatabaseUrl("postgresql://u:p@localhost.evil.com/x")).toBe(false);
    expect(isLocalDatabaseUrl("postgresql://u:p@aws-0.pooler.supabase.com:6543/postgres?host=localhost")).toBe(false);
    expect(isLocalDatabaseUrl("not a url")).toBe(false);
    expect(() => assertLocalDatabaseUrl("postgresql://u:secret@db.example.com/x", "TEST_DATABASE_URL")).toThrow(/TEST_DATABASE_URL/);
    expect(() => assertLocalDatabaseUrl("postgresql://u:secret@db.example.com/x", "X")).not.toThrow(/secret/);
  });
});
