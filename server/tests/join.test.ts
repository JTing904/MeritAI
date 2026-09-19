import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { HIGHLIGHTERS } from "../../shared/constants";
import type { HomeData, JoinPreview, ProjectView } from "../../shared/types";
import { pickHighlighter } from "../src/lib/colors";
import { allocateInviteCode, CODE_ALPHABET, codePrefix, makeInviteCode, normalizeInviteCode } from "../src/lib/invite-code";
import { call, testDb } from "./helpers";
import { activeWith, createActive, createDraft, extraPerson, freshDb, joinCode, login, person } from "./project-fixtures";

beforeEach(freshDb);
afterAll(() => testDb.$disconnect());

describe("invite codes", () => {
  it("uses an alphabet without look-alike characters", () => {
    expect(CODE_ALPHABET).toHaveLength(32);
    for (const ch of "0O1I") expect(CODE_ALPHABET).not.toContain(ch);
  });

  it("builds the prefix from the short code", () => {
    expect(codePrefix("CS302")).toBe("CS302");
    expect(codePrefix("cs-302")).toBe("CS302");
    expect(codePrefix("ＣＳ３０２")).toBe("CS302");
    expect(codePrefix("Software Engineering")).toBe("SOFTWA");
    for (const none of [null, undefined, "", "软工", "--"]) {
      expect(codePrefix(none)).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    }
    expect(makeInviteCode("CS302")).toMatch(/^CS302-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/);
  });

  it("matches what people type: any case, spaces, full-width characters", () => {
    expect(normalizeInviteCode(" cs302-7q4p ")).toBe("CS302-7Q4P");
    expect(normalizeInviteCode("CS 302 - 7Q4P")).toBe("CS302-7Q4P");
    expect(normalizeInviteCode("ｃｓ３０２－７Ｑ４Ｐ")).toBe("CS302-7Q4P");
  });

  it("skips codes that are in use or were retired", async () => {
    const leader = await login(0);
    const view = await createActive(leader.token);
    await testDb.retiredInviteCode.create({ data: { code: "CS302-RTRD", projectId: view.basics.id } });
    const queue = [view.inviteCode!, "CS302-RTRD", "CS302-FREE"];
    const code = await testDb.$transaction((tx) => allocateInviteCode(tx, "CS302", () => queue.shift()!));
    expect(code).toBe("CS302-FREE");
    expect(queue).toEqual([]);
  });

  it("gives two projects allocating at the same moment different codes", async () => {
    const leader = await login(0);
    const drafts = [await createDraft(leader.token), await createDraft(leader.token)];
    // Both would draw the same code first; the second must see it as taken instead of failing on write.
    const assign = (projectId: string) =>
      testDb.$transaction(async (tx) => {
        const queue = ["CS302-SAME", "CS302-NEXT"];
        const code = await allocateInviteCode(tx, "CS302", () => queue.shift()!);
        await tx.project.update({ where: { id: projectId }, data: { inviteCode: code } });
        return code;
      });
    const codes = await Promise.all(drafts.map((d) => assign(d.basics.id)));
    expect(codes.sort()).toEqual(["CS302-NEXT", "CS302-SAME"]);
  });
});

describe("member colours", () => {
  it("takes the first free highlighter, then the least used", () => {
    expect(pickHighlighter([])).toBe("lemon");
    expect(pickHighlighter(["lemon", "gum"])).toBe("mint");
    expect(pickHighlighter(["gum"])).toBe("lemon");
    expect(pickHighlighter([...HIGHLIGHTERS])).toBe("lemon");
    expect(pickHighlighter([...HIGHLIGHTERS, "lemon", "mint"])).toBe("gum");
  });
});

describe("GET /api/join/:code", () => {
  it("previews the project before joining", async () => {
    const leader = await login(0);
    const joiner = await login(1);
    const view = await createActive(leader.token);
    const code = ` ${view.inviteCode!.toLowerCase()} `;
    const res = await call<JoinPreview>(`/api/join/${encodeURIComponent(code)}`, { token: joiner.token });
    expect(res.status).toBe(200);
    expect(res.data).toEqual({
      projectId: view.basics.id,
      name: "校园二手市场 App",
      shortCode: "CS302",
      courseName: "软件工程",
      groupLabel: "第 7 组",
      color: "lemon",
      leaderName: "陈思远",
      memberCount: 1,
      teamSize: 5,
      freePackages: 5,
      members: [{ name: "陈思远", color: "lemon" }],
      alreadyMember: false,
      full: false,
    });
    const own = await call<JoinPreview>(`/api/join/${view.inviteCode}`, { token: leader.token });
    expect(own.data.alreadyMember).toBe(true);
  });

  it("tells unknown, replaced and ended codes apart", async () => {
    const leader = await login(0);
    const joiner = await login(1);
    expect((await call(`/api/join/NOPE-2345`, { token: joiner.token })).error?.code).toBe("INVITE_CODE_INVALID");
    expect((await call(`/api/join/${encodeURIComponent("   ")}`, { token: joiner.token })).error?.code).toBe("INVITE_CODE_INVALID");

    const view = await createActive(leader.token);
    await call(`/api/projects/${view.basics.id}/invite-code/reset`, { method: "POST", token: leader.token });
    const expired = await call(`/api/join/${view.inviteCode}`, { token: joiner.token });
    expect(expired).toMatchObject({ status: 410, error: { code: "INVITE_CODE_EXPIRED" } });
    expect((await joinCode(joiner.token, view.inviteCode!)).error?.code).toBe("INVITE_CODE_EXPIRED");

    const ended = await createActive(leader.token);
    for (const status of ["AWAITING_CONFIRM", "ENDED"] as const) {
      await testDb.project.update({ where: { id: ended.basics.id }, data: { status } });
      expect((await call(`/api/join/${ended.inviteCode}`, { token: joiner.token })).error?.code).toBe("PROJECT_ENDED");
      expect((await joinCode(joiner.token, ended.inviteCode!)).error?.code).toBe("PROJECT_ENDED");
    }
  });

  it("requires sign-in", async () => {
    const leader = await login(0);
    const view = await createActive(leader.token);
    expect((await call(`/api/join/${view.inviteCode}`)).status).toBe(401);
    expect((await call(`/api/join/${view.inviteCode}`, { method: "POST" })).status).toBe(401);
  });
});

describe("POST /api/join/:code", () => {
  it("adds the member with the next free colour, no approval needed", async () => {
    const leader = await login(0);
    const view = await createActive(leader.token);
    const a = await login(1);
    const b = await login(2);

    const joined = await joinCode(a.token, view.inviteCode!.toLowerCase());
    expect(joined.status).toBe(200);
    expect(joined.data).toMatchObject({ viewerRole: "MEMBER", inviteCode: view.inviteCode });
    const me = joined.data.members.find((m) => m.id === joined.data.viewerMemberId)!;
    expect(me).toMatchObject({ name: "林晓雯", color: "gum", role: "MEMBER", active: true, packageId: null });

    const second = await joinCode(b.token, view.inviteCode!);
    expect(second.data.members.map((m) => m.color)).toEqual(["lemon", "gum", "mint"]);
  });

  it("returns the project to someone who is already in it", async () => {
    const leader = await login(0);
    const view = await createActive(leader.token);
    const a = await login(1);
    const first = await joinCode(a.token, view.inviteCode!);
    const again = await joinCode(a.token, view.inviteCode!);
    expect(again.data.viewerMemberId).toBe(first.data.viewerMemberId);
    const self = await joinCode(leader.token, view.inviteCode!);
    expect(self.data.viewerRole).toBe("LEADER");
    expect(await testDb.member.count({ where: { projectId: view.basics.id } })).toBe(2);
    // Nothing happens the second time: no feed entry, no new join time, no packages change.
    expect(await testDb.activityEvent.count({ where: { projectId: view.basics.id, type: "JOINED" } })).toBe(1);
    expect(again.data.members.find((m) => m.id === again.data.viewerMemberId)!.joinedAt).toBe(
      first.data.members.find((m) => m.id === first.data.viewerMemberId)!.joinedAt,
    );
    expect(again.data.packagesVersion).toBe(first.data.packagesVersion);
  });

  it("joins once when the same person taps 加入 twice at the same time", async () => {
    const leader = await login(0);
    const view = await createActive(leader.token);
    const a = await login(1);
    const [x, y] = await Promise.all([joinCode(a.token, view.inviteCode!), joinCode(a.token, view.inviteCode!)]);
    expect([x.status, y.status]).toEqual([200, 200]);
    expect(x.data.viewerMemberId).toBe(y.data.viewerMemberId);
    const rows = await testDb.member.findMany({ where: { projectId: view.basics.id, userId: a.user.id } });
    expect(rows).toHaveLength(1);
    const colorOf = (v: ProjectView) => v.members.find((m) => m.id === v.viewerMemberId)?.color;
    expect(colorOf(x.data)).toBe(rows[0]!.color);
    expect(colorOf(y.data)).toBe(rows[0]!.color);
    expect(await testDb.activityEvent.count({ where: { projectId: view.basics.id, type: "JOINED" } })).toBe(1);
  });

  it("keeps people the leader removed out", async () => {
    const leader = await login(0);
    const view = await createActive(leader.token);
    const a = await login(1);
    const joined = await joinCode(a.token, view.inviteCode!);
    await testDb.member.update({ where: { id: joined.data.viewerMemberId }, data: { removed: true, leftAt: new Date() } });
    const res = await joinCode(a.token, view.inviteCode!);
    expect(res).toMatchObject({ status: 403, error: { code: "REMOVED_FROM_PROJECT" } });
    // They can't see the project either.
    expect((await call(`/api/projects/${view.basics.id}`, { token: a.token })).status).toBe(404);
  });

  it("lets someone who left come back, keeping their colour when it is still free", async () => {
    const leader = await login(0);
    const view = await createActive(leader.token);
    const a = await login(1);
    const b = await login(2);
    const joined = await joinCode(a.token, view.inviteCode!); // gum
    await testDb.member.update({ where: { id: joined.data.viewerMemberId }, data: { leftAt: new Date() } });
    expect((await call(`/api/projects/${view.basics.id}`, { token: a.token })).status).toBe(404);

    const back = await joinCode(a.token, view.inviteCode!);
    expect(back.data.viewerMemberId).toBe(joined.data.viewerMemberId);
    expect(back.data.members.find((m) => m.id === back.data.viewerMemberId)).toMatchObject({ active: true, color: "gum" });

    // Leave again; someone else takes gum meanwhile; coming back picks a new colour.
    await testDb.member.update({ where: { id: joined.data.viewerMemberId }, data: { leftAt: new Date() } });
    const bJoined = await joinCode(b.token, view.inviteCode!);
    expect(bJoined.data.members.find((m) => m.id === bJoined.data.viewerMemberId)!.color).toBe("gum");
    const again = await joinCode(a.token, view.inviteCode!);
    expect(again.data.members.find((m) => m.id === again.data.viewerMemberId)!.color).toBe("mint");
  });

  it("still lets people join when every package is taken, growing the planned team and telling the leader", async () => {
    const leader = await login(0);
    const view = await createActive(leader.token, { teamSize: 2 });
    const a = await login(1);
    const b = await login(2);
    const joinedA = await joinCode(a.token, view.inviteCode!);
    for (const [i, pkg] of view.packages.entries()) {
      const owner = i === 0 ? view.viewerMemberId : joinedA.data.viewerMemberId;
      await testDb.package.update({ where: { id: pkg.id }, data: { ownerId: owner } });
    }
    const res = await joinCode(b.token, view.inviteCode!);
    expect(res.status).toBe(200);
    expect(res.data.members.filter((m) => m.active)).toHaveLength(3);
    expect(res.data).toMatchObject({ viewerNeedsPackage: true, basics: { teamSize: 3, packageCount: 2 } });
    const preview = await call<JoinPreview>(`/api/join/${view.inviteCode}`, { token: b.token });
    expect(preview.data).toMatchObject({ memberCount: 3, teamSize: 3, freePackages: 0, alreadyMember: true, full: false });

    // The leader hears once that the newcomer has no package.
    const reminders = await testDb.notification.findMany({ where: { userId: leader.user.id, type: "MEMBER_NEEDS_PACKAGE" } });
    expect(reminders.map((n) => [n.audience, n.payload])).toEqual([
      ["ONLY_LEADER", { type: "MEMBER_NEEDS_PACKAGE", member: { memberId: res.data.viewerMemberId, name: "王子杰" }, joined: true }],
    ]);
    await joinCode(b.token, view.inviteCode!);
    await Promise.all([joinCode(b.token, view.inviteCode!), joinCode(b.token, view.inviteCode!)]);
    expect(await testDb.notification.count({ where: { type: "MEMBER_NEEDS_PACKAGE" } })).toBe(1);

    // Leaving clears it; coming back while still no package is free reminds the leader again.
    await call(`/api/projects/${view.basics.id}/leave`, { method: "POST", token: b.token });
    await joinCode(b.token, view.inviteCode!);
    expect(await testDb.notification.count({ where: { type: "MEMBER_NEEDS_PACKAGE" } })).toBe(2);
  });

  it("gives everyone a different colour when many join at once, up to eight people", async () => {
    const leader = await login(0);
    const view = await createActive(leader.token, { teamSize: 8 });
    const people = [await login(1), await login(2), await login(3), await login(4), await login(5)];
    for (const name of ["Mei Ling", "Kumar", "Siti"]) people.push(await extraPerson(name));
    // Eight try to join at the same time: seven fit next to the leader, one is too many.
    const results = await Promise.all(people.map((p) => joinCode(p.token, view.inviteCode!)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(7);
    expect(results.filter((r) => r.error?.code === "TEAM_FULL")).toHaveLength(1);

    const members = await testDb.member.findMany({ where: { projectId: view.basics.id } });
    expect(members).toHaveLength(8);
    expect(new Set(members.map((m) => m.color)).size).toBe(8);
    expect(await testDb.activityEvent.count({ where: { projectId: view.basics.id, type: "JOINED" } })).toBe(7);
  });

  it("marks the joiner's pending invites for that project as accepted", async () => {
    const leader = await login(0);
    const view = await createActive(leader.token);
    const a = await login(1);
    const sent = await call(`/api/projects/${view.basics.id}/invites`, {
      method: "POST",
      token: leader.token,
      body: { targets: "xiaowen@dev.meritai.test @xiaowen-dev" },
    });
    // One person, one invite: the second address is recognised as the same account.
    expect(sent.data).toEqual([
      { target: "xiaowen@dev.meritai.test", result: "INVITED" },
      { target: "@xiaowen-dev", result: "ALREADY_INVITED" },
    ]);
    // An older invite by username (sent before the account existed) is accepted too.
    await testDb.invite.create({ data: { projectId: view.basics.id, invitedById: leader.user.id, githubUsername: "xiaowen-dev" } });
    expect((await call<HomeData>("/api/home", { token: a.token })).data.invites).toHaveLength(1);
    await joinCode(a.token, view.inviteCode!);
    const invites = await testDb.invite.findMany({ where: { projectId: view.basics.id } });
    expect(invites.map((i) => i.status)).toEqual(["ACCEPTED", "ACCEPTED"]);
    expect((await call<HomeData>("/api/home", { token: a.token })).data.invites).toEqual([]);
  });

  it("can't find drafts: they have no code yet", async () => {
    const leader = await login(0);
    const draft = await createDraft(leader.token);
    const project = await testDb.project.findUniqueOrThrow({ where: { id: draft.basics.id } });
    expect(project.inviteCode).toBeNull();
    const view = (await call<ProjectView>(`/api/projects/${draft.basics.id}`, { token: leader.token })).data;
    expect(view.inviteCode).toBeNull();
  });
});

describe("joining a running project (M3)", () => {
  it("stops at 8 active people, for newcomers and people coming back alike", async () => {
    const t = await activeWith(8);
    expect(t.view.members.filter((m) => m.active)).toHaveLength(8);
    const ninth = await person(8);
    const code = t.view.inviteCode!;

    const preview = await call<JoinPreview>(`/api/join/${code}`, { token: ninth.token });
    expect(preview.data).toMatchObject({ memberCount: 8, full: true, alreadyMember: false });
    const refused = await joinCode(ninth.token, code);
    expect(refused).toMatchObject({ status: 409, error: { code: "TEAM_FULL" } });
    expect(await testDb.member.count({ where: { projectId: t.projectId, userId: ninth.user.id } })).toBe(0);

    // Someone already in it isn't "full": joining again just opens the project.
    const own = await call<JoinPreview>(`/api/join/${code}`, { token: t.members[0]!.token });
    expect(own.data).toMatchObject({ alreadyMember: true, full: false });
    expect((await joinCode(t.members[0]!.token, code)).status).toBe(200);

    // One leaves; the newcomer takes the place; the one who left can't come back now.
    const leaver = t.members[6]!;
    expect((await call(`/api/projects/${t.projectId}/leave`, { method: "POST", token: leaver.token })).status).toBe(200);
    expect((await call<JoinPreview>(`/api/join/${code}`, { token: ninth.token })).data.full).toBe(false);
    expect((await joinCode(ninth.token, code)).status).toBe(200);
    expect((await joinCode(leaver.token, code)).error?.code).toBe("TEAM_FULL");
    expect(await testDb.member.count({ where: { projectId: t.projectId, leftAt: null, removed: false } })).toBe(8);
  });

  it("records a real join: joined now, the feed, a new packages version", async () => {
    const t = await activeWith(2);
    const before = await testDb.project.findUniqueOrThrow({ where: { id: t.projectId } });
    const c = await person(2);
    const startedAt = Date.now();
    const res = await joinCode(c.token, t.view.inviteCode!);
    const me = res.data.members.find((m) => m.id === res.data.viewerMemberId)!;
    expect(new Date(me.joinedAt).getTime()).toBeGreaterThanOrEqual(startedAt - 1000);
    expect(res.data.packagesVersion).toBe(before.packagesVersion + 1);
    expect(res.data.basics.teamSize).toBe(3);
    const joined = await testDb.activityEvent.findMany({ where: { projectId: t.projectId, type: "JOINED" }, orderBy: { createdAt: "desc" } });
    expect(joined[0]).toMatchObject({ actorId: me.id, payload: { type: "JOINED" } });
    // Two free packages are left: no reminder.
    expect(await testDb.notification.count({ where: { type: "MEMBER_NEEDS_PACKAGE" } })).toBe(0);
  });
});
