import { Hono } from "hono";
import type { BriefView, MyTasksView, TaskDetail } from "../../../shared/types";
import type { AppEnv } from "../app";
import { requireActiveMember } from "../lib/access";
import { requireUser } from "../lib/auth";
import { readBody } from "../lib/body";
import { conditional } from "../lib/etag";
import { ok } from "../lib/http";
import { myTasksToken, taskToken } from "../services/cache-tokens";
import { loadBrief } from "../services/brief-view";
import { replaceChecklist, tickItem } from "../services/checklist";
import { myTasks } from "../services/my-tasks";
import { setPrereq } from "../services/prereq";
import { ChecklistSchema, PrereqSchema, TickSchema } from "../services/schemas";
import { loadTaskDetail, loadTaskDetailFor } from "../services/task-views";

// The task page's reads and small edits (M4 spec §6): taskRoutes → /projects (detail, checklist,
// prerequisite, brief), myTaskRoutes → /tasks (我的任务). One router per base path. The writes check the
// membership under the project lock and the detail reads it with the task (A14), so only the brief checks here.
export const taskRoutes = new Hono<AppEnv>();
export const myTaskRoutes = new Hono<AppEnv>();

type Ctx = Parameters<typeof requireUser>[0];

/** The caller and the route's ids; the writes check the membership under the project lock. */
async function who(c: Ctx) {
  const user = await requireUser(c);
  return { user, projectId: c.req.param("id")!, taskId: c.req.param("taskId")! };
}

/** For reads that don't check it themselves. */
async function asMember(c: Ctx) {
  const ids = await who(c);
  await requireActiveMember(c.var.db, ids.projectId, ids.user.id);
  return ids;
}

taskRoutes.get("/:id/tasks/:taskId", async (c) => {
  const user = await requireUser(c);
  const projectId = c.req.param("id");
  const taskId = c.req.param("taskId");
  const now = new Date();
  // Conditional (B2). The detail checks the membership against the members it loads (404 for anyone
  // who can't see it); the token is null for them.
  const token = await taskToken(c.var.db, projectId, taskId, user, now);
  return conditional<TaskDetail>(c, token, () => loadTaskDetail(c.var.db, projectId, taskId, { userId: user.id }, now));
});

taskRoutes.put("/:id/tasks/:taskId/checklist", async (c) => {
  const { user, projectId, taskId } = await who(c);
  const input = await readBody(c, ChecklistSchema);
  await replaceChecklist(c.var.db, projectId, taskId, user.id, input);
  return ok<TaskDetail>(c, await loadTaskDetailFor(c.var.db, projectId, taskId, user.id));
});

taskRoutes.post("/:id/tasks/:taskId/checklist/:itemId/tick", async (c) => {
  const { user, projectId, taskId } = await who(c);
  const { done } = await readBody(c, TickSchema);
  await tickItem(c.var.db, projectId, taskId, user.id, c.req.param("itemId"), done);
  return ok<TaskDetail>(c, await loadTaskDetailFor(c.var.db, projectId, taskId, user.id));
});

taskRoutes.put("/:id/tasks/:taskId/prereq", async (c) => {
  const { user, projectId, taskId } = await who(c);
  const { prereqTaskId } = await readBody(c, PrereqSchema);
  await setPrereq(c.var.db, projectId, taskId, user.id, prereqTaskId);
  return ok<TaskDetail>(c, await loadTaskDetailFor(c.var.db, projectId, taskId, user.id));
});

taskRoutes.get("/:id/brief", async (c) => {
  const { projectId } = await asMember(c);
  return ok<BriefView>(c, await loadBrief(c.var.db, projectId));
});

myTaskRoutes.get("/mine", async (c) => {
  const user = await requireUser(c);
  const now = new Date();
  return conditional<MyTasksView>(c, await myTasksToken(c.var.db, user, now), () => myTasks(c.var.db, user, now));
});
