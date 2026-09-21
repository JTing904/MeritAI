import { packageCount } from "../../../shared/planning";
import type { DeletedProjectCard, HomeData, PendingInvite, ProjectCard } from "../../../shared/types";
import type { User } from "../generated/prisma/client";
import { isActiveMember, isRunning } from "../lib/access";
import { toLifecycle } from "../lib/lifecycle";
import type { Db } from "../lib/db";
import { earnedPoints, effectiveDue, needsPackage } from "../lib/package-state";
import { invitesFor } from "./join";
import { purgeDeletedProjects } from "./project-delete";
import { sortLeaderFirst } from "./views";
import { clock } from "../lib/clock";

const STATUS_RANK = { DRAFT: 0, ACTIVE: 0, AWAITING_CONFIRM: 0, ENDED: 1 } as const;

/** HomeData.dueSoon looks this far ahead: past the end of the device's week wherever the device is. */
export const DUE_SOON_MS = 8 * 24 * 60 * 60 * 1000;
/** Tasks the home line counts (过期 / 这周要交): not submitted, not finished. */
const DUE_SOON_STATUSES = new Set(["TODO", "DOING", "FAIL"]);

/**
 * My projects (drafts only for their leader), the invites waiting for me, my tasks due soon, and the
 * projects I deleted for everyone and can still restore. My deleted projects past their restore window
 * are purged first (lazily: there is no scheduler yet).
 */
export async function homeData(db: Db, user: User, now = clock.now()): Promise<HomeData> {
  await purgeDeletedProjects(db, now, { userId: user.id });
  const memberships = await db.member.findMany({
    where: {
      userId: user.id,
      leftAt: null,
      removed: false,
      project: { deletedAt: null },
      OR: [{ project: { status: { not: "DRAFT" } } }, { role: "LEADER" }],
    },
    include: {
      project: {
        include: {
          members: { orderBy: { joinedAt: "asc" }, include: { user: { select: { name: true } } } },
          packages: { select: { index: true, ownerId: true } },
          tasks: { select: { status: true, grade: true, points: true, finishedAt: true, ownerId: true, dueAt: true } },
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
      needsPackage: isRunning(project) && needsPackage(me, project, myPackage !== undefined),
      lifecycle: toLifecycle(project, (id) => project.members.find((m) => m.id === id)?.user.name),
    };
  });
  projects.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || b.updatedAt.localeCompare(a.updatedAt));

  // Overdue ones included (the home line counts 过期 too); the app splits them by its own clock and zone.
  const horizon = now.getTime() + DUE_SOON_MS;
  const dueSoon = memberships
    .filter(({ project }) => isRunning(project))
    .flatMap(({ project, id }) =>
      project.tasks
        .filter((t) => t.ownerId === id && DUE_SOON_STATUSES.has(t.status))
        .map((t) => effectiveDue(t, project))
        .filter((due) => due.getTime() <= horizon),
    )
    .sort((a, b) => a.getTime() - b.getTime())
    .map((due) => due.toISOString());

  return { projects, invites: await pendingInvites(db, user), dueSoon, deletedProjects: await deletedByMe(db, user, now) };
}

/** Projects this user deleted for everyone as their (still active) leader, restorable until purgeAfter; newest first. */
async function deletedByMe(db: Db, user: User, now: Date): Promise<DeletedProjectCard[]> {
  const projects = await db.project.findMany({
    where: {
      deletedAt: { not: null },
      purgeAfter: { gt: now },
      deletedBy: { userId: user.id, role: "LEADER", leftAt: null, removed: false },
    },
    orderBy: { deletedAt: "desc" },
    select: { id: true, name: true, shortCode: true, color: true, deletedAt: true, purgeAfter: true },
  });
  return projects.map((p) => ({
    id: p.id,
    name: p.name,
    shortCode: p.shortCode,
    color: p.color,
    deletedAt: p.deletedAt!.toISOString(),
    purgeAfter: p.purgeAfter!.toISOString(),
  }));
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
        deletedAt: null,
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
