import { packageCount } from "../../../shared/planning";
import type { HomeData, PendingInvite, ProjectCard } from "../../../shared/types";
import type { User } from "../generated/prisma/client";
import { isActiveMember } from "../lib/access";
import type { Db } from "../lib/db";
import { earnedPoints, needsPackage } from "../lib/package-state";
import { invitesFor } from "./join";
import { sortLeaderFirst } from "./views";

const STATUS_RANK = { DRAFT: 0, ACTIVE: 0, AWAITING_CONFIRM: 0, ENDED: 1 } as const;

/** My projects (drafts only for their leader) and the invites waiting for me. */
export async function homeData(db: Db, user: User): Promise<HomeData> {
  const memberships = await db.member.findMany({
    where: {
      userId: user.id,
      leftAt: null,
      removed: false,
      OR: [{ project: { status: { not: "DRAFT" } } }, { role: "LEADER" }],
    },
    include: {
      project: {
        include: {
          members: { orderBy: { joinedAt: "asc" }, include: { user: { select: { name: true } } } },
          packages: { select: { index: true, ownerId: true } },
          tasks: { select: { status: true, points: true } },
        },
      },
    },
  });

  const projects: ProjectCard[] = memberships.map(({ project, ...me }) => {
    const active = sortLeaderFirst(project.members.filter(isActiveMember));
    const myPackage = project.packages.find((p) => p.ownerId === me.id);
    return {
      id: project.id,
      name: project.name,
      shortCode: project.shortCode,
      courseName: project.courseName,
      groupLabel: project.groupLabel,
      color: project.color,
      status: project.status,
      draftStep: project.draftStep,
      role: me.role,
      leaderName: active.find((m) => m.role === "LEADER")?.user.name ?? "",
      memberCount: active.length,
      teamSize: project.teamSize,
      packageCount: project.status === "DRAFT" ? packageCount(project.teamSize, project.leaderManages) : project.packages.length,
      freePackages: project.packages.filter((p) => p.ownerId === null).length,
      myPackageIndex: myPackage?.index ?? null,
      earnedPoints: project.tasks.reduce((sum, t) => sum + earnedPoints(t), 0),
      deadline: project.deadline.toISOString(),
      members: active.map((m) => ({ name: m.user.name, color: m.color })),
      updatedAt: project.updatedAt.toISOString(),
      // Only a running project hands out packages.
      needsPackage: project.status === "ACTIVE" && needsPackage(me, project, myPackage !== undefined),
    };
  });
  projects.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || b.updatedAt.localeCompare(a.updatedAt));

  return { projects, invites: await pendingInvites(db, user) };
}

/** One card per project, newest invite first; none for projects I'm in (or was removed from) or that ended. */
async function pendingInvites(db: Db, user: User): Promise<PendingInvite[]> {
  const addressed = invitesFor(user);
  if (addressed.length === 0) return [];
  const invites = await db.invite.findMany({
    where: {
      status: "PENDING",
      OR: addressed,
      project: {
        status: "ACTIVE",
        members: { none: { userId: user.id, OR: [{ leftAt: null }, { removed: true }] } },
      },
    },
    orderBy: { createdAt: "desc" },
    include: {
      invitedBy: { select: { name: true } },
      project: { include: { members: { where: { leftAt: null, removed: false }, select: { id: true } } } },
    },
  });

  const seen = new Set<string>();
  const out: PendingInvite[] = [];
  for (const inv of invites) {
    if (seen.has(inv.projectId)) continue;
    seen.add(inv.projectId);
    out.push({
      id: inv.id,
      projectId: inv.projectId,
      projectName: inv.project.name,
      courseName: inv.project.courseName,
      inviterName: inv.invitedBy.name,
      memberCount: inv.project.members.length,
      teamSize: inv.project.teamSize,
    });
  }
  return out;
}
