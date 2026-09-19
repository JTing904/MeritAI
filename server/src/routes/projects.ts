import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { BriefResult, DraftView, InviteOutcome, ProjectView } from "../../../shared/types";
import type { AppEnv } from "../app";
import { assertDraft, requireActiveMember, requireLeader } from "../lib/access";
import { requireUser } from "../lib/auth";
import { readBody } from "../lib/body";
import { AppError, notFound } from "../lib/errors";
import { ok } from "../lib/http";
import { extractBriefText, MAX_BRIEF_BYTES } from "../lib/plan/extract";
import { addActiveTask } from "../services/active-tasks";
import { applyBrief, briefFailure } from "../services/brief";
import { createInvites } from "../services/invites";
import { confirmPlan, createDraft, deleteDraft, resetInviteCode, updateProject } from "../services/projects";
import {
  ActiveTaskSchema,
  BriefTextSchema,
  InviteSchema,
  ManualPlanSchema,
  ProjectBasicsSchema,
  ProjectPatchSchema,
  SplitLargeSchema,
  TaskPatchSchema,
  TaskSchema,
} from "../services/schemas";
import { addTask, deleteTask, replaceTasks, splitLargeTasks, updateTask } from "../services/tasks";
import { loadDraftView, loadProjectView, loadViewFor, openProjectView } from "../services/views";

export const projectRoutes = new Hono<AppEnv>();

/** Access for leader-only routes; also used as middleware so a big upload is refused before it is read. */
async function leaderOf(c: Parameters<typeof requireUser>[0]) {
  const user = await requireUser(c);
  return { user, ...(await requireLeader(c.var.db, c.req.param("id")!, user.id)) };
}

projectRoutes.post("/", async (c) => {
  const user = await requireUser(c);
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
  const { project, member } = await requireActiveMember(c.var.db, c.req.param("id"), user.id);
  return ok<ProjectView>(c, await openProjectView(c.var.db, project.id, member));
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

projectRoutes.post(
  "/:id/brief",
  async (c, next) => {
    assertDraft((await leaderOf(c)).project);
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
    const fileName = briefFileName(form.fileName, file.name);
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

projectRoutes.post("/:id/tasks", async (c) => {
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
  const { project } = await leaderOf(c);
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
  return ok<{ inviteCode: string }>(c, { inviteCode: await resetInviteCode(c.var.db, project.id, user.id) });
});

projectRoutes.post("/:id/invites", async (c) => {
  const user = await requireUser(c);
  const { project } = await requireActiveMember(c.var.db, c.req.param("id"), user.id);
  const { targets } = await readBody(c, InviteSchema);
  return ok<InviteOutcome[]>(c, await createInvites(c.var.db, project.id, user, targets));
});

/**
 * The upload's display name: the separate "fileName" field when sent (UTF-8, from the app), otherwise
 * the part's filename, which some clients percent-encode (Expo encodes 「作业说明.pdf」 as %E4%BD%9C…).
 */
export function briefFileName(field: unknown, partName: string): string {
  let name = typeof field === "string" && field.trim() ? field.trim() : partName;
  if (/%[0-9A-Fa-f]{2}/.test(name)) {
    try {
      name = decodeURIComponent(name);
    } catch {
      // Not valid percent-encoding: keep it as sent.
    }
  }
  const printable = Array.from(name).filter((ch) => ch.charCodeAt(0) > 0x1f && ch.charCodeAt(0) !== 0x7f).join("");
  return printable.slice(0, 255) || "brief";
}
