// M6 spec §1, §7: the account's AI key — saving (checked with one call), masking, encryption at rest, deleting,
// what members see, and a leader change switching the key.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { MeData, ProjectView } from "../../shared/types";
import { decryptKey } from "../src/lib/ai/crypto";
import { call, testDb } from "./helpers";
import { GOOD_KEY, resetMock, setKey } from "./ai-fixtures";
import { freshDb, login, viewAs, withPackages } from "./project-fixtures";

beforeEach(async () => {
  await freshDb();
  resetMock();
});
afterAll(() => testDb.$disconnect());

const putKey = (token: string, body: unknown) => call<MeData>("/api/me/ai-key", { method: "PUT", token, body });

describe("PUT /api/me/ai-key", () => {
  it("needs the 18+ tick, and never returns the key", async () => {
    const me = await login(0);
    const noAdult = await putKey(me.token, { provider: "GEMINI", key: GOOD_KEY });
    expect([noAdult.status, noAdult.error?.code]).toEqual([400, "AI_ADULT_REQUIRED"]);

    const saved = await putKey(me.token, { provider: "GEMINI", key: GOOD_KEY, adult: true });
    expect(saved.status).toBe(200);
    expect(saved.data.ai).toMatchObject({ provider: "GEMINI", last4: GOOD_KEY.slice(-4), status: "OK" });
    expect(saved.data.ai?.usageToday).toMatchObject({ good: { used: 0, limit: 80 }, light: { used: 0, limit: 500 } });
    expect(saved.data.ai?.usageToday?.models.map((m) => [m.model, m.tier, m.limit])).toEqual([
      ["gemini-3.8-flash", "good", 20],
      ["gemini-3.7-flash", "good", 20],
      ["gemini-3.6-flash", "good", 20],
      ["gemini-3.5-flash", "good", 20],
      ["gemini-flash-lite-latest", "light", 500],
    ]);
    const got = await call<MeData>("/api/me", { token: me.token });
    for (const body of [JSON.stringify(saved), JSON.stringify(got)]) {
      expect(body).not.toContain(GOOD_KEY);
      expect(body).not.toContain(GOOD_KEY.slice(0, 12));
    }

    // At rest: encrypted with the account as associated data.
    const row = await testDb.user.findUniqueOrThrow({ where: { id: me.user.id } });
    expect(row.aiKeyCipher).not.toContain(GOOD_KEY);
    expect(decryptKey(row.aiKeyCipher!, me.user.id)).toBe(GOOD_KEY);
    expect(row.aiAdultConfirmedAt).not.toBeNull();
  });

  it("stores nothing when the provider refuses the key; 503 when it can't be reached", async () => {
    const me = await login(0);
    const bad = await putKey(me.token, { provider: "CLAUDE", key: "sk-ant-invalid-key-000", adult: true });
    expect([bad.status, bad.error?.code]).toEqual([400, "AI_KEY_INVALID"]);
    const down = await putKey(me.token, { provider: "OPENAI", key: "sk-down-0000000000", adult: true });
    expect([down.status, down.error?.code]).toEqual([503, "AI_UNAVAILABLE"]);
    const row = await testDb.user.findUniqueOrThrow({ where: { id: me.user.id } });
    expect([row.aiProvider, row.aiKeyCipher]).toEqual([null, null]);
    expect((await call<MeData>("/api/me", { token: me.token })).data.ai).toBeNull();
  });

  it("replaces the earlier key and is limited to 10 tries an hour", async () => {
    const me = await login(0);
    await setKey(me.token, "GEMINI");
    const claude = await setKey(me.token, "CLAUDE", "sk-ant-api03-validkey9999");
    expect(claude.ai).toMatchObject({ provider: "CLAUDE", last4: "9999" });
    expect(claude.ai?.usageToday?.good.limit).toBeNull();
    for (let i = 0; i < 8; i++) await setKey(me.token);
    const limited = await putKey(me.token, { provider: "GEMINI", key: GOOD_KEY, adult: true });
    expect([limited.status, limited.error?.code]).toEqual([429, "RATE_LIMITED"]);
  });
});

describe("DELETE /api/me/ai-key", () => {
  it("removes the key; projects go back to the free rules", async () => {
    const t = await withPackages(2);
    await setKey(t.leader.token);
    expect((await viewAs(t.leader.token, t.projectId)).ai.configured).toBe(true);
    const res = await call<MeData>("/api/me/ai-key", { method: "DELETE", token: t.leader.token });
    expect(res.status).toBe(200);
    expect(res.data.ai).toBeNull();
    const row = await testDb.user.findUniqueOrThrow({ where: { id: t.leader.user.id } });
    expect([row.aiProvider, row.aiKeyCipher, row.aiKeyLast4]).toEqual([null, null, null]);
    expect((await viewAs(t.members[0]!.token, t.projectId)).ai).toMatchObject({ configured: false, provider: null });
  });
});

describe("ProjectView.ai", () => {
  it("shows members only the provider and the leader, and follows the leader", async () => {
    const t = await withPackages(3);
    const [a] = t.members;
    await setKey(t.leader.token, "GEMINI");
    await setKey(a!.token, "CLAUDE", "sk-ant-api03-member-key-1");

    const seen = await viewAs(a!.token, t.projectId);
    expect(seen.ai).toEqual({ provider: "GEMINI", configured: true, status: "OK", leaderName: t.leader.user.name, reviewsToday: 0, reviewsLimit: 30 });
    expect(JSON.stringify(seen)).not.toContain(GOOD_KEY.slice(-10));

    // Hand the role over: the project now uses the new leader's key (nothing to delete).
    const lead = await testDb.member.findFirstOrThrow({ where: { projectId: t.projectId, userId: a!.user.id } });
    const transfer = await call<ProjectView>(`/api/projects/${t.projectId}/members/${lead.id}/transfer`, { method: "POST", token: t.leader.token });
    expect(transfer.status).toBe(200);
    expect((await viewAs(t.leader.token, t.projectId)).ai).toMatchObject({ provider: "CLAUDE", leaderName: a!.user.name });

    // The new leader removes their key: free rules, although the old leader still has one.
    await call("/api/me/ai-key", { method: "DELETE", token: a!.token });
    expect((await viewAs(t.leader.token, t.projectId)).ai).toMatchObject({ provider: null, configured: false });
  });
});
