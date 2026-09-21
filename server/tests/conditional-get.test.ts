// Hardening B2: conditional GETs (ETag / If-None-Match → 304) and the general per-user rate limit.
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { LoginResult } from "../../shared/types";
import { createApp } from "../src/app";
import { PrismaClient } from "../src/generated/prisma/client";
import { OMIT, type Db } from "../src/lib/db";
import { homeToken, myTasksToken, projectToken, taskToken } from "../src/services/cache-tokens";
import { notify } from "../src/services/notify";
import { call, testApp, testDb } from "./helpers";
import {
  createActive,
  DAY,
  freshDb,
  gradeAs,
  joinCode,
  linkEvidence,
  person,
  pickAs,
  startAs,
  submitAs,
  taskOf,
  viewAs,
  withPackages,
} from "./project-fixtures";
import { testDatabaseUrl } from "./test-db";

beforeEach(freshDb);
afterAll(() => testDb.$disconnect());

const HOUR = 60 * 60 * 1000;

type Got = { status: number; etag: string | null; cacheControl: string | null; body: string };

async function get(path: string, token?: string, etag?: string | null, app: { request: typeof testApp.request } = testApp): Promise<Got> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (etag) headers["If-None-Match"] = etag;
  const res = await app.request(path, { headers });
  return { status: res.status, etag: res.headers.get("etag"), cacheControl: res.headers.get("cache-control"), body: await res.text() };
}

/** 200 with an ETag, then 304 with the same ETag and no body. Returns the ETag. */
async function expectCached(path: string, token: string): Promise<string> {
  const first = await get(path, token);
  expect(first.status).toBe(200);
  expect(first.etag).toMatch(/^W\/"[\w-]{20,}"$/);
  expect(first.cacheControl).toBe("private, no-cache");
  const again = await get(path, token, first.etag);
  expect(again.status).toBe(304);
  expect(again.body).toBe("");
  expect(again.etag).toBe(first.etag);
  expect(again.cacheControl).toBe("private, no-cache");
  return first.etag!;
}

/** The ETag now, asserting it is (or isn't) still `etag`: 304 when unchanged, 200 with a new one when changed. */
async function expectChanged(path: string, token: string, etag: string, changed: boolean): Promise<string> {
  const res = await get(path, token, etag);
  if (changed) {
    expect(res.status).toBe(200);
    expect(res.etag).not.toBe(etag);
    return res.etag!;
  }
  expect(res.status).toBe(304);
  return etag;
}

const userOf = (p: LoginResult) => testDb.user.findUniqueOrThrow({ where: { id: p.user.id } });
const versionOf = async (projectId: string) =>
  (await testDb.project.findUniqueOrThrow({ where: { id: projectId }, select: { version: true } })).version;

/** A second project, not involving people 0–3: person 4 leads, person 5 joins. */
async function otherProject() {
  const lead = await person(4);
  const view = await createActive(lead.token, { name: "别组项目", shortCode: "OTH1", teamSize: 2 });
  const member = await person(5);
  await joinCode(member.token, view.inviteCode!);
  return { projectId: view.basics.id, lead, member };
}

describe("GET /api/me", () => {
  it("304s until the settings change", async () => {
    const me = await person(0);
    const etag = await expectCached("/api/me", me.token);
    const patched = await call("/api/me", { method: "PATCH", token: me.token, body: { locale: "en" } });
    expect(patched.status).toBe(200);
    // The PATCH answer itself stays no-store; only the conditional GETs revalidate.
    const after = await expectChanged("/api/me", me.token, etag, true);
    await expectChanged("/api/me", me.token, after, false);
  });

  it("never matches another user's token", async () => {
    const a = await person(0);
    const b = await person(1);
    const etag = (await get("/api/me", a.token)).etag;
    expect((await get("/api/me", b.token, etag)).status).toBe(200);
  });
});

describe("GET /api/projects/:id", () => {
  it("changes when another member writes, not when another project does", async () => {
    const t = await withPackages(3);
    const other = await otherProject();
    const path = `/api/projects/${t.projectId}`;
    let etag = await expectCached(path, t.leader.token);

    // A write in a project I'm not in leaves my token alone.
    const theirTask = taskOf(await viewAs(other.lead.token, other.projectId), 0);
    await call(`/api/projects/${other.projectId}/tasks/${theirTask.id}/checklist`, {
      method: "PUT",
      token: other.lead.token,
      body: { items: [{ text: "别组的事" }] },
    });
    etag = await expectChanged(path, t.leader.token, etag, false);

    // A member starting a task (another user) changes it.
    const mine = taskOf(t.view, 0, 2);
    expect((await startAs(t.members[0]!.token, t.projectId, mine.id)).status).toBe(200);
    etag = await expectChanged(path, t.leader.token, etag, true);
    await expectChanged(path, t.leader.token, etag, false);
  });

  it("changes when a member picks a package", async () => {
    const leader = await person(0);
    const view = await createActive(leader.token, { teamSize: 2 });
    const member = await person(1);
    await joinCode(member.token, view.inviteCode!);
    const path = `/api/projects/${view.basics.id}`;
    const etag = await expectCached(path, leader.token);
    expect((await pickAs(member.token, view.basics.id, 1)).status).toBe(200);
    await expectChanged(path, leader.token, etag, true);
  });

  it("is per viewer, and never cached for someone who can't see it", async () => {
    const t = await withPackages(3);
    const path = `/api/projects/${t.projectId}`;
    const leaderTag = (await get(path, t.leader.token)).etag;
    const memberRes = await get(path, t.members[0]!.token, leaderTag);
    expect(memberRes.status).toBe(200);
    expect(memberRes.etag).not.toBe(leaderTag);

    const outsider = await person(4);
    const res = await get(path, outsider.token, leaderTag);
    expect(res.status).toBe(404);
    expect(res.etag).toBeNull();
    expect(res.cacheControl).toBe("no-store");
  });

  it("changes when a member leaves (their token stops working: 404)", async () => {
    const t = await withPackages(3);
    const path = `/api/projects/${t.projectId}`;
    const leaderTag = await expectCached(path, t.leader.token);
    const memberTag = await expectCached(path, t.members[1]!.token);
    expect((await call(`/api/projects/${t.projectId}/leave`, { method: "POST", token: t.members[1]!.token })).status).toBe(200);
    await expectChanged(path, t.leader.token, leaderTag, true);
    expect((await get(path, t.members[1]!.token, memberTag)).status).toBe(404);
  });

  it("expires a swap that ran out before answering (the token moves with it)", async () => {
    const t = await withPackages(3);
    const target = t.view.packages.find((p) => p.index === 3)!;
    const req = await call(`/api/projects/${t.projectId}/swaps`, { method: "POST", token: t.members[0]!.token, body: { packageId: target.id } });
    expect(req.status).toBe(200);
    const leader = await userOf(t.leader);
    const now = new Date();
    const before = await projectToken(testDb, t.projectId, leader, now);
    // An hour on nothing changed.
    expect(await projectToken(testDb, t.projectId, leader, new Date(now.getTime() + HOUR))).toBe(before);
    const later = new Date(now.getTime() + 73 * HOUR);
    const after = await projectToken(testDb, t.projectId, leader, later);
    expect(after).not.toBe(before);
    expect((await testDb.swapRequest.findFirstOrThrow({ where: { projectId: t.projectId } })).status).toBe("EXPIRED");
    // Settled: the next check agrees.
    expect(await projectToken(testDb, t.projectId, leader, later)).toBe(after);
  });

  it("moves when a task's due date passes", async () => {
    const t = await withPackages(2);
    const leader = await userOf(t.leader);
    const now = new Date();
    const token = await projectToken(testDb, t.projectId, leader, now);
    expect(await projectToken(testDb, t.projectId, leader, new Date(now.getTime() + DAY))).toBe(token);
    // Past the project deadline (49 days): every task is overdue now.
    expect(await projectToken(testDb, t.projectId, leader, new Date(now.getTime() + 50 * DAY))).not.toBe(token);
  });
});

describe("GET /api/projects/:id/tasks/:taskId", () => {
  it("changes on evidence, submission and grading by other people", async () => {
    const t = await withPackages(3);
    const task = taskOf(t.view, 0, 2);
    const path = `/api/projects/${t.projectId}/tasks/${task.id}`;
    const member = t.members[0]!;
    let leaderTag = await expectCached(path, t.leader.token);
    let memberTag = await expectCached(path, member.token);

    expect((await linkEvidence(member.token, t.projectId, task.id, "https://example.com/report")).status).toBe(201);
    leaderTag = await expectChanged(path, t.leader.token, leaderTag, true);
    expect((await submitAs(member.token, t.projectId, task.id)).status).toBe(200);
    leaderTag = await expectChanged(path, t.leader.token, leaderTag, true);

    memberTag = await expectChanged(path, member.token, memberTag, true);
    expect((await gradeAs(t.leader.token, t.projectId, task.id, "PASS")).status).toBe(200);
    await expectChanged(path, member.token, memberTag, true);
  });

  it("changes when a checklist item is ticked, or a member's name changes", async () => {
    const t = await withPackages(2);
    const task = taskOf(t.view, 0, 2);
    const member = t.members[0]!;
    const put = await call<{ checklist: { id: string }[] }>(`/api/projects/${t.projectId}/tasks/${task.id}/checklist`, {
      method: "PUT",
      token: member.token,
      body: { items: [{ text: "写引言" }] },
    });
    expect(put.status).toBe(200);
    const path = `/api/projects/${t.projectId}/tasks/${task.id}`;
    let etag = await expectCached(path, t.leader.token);
    const item = put.data.checklist[0]!.id;
    const tick = await call(`/api/projects/${t.projectId}/tasks/${task.id}/checklist/${item}/tick`, {
      method: "POST",
      token: member.token,
      body: { done: true },
    });
    expect(tick.status).toBe(200);
    etag = await expectChanged(path, t.leader.token, etag, true);

    await testDb.user.update({ where: { id: member.user.id }, data: { name: "新名字" } });
    etag = await expectChanged(path, t.leader.token, etag, true);
    // Not for a name that didn't change.
    await testDb.user.update({ where: { id: member.user.id }, data: { name: "新名字" } });
    await expectChanged(path, t.leader.token, etag, false);
  });

  it("moves when the 24-hour undo-start window closes", async () => {
    const t = await withPackages(2);
    const task = taskOf(t.view, 0, 2);
    const member = t.members[0]!;
    expect((await startAs(member.token, t.projectId, task.id)).status).toBe(200);
    const user = await userOf(member);
    const now = new Date();
    const token = await taskToken(testDb, t.projectId, task.id, user, now);
    expect(await taskToken(testDb, t.projectId, task.id, user, new Date(now.getTime() + HOUR))).toBe(token);
    expect(await taskToken(testDb, t.projectId, task.id, user, new Date(now.getTime() + 25 * HOUR))).not.toBe(token);
  });

  it("is not cached for an unknown task", async () => {
    const t = await withPackages(2);
    const res = await get(`/api/projects/${t.projectId}/tasks/nope`, t.leader.token);
    expect(res.status).toBe(404);
    expect(res.etag).toBeNull();
  });
});

describe("GET /api/home", () => {
  it("changes for members when someone else writes in a shared project, not for outsiders", async () => {
    const t = await withPackages(3);
    const outsider = await person(3);
    const leaderTag = await expectCached("/api/home", t.leader.token);
    const outsiderTag = await expectCached("/api/home", outsider.token);

    const mine = taskOf(t.view, 0, 2);
    await startAs(t.members[0]!.token, t.projectId, mine.id);
    await expectChanged("/api/home", t.leader.token, leaderTag, true);
    await expectChanged("/api/home", outsider.token, outsiderTag, false);
  });

  it("changes when I'm invited, and when I join", async () => {
    const other = await otherProject();
    const me = await person(0);
    let etag = await expectCached("/api/home", me.token);
    const invited = await call(`/api/projects/${other.projectId}/invites`, { method: "POST", token: other.lead.token, body: { targets: me.user.email! } });
    expect(invited.status).toBe(200);
    etag = await expectChanged("/api/home", me.token, etag, true);
    const code = (await viewAs(other.lead.token, other.projectId)).inviteCode!;
    expect((await joinCode(me.token, code)).status).toBe(200);
    await expectChanged("/api/home", me.token, etag, true);
  });

  it("moves when one of my tasks comes within the 8-day horizon", async () => {
    const t = await withPackages(2);
    const leader = await userOf(t.leader);
    const now = new Date();
    const token = await homeToken(testDb, leader, now);
    expect(await homeToken(testDb, leader, new Date(now.getTime() + DAY))).toBe(token);
    // The deadline is 49 days out: from day 41 on it is inside the horizon.
    expect(await homeToken(testDb, leader, new Date(now.getTime() + 42 * DAY))).not.toBe(token);
  });

  it("changes when a project I deleted gets purged", async () => {
    const t = await withPackages(2);
    const tag = (await viewAs(t.leader.token, t.projectId)).basics.shortCode!;
    expect((await call(`/api/projects/${t.projectId}/delete`, { method: "POST", token: t.leader.token, body: { confirm: tag } })).status).toBe(200);
    const leader = await userOf(t.leader);
    const now = new Date();
    const token = await homeToken(testDb, leader, now);
    const later = new Date(now.getTime() + 8 * DAY);
    const purged = await homeToken(testDb, leader, later);
    expect(purged).not.toBe(token);
    expect(await testDb.project.findUnique({ where: { id: t.projectId } })).toBeNull();
    expect(await homeToken(testDb, leader, later)).toBe(purged);
  });
});

describe("GET /api/tasks/mine", () => {
  it("changes when the leader grades my task, not on a write elsewhere", async () => {
    const t = await withPackages(3);
    const other = await otherProject();
    const member = t.members[0]!;
    const task = taskOf(t.view, 0, 2);
    await linkEvidence(member.token, t.projectId, task.id, "https://example.com/report");
    await submitAs(member.token, t.projectId, task.id);
    let etag = await expectCached("/api/tasks/mine", member.token);

    const theirTask = taskOf(await viewAs(other.lead.token, other.projectId), 0);
    await call(`/api/projects/${other.projectId}/tasks/${theirTask.id}/checklist`, {
      method: "PUT",
      token: other.lead.token,
      body: { items: [{ text: "别组的事" }] },
    });
    etag = await expectChanged("/api/tasks/mine", member.token, etag, false);

    expect((await gradeAs(t.leader.token, t.projectId, task.id, "PASS")).status).toBe(200);
    await expectChanged("/api/tasks/mine", member.token, etag, true);
  });

  it("moves the moment one of my tasks becomes overdue", async () => {
    const t = await withPackages(2);
    const user = await userOf(t.members[0]!);
    const now = new Date();
    const token = await myTasksToken(testDb, user, now);
    expect(await myTasksToken(testDb, user, new Date(now.getTime() + 7 * DAY))).toBe(token);
    expect(await myTasksToken(testDb, user, new Date(now.getTime() + 50 * DAY))).not.toBe(token);
  });
});

describe("GET /api/notifications", () => {
  it("304s the first page until a notification arrives or is read; later pages are not cached", async () => {
    const t = await withPackages(3);
    const me = t.leader;
    const send = (projectId: string | null) =>
      testDb.$transaction((tx) =>
        notify(tx, { userIds: [me.user.id], projectId, type: "PACKAGE_ASSIGNED", audience: "ONLY_YOU", payload: { packageIndex: 1 } }),
      );
    await send(t.projectId);
    let etag = await expectCached("/api/notifications", me.token);

    // Someone else's notification doesn't touch mine.
    await testDb.$transaction((tx) =>
      notify(tx, { userIds: [t.members[0]!.user.id], projectId: null, type: "PACKAGE_ASSIGNED", audience: "ONLY_YOU", payload: { packageIndex: 1 } }),
    );
    etag = await expectChanged("/api/notifications", me.token, etag, false);

    await send(null);
    etag = await expectChanged("/api/notifications", me.token, etag, true);

    const page = await call<{ items: { id: string }[]; unreadCount: number }>("/api/notifications", { token: me.token });
    expect(page.data.unreadCount).toBeGreaterThan(0);
    await call("/api/notifications/read", { method: "POST", token: me.token, body: { upToId: page.data.items[0]!.id } });
    etag = await expectChanged("/api/notifications", me.token, etag, true);

    // The project the notification points at is renamed: its tag changes.
    await call(`/api/projects/${t.projectId}`, { method: "PATCH", token: me.token, body: { shortCode: "CS999" } });
    etag = await expectChanged("/api/notifications", me.token, etag, true);

    // A different query is a different token.
    expect((await get("/api/notifications?mine=1", me.token, etag)).status).toBe(200);
    const cursorPage = await get(`/api/notifications?limit=1&cursor=${page.data.items[0]!.id}`, me.token, etag);
    expect(cursorPage.status).toBe(200);
    expect(cursorPage.etag).toBeNull();
  });
});

describe("Project.version triggers", () => {
  it("move on writes to every row under the project, and only that project", async () => {
    const t = await withPackages(2);
    const other = await otherProject();
    const task = taskOf(t.view, 0, 2);
    const otherBefore = await versionOf(other.projectId);
    let v = await versionOf(t.projectId);
    const bumped = async () => {
      const now = await versionOf(t.projectId);
      expect(now).toBeGreaterThan(v);
      v = now;
    };

    const attempt = await testDb.attempt.create({ data: { taskId: task.id, no: 1 } });
    await bumped();
    await testDb.evidence.create({ data: { attemptId: attempt.id, taskId: task.id, kind: "LINK", name: "x", url: "https://example.com" } });
    await bumped();
    await testDb.gradeChange.create({ data: { attemptId: attempt.id, fromGrade: "PASS", toGrade: "HALF", reason: "r" } });
    await bumped();
    await testDb.gradeChange.updateMany({ where: { attemptId: attempt.id }, data: { undoneAt: new Date() } });
    await bumped();
    await testDb.checklistItem.create({ data: { taskId: task.id, text: "x", order: 0 } });
    await bumped();
    await testDb.feature.create({ data: { projectId: t.projectId, name: "f", order: 0 } });
    await bumped();
    await testDb.milestone.create({ data: { projectId: t.projectId, label: "M1", name: "m", dueAt: new Date(), order: 0 } });
    await bumped();
    await testDb.task.updateMany({ where: { projectId: t.projectId }, data: { title: "改名" } });
    await bumped();
    await testDb.attempt.deleteMany({ where: { taskId: task.id } });
    await bumped();
    await testDb.member.updateMany({ where: { projectId: t.projectId }, data: { packageReminderAt: null } });
    await bumped();

    expect(await versionOf(other.projectId)).toBe(otherBefore);
  });
});

describe("CORS for conditional GETs", () => {
  it("allows If-None-Match and exposes ETag", async () => {
    const res = await testApp.request("/api/home", {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:8081",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "authorization,if-none-match,x-app-version",
      },
    });
    expect(res.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("if-none-match");
    const me = await person(0);
    const got = await testApp.request("/api/me", { headers: { Origin: "http://localhost:8081", Authorization: `Bearer ${me.token}` } });
    expect(got.headers.get("access-control-expose-headers")?.toLowerCase()).toContain("etag");
  });
});

describe("general rate limit", () => {
  it("limits each user, counting 304s, with Retry-After", async () => {
    const me = await person(0);
    const limited = createApp({ db: () => testDb, generalLimit: { userMax: 3, ipMax: 100, windowSec: 600 } });
    const first = await get("/api/me", me.token, null, limited);
    expect(first.status).toBe(200);
    expect((await get("/api/me", me.token, first.etag, limited)).status).toBe(304);
    expect((await get("/api/home", me.token, null, limited)).status).toBe(200);
    const res = await limited.request("/api/me", { headers: { Authorization: `Bearer ${me.token}` } });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("RATE_LIMITED");
    // Someone else isn't affected, and neither is the health check.
    const other = await person(1);
    expect((await get("/api/me", other.token, null, limited)).status).toBe(200);
    expect((await limited.request("/api/health")).status).toBe(200);
  });

  it("limits signed-out callers per IP", async () => {
    await testDb.rateLimitBucket.deleteMany();
    const limited = createApp({ db: () => testDb, generalLimit: { userMax: 100, ipMax: 2, windowSec: 600 } });
    expect((await limited.request("/api/dev/people")).status).toBe(200);
    expect((await limited.request("/api/me")).status).toBe(401);
    expect((await limited.request("/api/dev/people")).status).toBe(429);
  });

  it("can be turned off", async () => {
    const me = await person(0);
    const open = createApp({ db: () => testDb, generalLimit: null });
    for (let i = 0; i < 5; i++) expect((await get("/api/me", me.token, null, open)).status).toBe(200);
  });
});

describe("query counts (measured)", () => {
  it("a 304 costs a few tiny queries, a 200 the full load", async () => {
    const counting = new PrismaClient({
      adapter: new PrismaPg({ connectionString: testDatabaseUrl() }),
      omit: OMIT,
      log: [{ emit: "event", level: "query" }],
    });
    let queries = 0;
    (counting as unknown as { $on: (e: "query", f: () => void) => void }).$on("query", () => queries++);
    const app = createApp({ db: () => counting as unknown as Db });
    // No rate-limit pruning (1 request in 100) in the middle of a count.
    const random = vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      const t = await withPackages(3);
      const task = taskOf(t.view, 0, 2);
      const measure = async (path: string, etag?: string | null) => {
        queries = 0;
        const res = await get(path, t.leader.token, etag, app);
        return { status: res.status, etag: res.etag, queries };
      };
      const report: Record<string, { full: number; notModified: number }> = {};
      for (const path of ["/api/home", `/api/projects/${t.projectId}`, `/api/projects/${t.projectId}/tasks/${task.id}`, "/api/tasks/mine", "/api/notifications", "/api/me"]) {
        const full = await measure(path);
        const nm = await measure(path, full.etag);
        expect(full.status).toBe(200);
        expect(nm.status).toBe(304);
        // Session lookup + rate-limit upsert + the token query.
        expect(nm.queries).toBeLessThanOrEqual(3);
        // /api/me answers from the auth lookup either way: a 304 only saves the body.
        if (path === "/api/me") expect(nm.queries).toBe(full.queries);
        else expect(nm.queries).toBeLessThan(full.queries);
        report[path.replace(t.projectId, ":id").replace(task.id, ":taskId")] = { full: full.queries, notModified: nm.queries };
      }
      console.log("B2 query counts", JSON.stringify(report));
    } finally {
      random.mockRestore();
      await counting.$disconnect();
    }
  });
});
