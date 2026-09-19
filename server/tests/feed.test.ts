// The project feed (动态, srv-core, spec §9): what gets recorded, order and pagination, who can read it.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { FeedPage } from "../../shared/types";
import { recordEvent } from "../src/services/notify";
import { call, testDb } from "./helpers";
import { activeWith, createDraft, freshDb, joinCode, login, person } from "./project-fixtures";

beforeEach(freshDb);
afterAll(() => testDb.$disconnect());

const feed = (token: string, projectId: string, query = "") => call<FeedPage>(`/api/projects/${projectId}/feed${query}`, { token });

describe("GET /api/projects/:id/feed", () => {
  it("starts with the confirmed plan and everyone who joined, newest first, with the actor's name and colour", async () => {
    const t = await activeWith(3);
    const [leader, a, b] = ["陈思远", "林晓雯", "王子杰"].map((name) => t.view.members.find((m) => m.name === name)!);
    const res = await feed(t.members[1]!.token, t.projectId);
    expect(res.status).toBe(200);
    expect(res.data.nextCursor).toBeNull();
    expect(res.data.items.map((e) => [e.type, e.actor, e.payload])).toEqual([
      ["JOINED", { memberId: b!.id, name: "王子杰", color: "mint" }, { type: "JOINED" }],
      ["JOINED", { memberId: a!.id, name: "林晓雯", color: "gum" }, { type: "JOINED" }],
      ["PLAN_CONFIRMED", { memberId: leader!.id, name: "陈思远", color: "lemon" }, { type: "PLAN_CONFIRMED", packageCount: 3 }],
    ]);
    const times = res.data.items.map((e) => e.createdAt);
    expect([...times].sort().reverse()).toEqual(times);
  });

  it("adds leaving, removal and the leader handing over", async () => {
    const t = await activeWith(4);
    const ids = t.members.map((p) => t.view.members.find((m) => m.userId === p.user.id)!.id);
    await call(`/api/projects/${t.projectId}/leave`, { method: "POST", token: t.members[0]!.token });
    await call(`/api/projects/${t.projectId}/members/${ids[1]}/remove`, { method: "POST", token: t.leader.token });
    await call(`/api/projects/${t.projectId}/members/${ids[2]}/transfer`, { method: "POST", token: t.leader.token });
    const items = (await feed(t.leader.token, t.projectId, "?limit=3")).data.items;
    expect(items.map((e) => [e.type, e.actor?.name, e.payload])).toEqual([
      ["LEADER_TRANSFERRED", "陈思远", { type: "LEADER_TRANSFERRED", member: { memberId: ids[2], name: "张博文" } }],
      ["REMOVED", "陈思远", { type: "REMOVED", member: { memberId: ids[1], name: "王子杰" } }],
      ["LEFT", "林晓雯", { type: "LEFT" }],
    ]);
  });

  it("pages with cursor and limit, in a stable order when times tie", async () => {
    const t = await activeWith(2);
    const when = new Date(Date.now() + 60_000);
    await testDb.$transaction(async (tx) => {
      for (let i = 1; i <= 4; i++) {
        await recordEvent(tx, { projectId: t.projectId, actorId: null, type: "RESPLIT", payload: { packageCount: i }, now: when });
      }
    });
    const all = (await feed(t.leader.token, t.projectId)).data.items;
    expect(all).toHaveLength(6);
    const tied = all.slice(0, 4).map((e) => e.id);
    expect(tied).toEqual([...tied].sort().reverse());
    // No actor: shown without one.
    expect(all[0]!.actor).toBeNull();

    const first = (await feed(t.leader.token, t.projectId, "?limit=4")).data;
    expect(first.items.map((e) => e.id)).toEqual(all.slice(0, 4).map((e) => e.id));
    expect(first.nextCursor).toBe(all[3]!.id);
    const rest = (await feed(t.leader.token, t.projectId, `?limit=4&cursor=${first.nextCursor}`)).data;
    expect(rest.items.map((e) => e.id)).toEqual(all.slice(4).map((e) => e.id));
    expect(rest.nextCursor).toBeNull();
    expect((await feed(t.leader.token, t.projectId, "?limit=99")).data.items).toHaveLength(6);
  });

  it("refuses a cursor from another project", async () => {
    const t = await activeWith(2);
    const other = await activeWith(2, { name: "别的项目" });
    const theirs = (await feed(other.leader.token, other.projectId)).data.items[0]!.id;
    expect((await feed(t.leader.token, t.projectId, `?cursor=${theirs}`)).error?.code).toBe("VALIDATION");
    expect((await feed(t.leader.token, t.projectId, "?cursor=nope")).error?.code).toBe("VALIDATION");
  });

  it("is for active members only; a draft's is empty", async () => {
    const t = await activeWith(2);
    const stranger = await person(4);
    expect((await feed("", t.projectId)).status).toBe(401);
    expect((await feed(stranger.token, t.projectId)).status).toBe(404);
    await call(`/api/projects/${t.projectId}/leave`, { method: "POST", token: t.members[0]!.token });
    expect((await feed(t.members[0]!.token, t.projectId)).status).toBe(404);
    // Coming back shows it again, with the return in it.
    await joinCode(t.members[0]!.token, t.view.inviteCode!);
    expect((await feed(t.members[0]!.token, t.projectId)).data.items.map((e) => e.type).slice(0, 2)).toEqual(["JOINED", "LEFT"]);

    const leader = await login(0);
    const draft = await createDraft(leader.token);
    expect((await feed(leader.token, draft.basics.id)).data).toEqual({ items: [], nextCursor: null });
  });
});
