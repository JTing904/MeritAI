import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { HomeData, InviteOutcome, ProjectView } from "../../shared/types";
import { parseTarget, splitTargets } from "../src/services/invites";
import { call, testDb } from "./helpers";
import { activeWith, createActive, createDraft, freshDb, joinCode, login, person } from "./project-fixtures";

beforeEach(freshDb);
afterAll(() => testDb.$disconnect());

const invite = (projectId: string, token: string, targets: string) =>
  call<InviteOutcome[]>(`/api/projects/${projectId}/invites`, { method: "POST", token, body: { targets } });

describe("reading invite targets", () => {
  it("splits on commas, spaces and new lines, dropping repeats", () => {
    expect(splitTargets("a@b.com, @Zijie-Dev\nbowen-dev；x@y，  a@b.com ZIJIE-dev")).toEqual([
      "a@b.com",
      "@Zijie-Dev",
      "bowen-dev",
      "x@y",
    ]);
    expect(splitTargets(" \n , ")).toEqual([]);
  });

  it("tells emails from GitHub usernames", () => {
    expect(parseTarget("Siti@UM.edu.my")).toEqual({ target: "Siti@UM.edu.my", email: "siti@um.edu.my", githubUsername: null });
    expect(parseTarget("@Zijie-Dev")).toEqual({ target: "@Zijie-Dev", email: null, githubUsername: "zijie-dev" });
    expect(parseTarget("bowen")).toEqual({ target: "bowen", email: null, githubUsername: "bowen" });
    for (const bad of ["x@y", "-bad", "bad-", "a--b", "@", "name@", "a".repeat(40), "王子杰"]) {
      expect(parseTarget(bad), bad).toEqual({ target: bad, invalid: true });
    }
  });
});

describe("POST /api/projects/:id/invites", () => {
  it("invites by email and GitHub username, stored lower-case", async () => {
    const leader = await login(0);
    const view = await createActive(leader.token);
    const res = await invite(view.basics.id, leader.token, "XiaoWen@dev.meritai.test, @Zijie-Dev\nnewbie@student.um.edu.my bad@@x");
    expect(res.status).toBe(200);
    expect(res.data).toEqual([
      { target: "XiaoWen@dev.meritai.test", result: "INVITED" },
      { target: "@Zijie-Dev", result: "INVITED" },
      { target: "newbie@student.um.edu.my", result: "INVITED" },
      { target: "bad@@x", result: "INVALID" },
    ]);
    const rows = await testDb.invite.findMany({ where: { projectId: view.basics.id } });
    expect(rows.map((r) => [r.email ?? r.githubUsername, r.status, r.invitedById]).sort()).toEqual([
      ["newbie@student.um.edu.my", "PENDING", leader.user.id],
      ["xiaowen@dev.meritai.test", "PENDING", leader.user.id],
      ["zijie-dev", "PENDING", leader.user.id],
    ]);
  });

  it("reports people already in the project or already invited", async () => {
    const leader = await login(0);
    const member = await login(1);
    const view = await createActive(leader.token);
    await joinCode(member.token, view.inviteCode!);
    await invite(view.basics.id, leader.token, "zijie@dev.meritai.test");

    const res = await invite(
      view.basics.id,
      leader.token,
      "siyuan@dev.meritai.test @xiaowen-dev zijie@dev.meritai.test @zijie-dev newbie@um.edu.my",
    );
    expect(res.data.map((o) => o.result)).toEqual(["ALREADY_MEMBER", "ALREADY_MEMBER", "ALREADY_INVITED", "ALREADY_INVITED", "INVITED"]);
    const again = await invite(view.basics.id, leader.token, "NEWBIE@um.edu.my");
    expect(again.data).toEqual([{ target: "NEWBIE@um.edu.my", result: "ALREADY_INVITED" }]);
  });

  it("invites an address once when two members invite it at the same moment", async () => {
    const leader = await login(0);
    const member = await login(1);
    const view = await createActive(leader.token);
    await joinCode(member.token, view.inviteCode!);
    const [x, y] = await Promise.all([
      invite(view.basics.id, leader.token, "newbie@student.um.edu.my"),
      invite(view.basics.id, member.token, "Newbie@student.um.edu.my"),
    ]);
    expect([x.status, y.status]).toEqual([200, 200]);
    expect([x.data[0]!.result, y.data[0]!.result].sort()).toEqual(["ALREADY_INVITED", "INVITED"]);
    expect(await testDb.invite.count({ where: { projectId: view.basics.id } })).toBe(1);
  });

  it("lets any active member invite, but nobody else", async () => {
    const leader = await login(0);
    const member = await login(1);
    const stranger = await login(2);
    const view = await createActive(leader.token);
    await joinCode(member.token, view.inviteCode!);
    expect((await invite(view.basics.id, member.token, "@bowen-dev")).data).toEqual([{ target: "@bowen-dev", result: "INVITED" }]);
    expect((await invite(view.basics.id, stranger.token, "@jiaxin-dev")).status).toBe(404);
    expect((await invite(view.basics.id, "", "@jiaxin-dev")).status).toBe(401);
  });

  it("limits the request size and refuses empty input", async () => {
    const leader = await login(0);
    const view = await createActive(leader.token);
    const many = Array.from({ length: 21 }, (_, i) => `user${i}@uni.edu.my`).join(",");
    expect((await invite(view.basics.id, leader.token, many)).error?.code).toBe("VALIDATION");
    expect((await invite(view.basics.id, leader.token, " ,\n ")).error?.code).toBe("VALIDATION");
    const twenty = Array.from({ length: 20 }, (_, i) => `user${i}@uni.edu.my`).join(" ");
    expect((await invite(view.basics.id, leader.token, twenty)).data).toHaveLength(20);
  });

  it("needs a confirmed project that hasn't ended", async () => {
    const leader = await login(0);
    const draft = await createDraft(leader.token);
    expect((await invite(draft.basics.id, leader.token, "@bowen-dev")).error?.code).toBe("CONFLICT");
    const view = await createActive(leader.token);
    await testDb.project.update({ where: { id: view.basics.id }, data: { status: "ENDED" } });
    expect((await invite(view.basics.id, leader.token, "@bowen-dev")).error?.code).toBe("PROJECT_ENDED");
  });
});

describe("answering invites", () => {
  async function invited(targets = "xiaowen@dev.meritai.test", inviteeIndex = 1) {
    const leader = await login(0);
    const invitee = await login(inviteeIndex);
    const view = await createActive(leader.token);
    await invite(view.basics.id, leader.token, targets);
    const home = await call<HomeData>("/api/home", { token: invitee.token });
    return { leader, invitee, view, inviteId: home.data.invites[0]!.id };
  }

  it("shows the invite on the invitee's home and joins on accept", async () => {
    const { invitee, view, inviteId } = await invited();
    const home = await call<HomeData>("/api/home", { token: invitee.token });
    expect(home.data.invites).toEqual([
      {
        id: inviteId,
        projectId: view.basics.id,
        projectName: "校园二手市场 App",
        courseName: "软件工程",
        inviterName: "陈思远",
        memberCount: 1,
        teamSize: 5,
      },
    ]);

    const res = await call<ProjectView>(`/api/invites/${inviteId}/accept`, { method: "POST", token: invitee.token });
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({ viewerRole: "MEMBER", inviteCode: view.inviteCode });
    expect(res.data.members.find((m) => m.id === res.data.viewerMemberId)).toMatchObject({ name: "林晓雯", color: "gum" });
    const row = await testDb.invite.findUniqueOrThrow({ where: { id: inviteId } });
    expect(row.status).toBe("ACCEPTED");
    expect(row.respondedAt).not.toBeNull();

    const after = await call<HomeData>("/api/home", { token: invitee.token });
    expect(after.data.invites).toEqual([]);
    expect(after.data.projects.map((p) => p.id)).toEqual([view.basics.id]);

    // Accepting twice is harmless.
    const again = await call<ProjectView>(`/api/invites/${inviteId}/accept`, { method: "POST", token: invitee.token });
    expect(again.data.viewerMemberId).toBe(res.data.viewerMemberId);
  });

  it("matches invites by GitHub username too, whatever the case", async () => {
    const { invitee, inviteId } = await invited("@XiaoWen-Dev");
    const res = await call<ProjectView>(`/api/invites/${inviteId}/accept`, { method: "POST", token: invitee.token });
    expect(res.status).toBe(200);
    // Also when the account's email has capitals.
    const leader = await login(0);
    const other = await login(2);
    await testDb.user.update({ where: { id: other.user.id }, data: { email: "ZiJie@Dev.MeritAI.test" } });
    const view = await createActive(leader.token);
    await invite(view.basics.id, leader.token, "zijie@dev.meritai.test");
    expect((await call<HomeData>("/api/home", { token: other.token })).data.invites).toHaveLength(1);
  });

  it("is only for the person invited", async () => {
    const { inviteId } = await invited();
    const someoneElse = await login(2);
    expect((await call(`/api/invites/${inviteId}/accept`, { method: "POST", token: someoneElse.token })).status).toBe(404);
    expect((await call(`/api/invites/${inviteId}/decline`, { method: "POST", token: someoneElse.token })).status).toBe(404);
    expect((await call(`/api/invites/nope/accept`, { method: "POST", token: someoneElse.token })).status).toBe(404);
  });

  it("declines: the card disappears and the invite can't be accepted later", async () => {
    const { leader, invitee, view, inviteId } = await invited();
    await testDb.invite.create({ data: { projectId: view.basics.id, invitedById: leader.user.id, githubUsername: "xiaowen-dev" } });
    const res = await call(`/api/invites/${inviteId}/decline`, { method: "POST", token: invitee.token });
    expect(res).toMatchObject({ status: 200, data: null });
    const rows = await testDb.invite.findMany({ where: { projectId: view.basics.id } });
    expect(rows.map((r) => r.status)).toEqual(["DECLINED", "DECLINED"]);
    expect((await call<HomeData>("/api/home", { token: invitee.token })).data.invites).toEqual([]);
    expect((await call(`/api/invites/${inviteId}/decline`, { method: "POST", token: invitee.token })).status).toBe(200);
    expect((await call(`/api/invites/${inviteId}/accept`, { method: "POST", token: invitee.token })).error?.code).toBe("CONFLICT");
  });

  it("follows the invite-code rules: removed people stay out, ended projects take nobody", async () => {
    const { invitee, view, inviteId } = await invited();
    const joined = await joinCode(invitee.token, view.inviteCode!);
    await testDb.member.update({ where: { id: joined.data.viewerMemberId }, data: { removed: true, leftAt: new Date() } });
    await testDb.invite.update({ where: { id: inviteId }, data: { status: "PENDING" } });
    const removed = await call(`/api/invites/${inviteId}/accept`, { method: "POST", token: invitee.token });
    expect(removed.error?.code).toBe("REMOVED_FROM_PROJECT");

    const second = await invited("jiaxin@dev.meritai.test", 4);
    await testDb.project.update({ where: { id: second.view.basics.id }, data: { status: "ENDED" } });
    const ended = await call(`/api/invites/${second.inviteId}/accept`, { method: "POST", token: second.invitee.token });
    expect(ended.error?.code).toBe("PROJECT_ENDED");
    // Invites to ended projects no longer show on home.
    expect((await call<HomeData>("/api/home", { token: second.invitee.token })).data.invites).toEqual([]);
  });

  it("can't take a ninth active person, and joining through it is a real join otherwise", async () => {
    const t = await activeWith(8);
    const ninth = await person(8);
    await invite(t.projectId, t.leader.token, "tester9@dev.meritai.test");
    const inviteId = (await call<HomeData>("/api/home", { token: ninth.token })).data.invites[0]!.id;

    const full = await call(`/api/invites/${inviteId}/accept`, { method: "POST", token: ninth.token });
    expect(full).toMatchObject({ status: 409, error: { code: "TEAM_FULL" } });
    // Nothing changed: still invited, still not a member.
    expect(await testDb.invite.findUniqueOrThrow({ where: { id: inviteId } })).toMatchObject({ status: "PENDING", respondedAt: null });
    expect(await testDb.member.count({ where: { projectId: t.projectId, userId: ninth.user.id } })).toBe(0);

    // A place frees up: accepting works, and counts like joining with the code.
    await call(`/api/projects/${t.projectId}/leave`, { method: "POST", token: t.members[3]!.token });
    const res = await call<ProjectView>(`/api/invites/${inviteId}/accept`, { method: "POST", token: ninth.token });
    expect(res.status).toBe(200);
    const joined = await testDb.activityEvent.findMany({ where: { projectId: t.projectId, type: "JOINED", actorId: res.data.viewerMemberId } });
    expect(joined).toHaveLength(1);
    // The one who left can't come back through an invite either while it is full.
    await invite(t.projectId, t.leader.token, "jiaxin@dev.meritai.test");
    const back = (await call<HomeData>("/api/home", { token: t.members[3]!.token })).data.invites[0]!.id;
    expect((await call(`/api/invites/${back}/accept`, { method: "POST", token: t.members[3]!.token })).error?.code).toBe("TEAM_FULL");
    // Accepting twice stays harmless.
    expect((await call(`/api/invites/${inviteId}/accept`, { method: "POST", token: ninth.token })).status).toBe(200);
    expect(await testDb.activityEvent.count({ where: { projectId: t.projectId, type: "JOINED", actorId: res.data.viewerMemberId } })).toBe(1);
  });
});
