import { Hono } from "hono";
import type { ProjectView, ResplitPreview } from "../../../shared/types";
import type { AppEnv } from "../app";
import { requireActiveMember, requireLeader } from "../lib/access";
import { requireUser } from "../lib/auth";
import { readBody } from "../lib/body";
import { ok } from "../lib/http";
import { assignPackage, moveTask, pickPackage, startTask } from "../services/packages";
import { applyResplit, previewResplit } from "../services/resplit";
import { AssignSchema, MoveTaskSchema, ResplitPreviewSchema, ResplitSchema, SwapCreateSchema } from "../services/schemas";
import { requestSwap } from "../services/swaps";
import { loadViewFor } from "../services/views";

// Packages of an ACTIVE project (mounted at /projects; no path overlaps projectRoutes). The access checks
// here only choose 404 vs 403 early: every service re-checks under the project lock (lockAsMember).
export const packageRoutes = new Hono<AppEnv>();

type Ctx = Parameters<typeof requireUser>[0];

async function asMember(c: Ctx) {
  const user = await requireUser(c);
  const projectId = c.req.param("id")!;
  await requireActiveMember(c.var.db, projectId, user.id);
  return { user, projectId };
}

async function asLeader(c: Ctx) {
  const user = await requireUser(c);
  const projectId = c.req.param("id")!;
  await requireLeader(c.var.db, projectId, user.id);
  return { user, projectId };
}

packageRoutes.post("/:id/packages/:packageId/pick", async (c) => {
  const { user, projectId } = await asMember(c);
  await pickPackage(c.var.db, projectId, c.req.param("packageId"), user.id);
  return ok<ProjectView>(c, await loadViewFor(c.var.db, projectId, user.id));
});

packageRoutes.post("/:id/packages/:packageId/assign", async (c) => {
  const { user, projectId } = await asLeader(c);
  const { memberId } = await readBody(c, AssignSchema);
  await assignPackage(c.var.db, projectId, c.req.param("packageId"), user.id, memberId);
  return ok<ProjectView>(c, await loadViewFor(c.var.db, projectId, user.id));
});

packageRoutes.post("/:id/swaps", async (c) => {
  const { user, projectId } = await asMember(c);
  const { packageId } = await readBody(c, SwapCreateSchema);
  await requestSwap(c.var.db, projectId, user.id, packageId);
  return ok<ProjectView>(c, await loadViewFor(c.var.db, projectId, user.id));
});

packageRoutes.post("/:id/tasks/:taskId/move", async (c) => {
  const { user, projectId } = await asLeader(c);
  const { packageId } = await readBody(c, MoveTaskSchema);
  await moveTask(c.var.db, projectId, c.req.param("taskId"), user.id, packageId);
  return ok<ProjectView>(c, await loadViewFor(c.var.db, projectId, user.id));
});

packageRoutes.post("/:id/tasks/:taskId/start", async (c) => {
  const { user, projectId } = await asMember(c);
  await startTask(c.var.db, projectId, c.req.param("taskId"), user.id);
  return ok<ProjectView>(c, await loadViewFor(c.var.db, projectId, user.id));
});

packageRoutes.post("/:id/resplit/preview", async (c) => {
  const { user, projectId } = await asLeader(c);
  const { count } = await readBody(c, ResplitPreviewSchema);
  return ok<ResplitPreview>(c, await previewResplit(c.var.db, projectId, user.id, count));
});

packageRoutes.post("/:id/resplit", async (c) => {
  const { user, projectId } = await asLeader(c);
  const { count, version } = await readBody(c, ResplitSchema);
  await applyResplit(c.var.db, projectId, user.id, count, version);
  return ok<ProjectView>(c, await loadViewFor(c.var.db, projectId, user.id));
});
