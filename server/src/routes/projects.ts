import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { BriefResult, DraftView, InviteOutcome, ProjectView } from "../../../shared/types";
import type { AppEnv } from "../app";
import { assertDraft, requireActiveMember, requireLeader } from "../lib/access";
import { requireUser } from "../lib/auth";
import { readBody } from "../lib/body";
import { AppError, notFound } from "../lib/errors";
import { conditional } from "../lib/etag";
import { ok } from "../lib/http";
import { idempotent } from "../lib/idempotency";
import { safeFileName } from "../lib/file-name";
import { extractBriefText, MAX_BRIEF_BYTES } from "../lib/plan/extract";
import { consumeRate, RATE_RULES } from "../lib/rate-limit";
import { addActiveTask, updateActiveTask } from "../services/active-tasks";
import { projectToken } from "../services/cache-tokens";
import { applyBrief, briefFailure } from "../services/brief";
import { deleteProject, restoreProject } from "../services/project-delete";
import { endProject, reopenProject } from "../services/lifecycle";
import { createInvites } from "../services/invites";
import { confirmPlan, createDraft, deleteDraft, resetInviteCode, updateProject } from "../services/projects";
import {
  ActiveTaskPatchSchema,
  ActiveTaskSchema,
  BriefTextSchema,
  DeleteProjectSchema,
  InviteSchema,
  ManualPlanSchema,
  ProjectBasicsSchema,
  ProjectPatchSchema,
  ReopenSchema,
  SplitLargeSchema,
  TaskPatchSchema,
  TaskSchema,
} from "../services/schemas";
import { addTask, deleteTask, replaceTasks, splitLargeTasks, updateTask } from "../services/tasks";
import { loadDraftView, loadProjectView, loadViewFor, openProjectView } from "../services/views";
import { clock } from "../lib/clock";

export const projectRoutes = new Hono<AppEnv>();

/** Access for leader-only routes; also used as middleware so a big upload is refused before it is read. */
async function leaderOf(c: Parameters<typeof requireUser>[0]) {
  const user = await requireUser(c);
  return { user, ...(await requireLeader(c.var.db, c.req.param("id")!, user.id)) };
}

/** Unfinished drafts one person may keep (A6): each holds a brief and a plan. */
export const MAX_DRAFTS_PER_USER = 20;

projectRoutes.post("/", idempotent, async (c) => {
  const user = await requireUser(c);
  await consumeRate(c.var.db, [{ rule: RATE_RULES.draftsUser, subject: user.id }]);
  const drafts = await c.var.db.project.count({ where: { createdById: user.id, status: "DRAFT", deletedAt: null } });
  if (drafts >= MAX_DRAFTS_PER_USER) {
    throw new AppError(409, "DRAFT_LIMIT", `At most ${MAX_DRAFTS_PER_USER} unfinished projects; delete one first`);
  }
  const input = await readBody(c, ProjectBasicsSchema);
  const id = await createDraft(c.var.db, user, input);
  return ok<DraftView>(c, await loadDraftView(c.var.db, id), 201);
});

projectRoutes.get("/:id/draft", async (c) => {
  const user = await requireUser(c);
  const { project, member } = await requireActiveMember(c.var.db, c.req.param("id"), user.id);
  if (member.role !== "LEADER") throw notFound("Project");
  assertDraft(project);
  return ok<DraftView>(c, await loadDraftView(c.var.db, project.id));
});

projectRoutes.get("/:id", async (c) => {
  const user = await requireUser(c);
  const projectId = c.req.param("id");
  const now = clock.now();
  // Conditional (B2). The view checks the membership against the members it loads (404 for anyone who
  // can't see it); the token is null for them, so a 404 is never cached.
  const token = await projectToken(c.var.db, projectId, user, now);
  return conditional<ProjectView>(c, token, () => openProjectView(c.var.db, projectId, user.id, now));
});

projectRoutes.patch("/:id", async (c) => {
  const { user, project } = await leaderOf(c);
  const input = await readBody(c, ProjectPatchSchema);
  // Present only when the deadline changed: the tasks whose due dates moved with it.
  const { adjustedTasks } = await updateProject(c.var.db, project.id, user.id, input);
  const extra = adjustedTasks ? { adjustedTasks } : {};
  if (project.status === "DRAFT") return ok<DraftView>(c, { ...(await loadDraftView(c.var.db, project.id)), ...extra });
  return ok<ProjectView>(c, { ...(await loadViewFor(c.var.db, project.id, user.id)), ...extra });
});

projectRoutes.delete("/:id", async (c) => {
  const { project } = await leaderOf(c);
  await deleteDraft(c.var.db, project.id);
  return ok(c, null);
});

// 为所有人删除项目 (a running project; drafts use DELETE above). `confirm`: the project tag, typed.
projectRoutes.post("/:id/delete", async (c) => {
  const { user, project } = await leaderOf(c);
  const { confirm } = await readBody(c, DeleteProjectSchema);
  await deleteProject(c.var.db, project.id, user.id, confirm);
  return ok(c, null);
});

// 结束项目 (M5): the leader, ACTIVE or AWAITING_CONFIRM. Answers with the project as it is now (ENDED).
projectRoutes.post("/:id/end", async (c) => {
  const user = await requireUser(c);
  const projectId = c.req.param("id");
  await endProject(c.var.db, projectId, user.id, clock.now());
  return ok<ProjectView>(c, await loadViewFor(c.var.db, projectId, user.id));
});

// 重新打开 (M5): the leader, ENDED and before purgeAfter; a new deadline when the old one has passed.
projectRoutes.post("/:id/reopen", async (c) => {
  const user = await requireUser(c);
  const projectId = c.req.param("id");
  const input = c.req.header("content-type")?.includes("application/json") ? await readBody(c, ReopenSchema) : {};
  const now = clock.now();
  const { adjustedTasks } = await reopenProject(c.var.db, projectId, user.id, input, now);
  return ok<ProjectView>(c, { ...(await loadViewFor(c.var.db, projectId, user.id, now)), ...(adjustedTasks ? { adjustedTasks } : {}) });
});

// 恢复项目: the leader who deleted it, within 7 days. The project is hidden, so the usual access check can't run.
projectRoutes.post("/:id/restore", async (c) => {
  const user = await requireUser(c);
  await restoreProject(c.var.db, c.req.param("id"), user.id);
  return ok(c, null);
});

projectRoutes.post(
  "/:id/brief",
  async (c, next) => {
    const { user, project } = await leaderOf(c);
    assertDraft(project);
    // Each brief is parsed (and a file extracted) at some CPU cost: counted before the body is read.
    await consumeRate(c.var.db, [{ rule: RATE_RULES.briefUser, subject: user.id }]);
    await next();
  },
  // Refuse oversized uploads without reading them; the multipart envelope needs a little room.
  bodyLimit({ maxSize: MAX_BRIEF_BYTES + 256 * 1024, onError: (c) => ok<BriefResult>(c, briefFailure("TOO_LARGE", null, null)) }),
  async (c) => {
    const { project } = await leaderOf(c);
    const isMultipart = (c.req.header("Content-Type") ?? "").toLowerCase().startsWith("multipart/form-data");
    if (!isMultipart) {
      const { text } = await readBody(c, BriefTextSchema);
      const size = Buffer.byteLength(text, "utf8");
      if (size > MAX_BRIEF_BYTES) return ok<BriefResult>(c, briefFailure("TOO_LARGE", null, size));
      // Typed in 「打字描述」: one line = one task when there are no scores or list markers.
      return ok<BriefResult>(c, await applyBrief(c.var.db, project.id, { text, fileName: null, sizeBytes: null, typed: true }));
    }

    const form = await c.req.parseBody();
    const file = form.file;
    if (!(file instanceof File)) throw new AppError(400, "VALIDATION", 'Send the brief as the multipart field "file"');
    const fileName = safeFileName(form.fileName, file.name);
    if (file.size > MAX_BRIEF_BYTES) return ok<BriefResult>(c, briefFailure("TOO_LARGE", fileName, file.size));
    const extracted = await extractBriefText(new Uint8Array(await file.arrayBuffer()), fileName, file.type);
    if (!extracted.ok) return ok<BriefResult>(c, briefFailure(extracted.reason, fileName, file.size));
    return ok<BriefResult>(c, await applyBrief(c.var.db, project.id, { text: extracted.text, fileName, sizeBytes: file.size }));
  },
);

projectRoutes.put("/:id/tasks", async (c) => {
  const { project } = await leaderOf(c);
  const { tasks } = await readBody(c, ManualPlanSchema);
  await replaceTasks(c.var.db, project.id, tasks);
  return ok<DraftView>(c, await loadDraftView(c.var.db, project.id));
});

projectRoutes.post("/:id/tasks", idempotent, async (c) => {
  const { user, project } = await leaderOf(c);
  if (project.status !== "DRAFT") {
    // M3: the leader adds tasks to a running project too (the service re-checks ACTIVE under the lock).
    const input = await readBody(c, ActiveTaskSchema);
    await addActiveTask(c.var.db, project.id, user.id, input);
    return ok<ProjectView>(c, await loadViewFor(c.var.db, project.id, user.id), 201);
  }
  const input = await readBody(c, TaskSchema);
  await addTask(c.var.db, project.id, input);
  return ok<DraftView>(c, await loadDraftView(c.var.db, project.id), 201);
});

projectRoutes.patch("/:id/tasks/:taskId", async (c) => {
  const user = await requireUser(c);
  const { project, member } = await requireActiveMember(c.var.db, c.req.param("id"), user.id);
  if (project.status !== "DRAFT") {
    // M4: the leader edits a running project's task; its owner may change the description only
    // (updateActiveTask re-checks both under the project lock).
    const input = await readBody(c, ActiveTaskPatchSchema);
    await updateActiveTask(c.var.db, project.id, c.req.param("taskId"), user.id, input);
    return ok<ProjectView>(c, await loadViewFor(c.var.db, project.id, user.id));
  }
  // A draft is only visible to its leader (requireActiveMember answers 404 to anyone else).
  if (member.role !== "LEADER") throw notFound("Project");
  const input = await readBody(c, TaskPatchSchema);
  await updateTask(c.var.db, project.id, c.req.param("taskId"), input);
  return ok<DraftView>(c, await loadDraftView(c.var.db, project.id));
});

projectRoutes.delete("/:id/tasks/:taskId", async (c) => {
  const { project } = await leaderOf(c);
  await deleteTask(c.var.db, project.id, c.req.param("taskId"));
  return ok<DraftView>(c, await loadDraftView(c.var.db, project.id));
});

projectRoutes.post("/:id/split-large", async (c) => {
  const { user, project } = await leaderOf(c);
  // The body is optional: the app sends the language it shows, which it doesn't save on the server.
  const { locale } = c.req.header("content-type")?.includes("application/json") ? await readBody(c, SplitLargeSchema) : {};
  await splitLargeTasks(c.var.db, project.id, locale ?? user.locale);
  return ok<DraftView>(c, await loadDraftView(c.var.db, project.id));
});

projectRoutes.post("/:id/confirm", async (c) => {
  const { project, member } = await leaderOf(c);
  await confirmPlan(c.var.db, project.id);
  return ok<ProjectView>(c, await loadProjectView(c.var.db, project.id, member));
});

projectRoutes.post("/:id/invite-code/reset", async (c) => {
  const { user, project } = await leaderOf(c);
  await consumeRate(c.var.db, [{ rule: RATE_RULES.codeResetUser, subject: user.id }]);
  return ok<{ inviteCode: string }>(c, { inviteCode: await resetInviteCode(c.var.db, project.id, user.id) });
});

projectRoutes.post("/:id/invites", idempotent, async (c) => {
  const user = await requireUser(c);
  const projectId = c.req.param("id")!;
  // Members only before the project's bucket counts, so outsiders can't use up its invites.
  await requireActiveMember(c.var.db, projectId, user.id);
  await consumeRate(c.var.db, [
    { rule: RATE_RULES.invitesUser, subject: user.id },
    { rule: RATE_RULES.invitesProject, subject: projectId },
  ]);
  const { targets } = await readBody(c, InviteSchema);
  // createInvites checks the membership again under the project lock.
  return ok<InviteOutcome[]>(c, await createInvites(c.var.db, c.req.param("id")!, user, targets));
});

/** The brief upload's display name (lib/file-name.ts; kept under its old name for the tests). */
export const briefFileName = (field: unknown, partName: string): string => safeFileName(field, partName);
