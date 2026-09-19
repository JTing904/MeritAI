import { Hono } from "hono";
import type { ProjectView } from "../../../shared/types";
import type { AppEnv } from "../app";
import { requireUser } from "../lib/auth";
import { ok } from "../lib/http";
import { acceptInvite, declineInvite } from "../services/invites";
import { loadProjectView } from "../services/views";

// Answering an invite from the home screen. Sending invites is POST /api/projects/:id/invites.
export const inviteRoutes = new Hono<AppEnv>();

inviteRoutes.post("/:inviteId/accept", async (c) => {
  const user = await requireUser(c);
  const member = await acceptInvite(c.var.db, c.req.param("inviteId"), user);
  return ok<ProjectView>(c, await loadProjectView(c.var.db, member.projectId, member));
});

inviteRoutes.post("/:inviteId/decline", async (c) => {
  const user = await requireUser(c);
  await declineInvite(c.var.db, c.req.param("inviteId"), user);
  return ok(c, null);
});
