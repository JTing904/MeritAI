import type { Member, Prisma, Project } from "../generated/prisma/client";
import { AppError, forbidden, notFound } from "./errors";

export type ProjectAccess = { project: Project; member: Member };

export const isActiveMember = (m: Pick<Member, "leftAt" | "removed">) => m.leftAt === null && !m.removed;

/**
 * The project and the viewer's membership, for an active member. Anyone else gets 404 (not 403),
 * so project ids can't be probed. A draft is only visible to its leader.
 */
export async function requireActiveMember(
  db: Prisma.TransactionClient,
  projectId: string,
  userId: string,
): Promise<ProjectAccess> {
  const member = await db.member.findUnique({
    where: { projectId_userId: { projectId, userId } },
    include: { project: true },
  });
  if (!member || !isActiveMember(member)) throw notFound("Project");
  const { project, ...rest } = member;
  if (project.status === "DRAFT" && rest.role !== "LEADER") throw notFound("Project");
  return { project, member: rest };
}

/** Like requireActiveMember, but only for the leader. Other members can see the project, so they get 403. */
export async function requireLeader(
  db: Prisma.TransactionClient,
  projectId: string,
  userId: string,
): Promise<ProjectAccess> {
  const access = await requireActiveMember(db, projectId, userId);
  if (access.member.role !== "LEADER") throw forbidden("Only the leader can do this");
  return access;
}

export function assertDraft(project: Pick<Project, "status">): void {
  if (project.status !== "DRAFT") throw new AppError(409, "NOT_A_DRAFT", "The plan was already confirmed");
}

/** Drafts have no invite code yet; ended projects take no new people or changes. */
export function assertActive(project: Pick<Project, "status">): void {
  if (project.status === "DRAFT") throw new AppError(409, "CONFLICT", "Confirm the plan first");
  if (project.status !== "ACTIVE") throw new AppError(409, "PROJECT_ENDED", "The project has ended");
}
