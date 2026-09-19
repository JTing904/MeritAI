// Re-split (重新分包, spec §5): one pure plan used by both the preview and the real thing.
import { balancePackages, BALANCE_TOLERANCE } from "../../../shared/planning";
import type { ResplitPreview } from "../../../shared/types";
import type { Member, Package, Project, Task } from "../generated/prisma/client";
import { isActiveMember } from "../lib/access";
import type { Db } from "../lib/db";
import { AppError } from "../lib/errors";
import { isLocked, resplitRange } from "../lib/package-state";
import { bumpPackages, notify, recordEvent, remindPackageless, voidSwaps } from "./notify";
import { lockAsMember, TX_OPTIONS, type Tx } from "./tx";

export type ResplitState = {
  project: Pick<Project, "leaderManages">;
  /** Every member row of the project (inactive ones don't count). */
  members: Pick<Member, "role" | "leftAt" | "removed">[];
  packages: Pick<Package, "id" | "index" | "ownerId">[];
  tasks: Pick<Task, "id" | "title" | "packageId" | "ownerId" | "status" | "startedAt" | "points" | "order" | "number" | "featureId">[];
};

/** One package after the re-split, at position `index − 1`. */
export type ResplitSlot = {
  /** Null: a new package. */
  packageId: string | null;
  oldIndex: number | null;
  index: number;
  ownerId: string | null;
  /** Tenths before (null for a new package) and after, locked tasks included. */
  before: number | null;
  after: number;
  /** The tasks the re-split puts here (locked tasks stay and aren't listed). */
  taskIds: string[];
};

export type ResplitPlan = {
  count: number;
  range: { min: number; max: number };
  slots: ResplitSlot[];
  /** Free packages without locked tasks that go away (their tasks are re-split). */
  removed: { packageId: string; oldIndex: number; before: number }[];
  lockedTasks: { id: string; title: string; ownerMemberId: string | null }[];
};

const byPlanOrder = <T extends { order: number; number: number }>(a: T, b: T) => a.order - b.order || a.number - b.number;
const sum = (values: number[]) => values.reduce((s, v) => s + v, 0);

/**
 * A lower bound on the spread (heaviest − lightest) of any placement of `fluid` more points on top of
 * `preload`: pour them like water into the lightest packages. The heaviest package carries at least
 * max(preload); the lightest can't rise above the water level. E.g. preload [350, 0, 0] + 650 → level
 * 325, so at least 25 (2.5 分) whatever goes where.
 */
export function unavoidableSpread(preload: number[], fluid: number): number {
  if (preload.length === 0) return 0;
  const sorted = [...preload].sort((a, b) => a - b);
  let level = sorted[0]!;
  let left = fluid;
  for (let k = 1; k <= sorted.length; k++) {
    const next = k < sorted.length ? sorted[k]! : Infinity;
    const room = (next - level) * k;
    if (room >= left) {
      level += left / k;
      break;
    }
    left -= room;
    level = next;
  }
  return Math.max(0, sorted[sorted.length - 1]! - level);
}

/**
 * What re-splitting into `count` packages does. Every package that has an owner or a locked task stays
 * (renumbered 1…K in its old order); fewer packages drop free ones without locked tasks, highest number
 * first; more packages add free ones at the end. Locked tasks stay put and preload their package; every
 * other task in a package (and every unlocked ownerless task without one) is balanced across the result,
 * feature groups kept whole within the tolerance (2.0 分, or the unavoidable spread + 2.0 when a heavy
 * package puts 2.0 out of reach). Outside resplitRange → 400 VALIDATION.
 */
export function planResplit(state: ResplitState, count: number): ResplitPlan {
  const range = resplitRange(state);
  if (!Number.isInteger(count) || count < range.min || count > range.max) {
    throw new AppError(400, "VALIDATION", `Choose between ${range.min} and ${range.max} packages`, { range });
  }

  const packages = [...state.packages].sort((a, b) => a.index - b.index);
  const tasks = [...state.tasks].sort(byPlanOrder);
  const hasLocked = (packageId: string) => tasks.some((t) => t.packageId === packageId && isLocked(t));
  const totalOf = (packageId: string) => sum(tasks.filter((t) => t.packageId === packageId).map((t) => t.points));

  const dropIds = new Set(
    packages
      .filter((p) => p.ownerId === null && !hasLocked(p.id))
      .reverse()
      .slice(0, Math.max(0, packages.length - count))
      .map((p) => p.id),
  );
  const kept = packages.filter((p) => !dropIds.has(p.id));
  const packageIds = new Set(packages.map((p) => p.id));
  const units = tasks.filter(
    (t) => !isLocked(t) && (t.packageId !== null ? packageIds.has(t.packageId) : t.ownerId === null),
  );

  const preload = Array.from({ length: count }, (_, p) => {
    const pkg = kept[p];
    return pkg ? sum(tasks.filter((t) => t.packageId === pkg.id && isLocked(t)).map((t) => t.points)) : 0;
  });
  // One heavy package (lots of started work) can put 2.0 分 out of reach; then aim for the smallest
  // spread any placement could reach plus the usual 2.0, instead of breaking every feature group apart
  // for nothing. While that bound is 2.0 or less, the tolerance stays 2.0.
  const unavoidable = unavoidableSpread(preload, sum(units.map((t) => t.points)));
  const tolerance = unavoidable > BALANCE_TOLERANCE ? BALANCE_TOLERANCE + Math.ceil(unavoidable) : BALANCE_TOLERANCE;
  const balanced = balancePackages(
    units.map((t) => ({ id: t.id, points: t.points, group: t.featureId })),
    count,
    { preload, tolerance },
  );

  const slots = balanced.packages.map((result, p): ResplitSlot => {
    const pkg = kept[p];
    return {
      packageId: pkg?.id ?? null,
      oldIndex: pkg?.index ?? null,
      index: p + 1,
      ownerId: pkg?.ownerId ?? null,
      before: pkg ? totalOf(pkg.id) : null,
      after: preload[p]! + result.points,
      taskIds: result.taskIds,
    };
  });
  return {
    count,
    range,
    slots,
    removed: packages.filter((p) => dropIds.has(p.id)).map((p) => ({ packageId: p.id, oldIndex: p.index, before: totalOf(p.id) })),
    lockedTasks: tasks
      .filter((t) => t.packageId !== null && isLocked(t))
      .map((t) => ({ id: t.id, title: t.title, ownerMemberId: t.ownerId })),
  };
}

/** The rows planResplit needs (full rows, so applying can use ids and user ids). */
async function loadState(tx: Tx, project: Project) {
  const members = await tx.member.findMany({ where: { projectId: project.id } });
  const packages = await tx.package.findMany({ where: { projectId: project.id }, orderBy: { index: "asc" } });
  const tasks = await tx.task.findMany({ where: { projectId: project.id }, orderBy: [{ order: "asc" }, { number: "asc" }] });
  return { project, members, packages, tasks } satisfies ResplitState;
}

/** Leader: what a re-split into `count` packages would do; `version` goes back with applyResplit. */
export async function previewResplit(
  db: Db,
  projectId: string,
  userId: string,
  count: number,
  now = new Date(),
): Promise<ResplitPreview> {
  return db.$transaction(async (tx) => {
    const { project } = await lockAsMember(tx, projectId, userId, { leader: true });
    const plan = planResplit(await loadState(tx, project), count);
    return {
      version: project.packagesVersion,
      count: plan.count,
      range: plan.range,
      rows: [
        ...plan.slots.map((s) => ({
          packageId: s.packageId,
          oldIndex: s.oldIndex,
          index: s.index,
          ownerMemberId: s.ownerId,
          before: s.before,
          after: s.after,
        })),
        ...plan.removed.map((r) => ({
          packageId: r.packageId,
          oldIndex: r.oldIndex,
          index: null,
          ownerMemberId: null,
          before: r.before,
          after: null,
        })),
      ],
      lockedTasks: plan.lockedTasks,
    };
  }, TX_OPTIONS);
}

/** Leader: applies the re-split the preview showed; STALE_PREVIEW when `version` isn't current. */
export async function applyResplit(
  db: Db,
  projectId: string,
  userId: string,
  count: number,
  version: number,
  now = new Date(),
): Promise<void> {
  await db.$transaction(async (tx) => {
    const { project, member: leader } = await lockAsMember(tx, projectId, userId, { leader: true });
    if (project.packagesVersion !== version) {
      throw new AppError(409, "STALE_PREVIEW", "Something changed. Check the preview again");
    }
    const state = await loadState(tx, project);
    const plan = planResplit(state, count);

    // The RESPLIT notification tells everyone, so no SWAP_VOID.
    await voidSwaps(tx, { projectId, all: true, reason: "RESPLIT", voidedById: leader.id, now, notify: false });

    if (plan.removed.length > 0) {
      await tx.package.deleteMany({ where: { id: { in: plan.removed.map((r) => r.packageId) } } });
    }
    // (projectId, index) is unique: move the kept packages out of the way, then number them 1…K.
    await tx.package.updateMany({ where: { projectId }, data: { index: { increment: 1000 } } });
    for (const slot of plan.slots) {
      const packageId = slot.packageId
        ? (await tx.package.update({ where: { id: slot.packageId }, data: { index: slot.index } })).id
        : (await tx.package.create({ data: { projectId, index: slot.index } })).id;
      if (slot.taskIds.length > 0) {
        await tx.task.updateMany({ where: { id: { in: slot.taskIds } }, data: { packageId, ownerId: slot.ownerId } });
      }
    }

    await tx.project.update({
      where: { id: projectId },
      data: { teamSize: Math.max(2, count + (project.leaderManages ? 1 : 0)) },
    });
    await recordEvent(tx, { projectId, actorId: leader.id, type: "RESPLIT", payload: { packageCount: count }, now });

    const freePackages = plan.slots.filter((s) => s.ownerId === null).length;
    for (const m of state.members) {
      if (!isActiveMember(m) || m.id === leader.id) continue;
      const slot = plan.slots.find((s) => s.ownerId === m.id);
      await notify(tx, {
        userIds: [m.userId],
        projectId,
        type: "RESPLIT",
        audience: "GROUP",
        mine: true,
        payload: {
          package: slot
            ? { index: slot.index, oldIndex: slot.oldIndex !== slot.index ? slot.oldIndex : null, points: slot.after }
            : null,
          freePackages,
          packageCount: count,
        },
        now,
      });
    }
    await bumpPackages(tx, projectId);
    await remindPackageless(tx, projectId, { now });
  }, TX_OPTIONS);
}
