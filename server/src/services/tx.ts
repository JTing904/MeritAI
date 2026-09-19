import type { Member, Prisma, Project } from "../generated/prisma/client";
import { assertActive, assertDraft, isActiveMember, type ProjectAccess } from "../lib/access";
import { forbidden, notFound } from "../lib/errors";

export type Tx = Prisma.TransactionClient;

/** Room for up to a few hundred row writes (confirming a big plan) on a slow free-tier database. */
export const TX_OPTIONS = { timeout: 20_000, maxWait: 10_000 } as const;

/**
 * Locks the project row until the transaction ends and returns it fresh. Every write that depends on
 * the project's current state (confirm, join, task numbers, invite codes) takes this lock first, so
 * concurrent requests run one after another instead of racing.
 */
export async function lockProject(tx: Tx, projectId: string): Promise<Project> {
  await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId} FOR UPDATE`;
  const project = await tx.project.findUnique({ where: { id: projectId } });
  if (!project) throw notFound("Project");
  return project;
}

export async function lockDraft(tx: Tx, projectId: string): Promise<Project> {
  const project = await lockProject(tx, projectId);
  assertDraft(project);
  return project;
}

/**
 * Start of every M3 write: locks the project row, then re-reads the actor's membership inside the
 * transaction (route-level checks only pick 404 vs 403 early and may be stale). Not an active member
 * → 404; `leader` and not the leader → 403; the project must be ACTIVE (409 otherwise).
 */
export async function lockAsMember(
  tx: Tx,
  projectId: string,
  userId: string,
  opts: { leader?: boolean } = {},
): Promise<ProjectAccess> {
  const project = await lockProject(tx, projectId);
  const member = await memberUnderLock(tx, project, userId, opts);
  assertActive(project);
  return { project, member };
}

/**
 * The actor's membership re-read after the caller locked `project` (lockAsMember without the ACTIVE
 * check, for writes that also accept drafts or answer ended projects their own way). Not an active
 * member, or a draft's non-leader → 404; `leader` and not the leader → 403.
 */
export async function memberUnderLock(
  tx: Tx,
  project: Project,
  userId: string,
  opts: { leader?: boolean } = {},
): Promise<Member> {
  const member = await tx.member.findUnique({ where: { projectId_userId: { projectId: project.id, userId } } });
  if (!member || !isActiveMember(member)) throw notFound("Project");
  if (project.status === "DRAFT" && member.role !== "LEADER") throw notFound("Project");
  if (opts.leader && member.role !== "LEADER") throw forbidden("Only the leader can do this");
  return member;
}

/** Bumps updatedAt so "上次编辑" on the home card reflects task edits too. */
export function touchProject(tx: Tx, projectId: string) {
  return tx.project.update({ where: { id: projectId }, data: { updatedAt: new Date() } });
}
