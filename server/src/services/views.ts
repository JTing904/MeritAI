// Turns database rows into the API shapes in shared/types.ts.
import { packageCount, previewBalance } from "../../../shared/planning";
import type {
  DraftView,
  FeatureView,
  MemberView,
  MilestoneView,
  PackageView,
  ProjectBasics,
  ProjectView,
  SwapView,
  TaskView,
} from "../../../shared/types";
import type { Feature, Member, Milestone, Prisma, Project, Task } from "../generated/prisma/client";
import { isActiveMember, requireActiveMember } from "../lib/access";
import type { Db as Client } from "../lib/db";
import { notFound } from "../lib/errors";
import {
  earnedPoints,
  isFinished,
  isLocked,
  isOverdue,
  lightestPackage,
  needsPackage,
  packageStarted,
  resplitRange,
} from "../lib/package-state";
import { expireDueSwaps } from "./notifications";

type Db = Prisma.TransactionClient;

/** `packages`: the real number of packages once the plan is confirmed (a draft shows the planned count). */
export function toBasics(p: Project, packages?: number): ProjectBasics {
  return {
    id: p.id,
    name: p.name,
    shortCode: p.shortCode,
    courseName: p.courseName,
    groupLabel: p.groupLabel,
    deadline: p.deadline.toISOString(),
    timezone: p.timezone,
    teamSize: p.teamSize,
    leaderManages: p.leaderManages,
    repoFullName: p.repoFullName,
    color: p.color,
    status: p.status,
    draftStep: p.draftStep,
    locale: p.locale,
    planSource: p.planSource,
    packageCount: p.status === "DRAFT" || packages === undefined ? packageCount(p.teamSize, p.leaderManages) : packages,
  };
}

export function toTaskView(t: Task, project: Pick<Project, "deadline">, now: Date): TaskView {
  return {
    id: t.id,
    number: t.number,
    title: t.title,
    description: t.description,
    kind: t.kind,
    points: t.points,
    dueAt: t.dueAt?.toISOString() ?? null,
    suggestedDueAt: t.suggestedDueAt?.toISOString() ?? null,
    featureId: t.featureId,
    milestoneId: t.milestoneId,
    packageId: t.packageId,
    ownerMemberId: t.ownerId,
    status: t.status,
    order: t.order,
    startedAt: t.startedAt?.toISOString() ?? null,
    startedByMemberId: t.startedById,
    locked: isLocked(t),
    overdue: isOverdue(t, project, now),
    earnedPoints: earnedPoints(t),
  };
}

const toFeatureView = (f: Feature): FeatureView => ({ id: f.id, name: f.name, order: f.order });
const toMilestoneView = (m: Milestone): MilestoneView => ({
  id: m.id,
  label: m.label,
  name: m.name,
  dueAt: m.dueAt.toISOString(),
  order: m.order,
});

/** Leader first, then everyone in the order given (joinedAt). */
export function sortLeaderFirst<T extends Pick<Member, "role">>(members: T[]): T[] {
  return [...members].sort((a, b) => (a.role === b.role ? 0 : a.role === "LEADER" ? -1 : 1));
}

const TASK_ORDER = [{ order: "asc" as const }, { number: "asc" as const }];

export async function loadDraftView(db: Db, projectId: string, now = new Date()): Promise<DraftView> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    include: {
      tasks: { orderBy: TASK_ORDER },
      features: { orderBy: { order: "asc" } },
      milestones: { orderBy: { order: "asc" } },
    },
  });
  if (!project) throw notFound("Project");
  return {
    basics: toBasics(project),
    briefFileName: project.briefFileName,
    hasBriefText: !!project.briefText,
    tasks: project.tasks.map((t) => toTaskView(t, project, now)),
    features: project.features.map(toFeatureView),
    milestones: project.milestones.map(toMilestoneView),
    totalPoints: project.tasks.reduce((sum, t) => sum + t.points, 0),
    balance: previewBalance(
      project.tasks.map((t) => ({ points: t.points, group: t.featureId })),
      packageCount(project.teamSize, project.leaderManages),
    ),
  };
}

/** Package title: the feature names of its tasks in feature order, e.g. "注册与登录、聊天" (null without features). */
function packageTitle(tasks: Task[], features: Feature[]): string | null {
  const ids = new Set(tasks.map((t) => t.featureId).filter((id): id is string => id !== null));
  const names = features.filter((f) => ids.has(f.id)).map((f) => f.name);
  return names.length > 0 ? names.join("、") : null;
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

/** Sum of the estimates, to one decimal; null when no task has one. */
function estimateHours(tasks: Task[]): number | null {
  const hours = tasks.map((t) => t.estimateHours).filter((h): h is number => h !== null);
  return hours.length > 0 ? Math.round(sum(hours) * 10) / 10 : null;
}

/**
 * The project as `viewer` sees it at `now`. Swaps are the viewer's own pending ones that haven't run
 * out (a pending row past expiresAt no longer counts, even before expireSwaps has marked it).
 */
export async function loadProjectView(db: Db, projectId: string, viewer: Member, now = new Date()): Promise<ProjectView> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    include: {
      tasks: { orderBy: TASK_ORDER },
      features: { orderBy: { order: "asc" } },
      milestones: { orderBy: { order: "asc" } },
      packages: { orderBy: { index: "asc" } },
      members: { orderBy: { joinedAt: "asc" }, include: { user: { select: { name: true } }, package: { select: { id: true } } } },
      swapRequests: {
        where: {
          status: "PENDING",
          expiresAt: { gt: now },
          OR: [{ requesterId: viewer.id }, { targetId: viewer.id }],
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      },
    },
  });
  if (!project) throw notFound("Project");
  // The row the caller passed may predate the write this view follows (a transfer changes roles).
  const me = project.members.find((m) => m.id === viewer.id) ?? { ...viewer, package: null };
  // Only a running project hands out packages.
  const running = project.status === "ACTIVE";

  const members: MemberView[] = sortLeaderFirst(project.members).map((m) => {
    const owned = project.tasks.filter((t) => t.ownerId === m.id);
    return {
      id: m.id,
      userId: m.userId,
      name: m.user.name,
      color: m.color,
      role: m.role,
      active: isActiveMember(m),
      packageId: m.package?.id ?? null,
      joinedAt: m.joinedAt.toISOString(),
      leftAt: m.leftAt?.toISOString() ?? null,
      removed: m.removed,
      earnedPoints: sum(owned.map(earnedPoints)),
      needsPackage: running && needsPackage(m, project, m.package !== null),
      unfinishedCount: owned.filter((t) => !isFinished(t)).length,
    };
  });

  const packages: PackageView[] = project.packages.map((pkg) => {
    const tasks = project.tasks.filter((t) => t.packageId === pkg.id);
    return {
      id: pkg.id,
      index: pkg.index,
      title: packageTitle(tasks, project.features),
      points: sum(tasks.map((t) => t.points)),
      ownerMemberId: pkg.ownerId,
      taskIds: tasks.map((t) => t.id),
      started: packageStarted(pkg, tasks),
      earnedPoints: sum(tasks.map(earnedPoints)),
      overdueCount: tasks.filter((t) => isOverdue(t, project, now)).length,
      estimateHours: estimateHours(tasks),
    };
  });

  const swaps: SwapView[] = [];
  for (const s of project.swapRequests) {
    // A re-split voids every pending swap before it deletes a package, so both ids are set; skip otherwise.
    if (s.requesterPackageId === null || s.targetPackageId === null) continue;
    swaps.push({
      id: s.id,
      requesterMemberId: s.requesterId,
      targetMemberId: s.targetId,
      requesterPackageId: s.requesterPackageId,
      targetPackageId: s.targetPackageId,
      createdAt: s.createdAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
    });
  }

  return {
    basics: toBasics(project, project.packages.length),
    inviteCode: project.inviteCode,
    viewerMemberId: me.id,
    viewerRole: me.role,
    members,
    packages,
    tasks: project.tasks.map((t) => toTaskView(t, project, now)),
    features: project.features.map(toFeatureView),
    milestones: project.milestones.map(toMilestoneView),
    earnedPoints: sum(project.tasks.map(earnedPoints)),
    packagesVersion: project.packagesVersion,
    viewerNeedsPackage: running && needsPackage(me, project, me.package !== null),
    lightestPackageId: lightestPackage(project.packages, project.tasks)?.id ?? null,
    resplitRange: resplitRange({ project, members: project.members, packages: project.packages, tasks: project.tasks }),
    swaps,
  };
}

/** The project as `userId` sees it now. Re-reads the membership, so a write that changed roles shows. */
export async function loadViewFor(db: Db, projectId: string, userId: string, now = new Date()): Promise<ProjectView> {
  const { member } = await requireActiveMember(db, projectId, userId);
  return loadProjectView(db, projectId, member, now);
}

/** GET /api/projects/:id: swaps that ran out are marked EXPIRED (and their requesters told) first. */
export async function openProjectView(db: Client, projectId: string, viewer: Member, now = new Date()): Promise<ProjectView> {
  await expireDueSwaps(db, { projectId }, now);
  return loadProjectView(db, projectId, viewer, now);
}
