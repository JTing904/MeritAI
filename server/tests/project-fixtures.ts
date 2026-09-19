// Shared setup for the project tests (M2: projects, join, invites, home; M3: packages, swaps, members…).
import { packageCount } from "../../shared/planning";
import type {
  DevPerson,
  DevTaskStatusInput,
  DraftView,
  LoginResult,
  ProjectBasicsInput,
  ProjectView,
  TaskInput,
} from "../../shared/types";
import { DEV_EMAIL_DOMAIN } from "../src/routes/dev";
import { DEV_PEOPLE, seed } from "../prisma/seed";
import { call, resetDb, testApp, testDb } from "./helpers";

export const DAY = 24 * 60 * 60 * 1000;
export const KL = "Asia/Kuala_Lumpur";

export async function freshDb() {
  await resetDb();
  await seed(testDb);
}

/** Signs in one of the seeded people (0 = 陈思远, 1 = 林晓雯, 2 = 王子杰, 3 = 张博文, 4 = 李嘉欣, 5 = Ahmad). */
export async function login(index = 0): Promise<LoginResult> {
  const people = await call<DevPerson[]>("/api/dev/people");
  const res = await call<LoginResult>("/api/dev/login", { method: "POST", body: { userId: people.data[index]!.id } });
  return res.data;
}

/** Creates an extra dev-login person (beyond the six seeded) and signs them in. */
export async function extraPerson(name: string): Promise<LoginResult> {
  const slug = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  const user = await testDb.user.create({ data: { name, email: `${slug}${DEV_EMAIL_DOMAIN}`, githubUsername: `${slug}-dev` } });
  const res = await call<LoginResult>("/api/dev/login", { method: "POST", body: { userId: user.id } });
  return res.data;
}

export const inDays = (days: number) => new Date(Date.now() + days * DAY).toISOString();

export function basics(over: Partial<ProjectBasicsInput> = {}): ProjectBasicsInput {
  return {
    name: "校园二手市场 App",
    shortCode: "CS302",
    courseName: "软件工程",
    groupLabel: "第 7 组",
    deadline: inDays(49),
    timezone: KL,
    teamSize: 5,
    leaderManages: false,
    ...over,
  };
}

/** The Rules mockup: 4 scored items, 100 分 in total (as tenths). */
export const RUBRIC_TASKS: TaskInput[] = [
  { title: "书面报告", kind: "DOC", points: 400 },
  { title: "口头报告", kind: "DESIGN", points: 300 },
  { title: "问卷调查", kind: "RESEARCH", points: 200 },
  { title: "小组会议记录", kind: "MEETING", points: 100 },
];

export async function createDraft(token: string, over: Partial<ProjectBasicsInput> = {}): Promise<DraftView> {
  const res = await call<DraftView>("/api/projects", { method: "POST", token, body: basics(over) });
  if (res.status !== 201) throw new Error(`createDraft failed: ${res.status} ${JSON.stringify(res.error)}`);
  return res.data;
}

/** A confirmed (ACTIVE) project with the given tasks, led by `token`'s user. */
export async function createActive(
  token: string,
  { tasks = RUBRIC_TASKS, ...over }: Partial<ProjectBasicsInput> & { tasks?: TaskInput[] } = {},
): Promise<ProjectView> {
  const draft = await createDraft(token, over);
  const put = await call(`/api/projects/${draft.basics.id}/tasks`, { method: "PUT", token, body: { tasks } });
  if (put.status !== 200) throw new Error(`PUT tasks failed: ${JSON.stringify(put.error)}`);
  const res = await call<ProjectView>(`/api/projects/${draft.basics.id}/confirm`, { method: "POST", token });
  if (res.status !== 200) throw new Error(`confirm failed: ${JSON.stringify(res.error)}`);
  return res.data;
}

/** Joins with the project's invite code. */
export async function joinCode(token: string, code: string) {
  return call<ProjectView>(`/api/join/${encodeURIComponent(code)}`, { method: "POST", token });
}

/** Sends a multipart upload the way the app does (field "file"). */
export async function upload(path: string, token: string, file: File) {
  const form = new FormData();
  form.append("file", file);
  const res = await testApp.request(path, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
  const json = (await res.json()) as { success: boolean; data: unknown; error: { code: string } | null };
  return { status: res.status, ...json };
}

// ─── M3: teams, picking, starting ─────────────────────────────────────────────

/** Person `i`: the six seeded people first (see login), then extra dev-login people "Tester 7", "Tester 8". */
export async function person(i: number): Promise<LoginResult> {
  if (i < DEV_PEOPLE.length) return login(i);
  const slug = `tester${i + 1}`;
  const user = await testDb.user.upsert({
    where: { email: `${slug}${DEV_EMAIL_DOMAIN}` },
    update: {},
    create: { name: `Tester ${i + 1}`, email: `${slug}${DEV_EMAIL_DOMAIN}`, githubUsername: `${slug}-dev` },
  });
  const res = await call<LoginResult>("/api/dev/login", { method: "POST", body: { userId: user.id } });
  return res.data;
}

export type ActiveTeam = {
  projectId: string;
  /** Person 0 (陈思远). */
  leader: LoginResult;
  /** People 1 … n−1, joined by invite code in that order. */
  members: LoginResult[];
  /** The leader's view after everyone joined. */
  view: ProjectView;
};

/**
 * An ACTIVE project with `n` people (2–8; teamSize = n): person 0 leads, people 1 … n−1 join by code.
 * Default plan: two equal tasks per package, so every package holds tasks. Nobody has picked yet.
 */
export async function activeWith(
  n: number,
  { leaderManages = false, tasks, ...over }: Partial<ProjectBasicsInput> & { tasks?: TaskInput[] } = {},
): Promise<ActiveTeam> {
  const leader = await person(0);
  const count = packageCount(n, leaderManages);
  const plan = tasks ?? Array.from({ length: count * 2 }, (_, i) => ({ title: `任务 ${i + 1}`, kind: "DOC" as const, points: 100 }));
  const created = await createActive(leader.token, { teamSize: n, leaderManages, tasks: plan, ...over });
  const projectId = created.basics.id;
  const members: LoginResult[] = [];
  for (let i = 1; i < n; i++) {
    const p = await person(i);
    const res = await joinCode(p.token, created.inviteCode!);
    if (res.status !== 200) throw new Error(`join failed: ${res.status} ${JSON.stringify(res.error)}`);
    members.push(p);
  }
  return { projectId, leader, members, view: await viewAs(leader.token, projectId) };
}

/** GET /api/projects/:id as this person (throws unless 200). */
export async function viewAs(token: string, projectId: string): Promise<ProjectView> {
  const res = await call<ProjectView>(`/api/projects/${projectId}`, { token });
  if (res.status !== 200) throw new Error(`view failed: ${res.status} ${JSON.stringify(res.error)}`);
  return res.data;
}

/** Picks 「任务包 {index}」 (looked up in this person's view first). Returns the raw response. */
export async function pickAs(token: string, projectId: string, index: number) {
  const view = await viewAs(token, projectId);
  const pkg = view.packages.find((p) => p.index === index);
  if (!pkg) throw new Error(`No package ${index}`);
  return call<ProjectView>(`/api/projects/${projectId}/packages/${pkg.id}/pick`, { method: "POST", token });
}

/** 开始做 as this person. Returns the raw response. */
export async function startAs(token: string, projectId: string, taskId: string) {
  return call<ProjectView>(`/api/projects/${projectId}/tasks/${taskId}/start`, { method: "POST", token });
}

/** The development status endpoint as this person (a member of the task's project; dev login is on in tests). */
export async function devStatus(token: string, taskId: string, status: DevTaskStatusInput["status"]) {
  return call<null>(`/api/dev/tasks/${taskId}/status`, { method: "POST", token, body: { status } });
}
