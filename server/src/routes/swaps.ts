import { Hono } from "hono";
import type { ProjectView } from "../../../shared/types";
import type { AppEnv } from "../app";
import { requireUser } from "../lib/auth";
import { ok } from "../lib/http";
import { acceptSwap, cancelSwap, declineSwap } from "../services/swaps";
import { loadViewFor } from "../services/views";

// Answering a swap request. Asking is POST /api/projects/:id/swaps. Each answers with the swap's project view.
export const swapRoutes = new Hono<AppEnv>();

swapRoutes.post("/:swapId/accept", async (c) => {
  const user = await requireUser(c);
  const projectId = await acceptSwap(c.var.db, c.req.param("swapId"), user.id);
  return ok<ProjectView>(c, await loadViewFor(c.var.db, projectId, user.id));
});

swapRoutes.post("/:swapId/decline", async (c) => {
  const user = await requireUser(c);
  const projectId = await declineSwap(c.var.db, c.req.param("swapId"), user.id);
  return ok<ProjectView>(c, await loadViewFor(c.var.db, projectId, user.id));
});

swapRoutes.post("/:swapId/cancel", async (c) => {
  const user = await requireUser(c);
  const projectId = await cancelSwap(c.var.db, c.req.param("swapId"), user.id);
  return ok<ProjectView>(c, await loadViewFor(c.var.db, projectId, user.id));
});
