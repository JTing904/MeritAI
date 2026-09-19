import { Hono } from "hono";
import type { FeedPage, ProjectView } from "../../../shared/types";
import type { AppEnv } from "../app";
import { requireActiveMember } from "../lib/access";
import { requireUser } from "../lib/auth";
import { readBody } from "../lib/body";
import { ok } from "../lib/http";
import { loadFeed } from "../services/feed";
import { leaveAsLeader, leaveProject, removeMember, transferLeader } from "../services/members";
import { LeaveAsLeaderSchema, PageQuerySchema } from "../services/schemas";
import { loadViewFor } from "../services/views";

// Members of a project and its feed (mounted at /projects; no path overlaps projectRoutes). The writes
// don't check the membership here: every service does under the project lock (404 / 403, A14).
export const memberRoutes = new Hono<AppEnv>();

memberRoutes.post("/:id/leave", async (c) => {
  const user = await requireUser(c);
  const projectId = c.req.param("id");
  await leaveProject(c.var.db, projectId, user.id);
  return ok(c, null);
});

// 「我自己退出」 (leader): hand the role to someone, then leave, in one step.
memberRoutes.post("/:id/leave-as-leader", async (c) => {
  const user = await requireUser(c);
  const projectId = c.req.param("id");
  const { newLeaderMemberId } = await readBody(c, LeaveAsLeaderSchema);
  await leaveAsLeader(c.var.db, projectId, user.id, newLeaderMemberId);
  return ok(c, null);
});

memberRoutes.post("/:id/members/:memberId/remove", async (c) => {
  const user = await requireUser(c);
  const projectId = c.req.param("id");
  await removeMember(c.var.db, projectId, user.id, c.req.param("memberId"));
  return ok<ProjectView>(c, await loadViewFor(c.var.db, projectId, user.id));
});

memberRoutes.post("/:id/members/:memberId/transfer", async (c) => {
  const user = await requireUser(c);
  const projectId = c.req.param("id");
  await transferLeader(c.var.db, projectId, user.id, c.req.param("memberId"));
  return ok<ProjectView>(c, await loadViewFor(c.var.db, projectId, user.id));
});

memberRoutes.get("/:id/feed", async (c) => {
  const user = await requireUser(c);
  const projectId = c.req.param("id");
  await requireActiveMember(c.var.db, projectId, user.id);
  const query = PageQuerySchema.parse(c.req.query());
  return ok<FeedPage>(c, await loadFeed(c.var.db, projectId, query));
});
