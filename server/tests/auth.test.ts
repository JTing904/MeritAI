import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DevPerson, LoginResult, MeData } from "../../shared/types";
import { DEV_PEOPLE, seed } from "../prisma/seed";
import { hashToken } from "../src/lib/auth";
import { call, resetDb, testDb } from "./helpers";

beforeEach(async () => {
  await resetDb();
  await seed(testDb);
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => testDb.$disconnect());

async function loginAs(index = 0) {
  const people = await call<DevPerson[]>("/api/dev/people");
  const res = await call<LoginResult>("/api/dev/login", { method: "POST", body: { userId: people.data[index]!.id } });
  return res.data;
}

describe("developer one-tap login", () => {
  it("lists the seeded people", async () => {
    const res = await call<DevPerson[]>("/api/dev/people");
    expect(res.status).toBe(200);
    expect(res.data.map((p) => p.name)).toEqual(DEV_PEOPLE.map((p) => p.name));
    expect(res.data[0]!.color).toMatch(/^[a-z]+$/);
  });

  it("signs in and returns a token that only exists hashed in the database", async () => {
    const { token, user } = await loginAs(1);
    expect(user.name).toBe("林晓雯");
    const sessions = await testDb.session.findMany();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.tokenHash).toBe(hashToken(token));
    expect(sessions[0]!.tokenHash).not.toBe(token);
  });

  it("is hidden when DEV_LOGIN is off", async () => {
    vi.stubEnv("DEV_LOGIN", "false");
    expect((await call("/api/dev/people")).status).toBe(404);
  });

  it("is hidden in production even when DEV_LOGIN is on", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEV_LOGIN", "true");
    const people = await call("/api/dev/people");
    expect(people.status).toBe(404);
    const login = await call("/api/dev/login", { method: "POST", body: { userId: "x" } });
    expect(login.status).toBe(404);
  });

  it("rejects unknown users and malformed bodies", async () => {
    expect((await call("/api/dev/login", { method: "POST", body: { userId: "nope" } })).status).toBe(404);
    const bad = await call("/api/dev/login", { method: "POST", body: "{not json" });
    expect(bad.status).toBe(400);
    expect(bad.error?.code).toBe("BAD_REQUEST");
    const invalid = await call("/api/dev/login", { method: "POST", body: { userId: 5 } });
    expect(invalid.error?.code).toBe("VALIDATION");
  });
});

describe("GET/PATCH /api/me", () => {
  it("requires a valid token", async () => {
    expect((await call("/api/me")).error?.code).toBe("UNAUTHENTICATED");
    expect((await call("/api/me", { token: "garbage" })).status).toBe(401);
  });

  it("returns the signed-in user", async () => {
    const { token } = await loginAs(0);
    const me = await call<MeData>("/api/me", { token });
    expect(me.data).toMatchObject({ name: "陈思远", locale: "zh", pushEnabled: true, weeklyEnabled: true });
  });

  it("rejects expired sessions", async () => {
    const { token } = await loginAs(0);
    await testDb.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await call("/api/me", { token })).status).toBe(401);
  });

  it("updates notification switches and language", async () => {
    const { token } = await loginAs(0);
    const res = await call<MeData>("/api/me", { method: "PATCH", token, body: { pushEnabled: false, locale: "en" } });
    expect(res.data).toMatchObject({ pushEnabled: false, weeklyEnabled: true, locale: "en" });
  });

  it("refuses fields that cannot be changed here", async () => {
    const { token } = await loginAs(0);
    const res = await call("/api/me", { method: "PATCH", token, body: { name: "Hacker", email: "x@y.z" } });
    expect(res.error?.code).toBe("VALIDATION");
  });
});

describe("sign out", () => {
  it("deletes only this device's session", async () => {
    const a = await loginAs(0);
    const b = await loginAs(0);
    expect((await call("/api/auth/session", { method: "DELETE", token: a.token })).status).toBe(200);
    expect((await call("/api/me", { token: a.token })).status).toBe(401);
    expect((await call("/api/me", { token: b.token })).status).toBe(200);
  });
});

describe("dev login scope", () => {
  it("refuses real (non-seeded) accounts", async () => {
    const real = await testDb.user.create({ data: { name: "Real Person", email: "real@example.com" } });
    const people = await call<DevPerson[]>("/api/dev/people");
    expect(people.data.some((p) => p.id === real.id)).toBe(false);
    expect((await call("/api/dev/login", { method: "POST", body: { userId: real.id } })).status).toBe(404);
  });
});
