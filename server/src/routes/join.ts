import { Hono } from "hono";
import type { JoinPreview, ProjectView } from "../../../shared/types";
import type { AppEnv } from "../app";
import { requireUser } from "../lib/auth";
import { ok } from "../lib/http";
import { joinByCode, joinPreview } from "../services/join";
import { loadProjectView } from "../services/views";

// Joining with an invite code: no approval needed. Codes match case-insensitively, spaces ignored.
export const joinRoutes = new Hono<AppEnv>();

joinRoutes.get("/:code", async (c) => {
  const user = await requireUser(c);
  return ok<JoinPreview>(c, await joinPreview(c.var.db, c.req.param("code"), user.id));
});

joinRoutes.post("/:code", async (c) => {
  const user = await requireUser(c);
  const member = await joinByCode(c.var.db, c.req.param("code"), user);
  return ok<ProjectView>(c, await loadProjectView(c.var.db, member.projectId, member));
});
