import type { MemberView, PackageView, ProjectView, SwapView, TaskView } from '@shared/types';

/** What a pick card shows under its tasks, for the viewer. */
export type PickFoot =
  | { kind: 'mine'; firstTaskId: string | null }
  | { kind: 'taken'; owner: MemberView | null; started: boolean; action: TakenAction }
  | { kind: 'free'; action: 'pick' | 'switch' | 'locked' | 'managesOnly' };

/** Someone else's package, first match wins (spec §10 pick screen, foot (1)–(6)). */
export type TakenAction =
  /** (1) its owner asked me, or (2) I asked its owner: SwapActions. */
  | { kind: 'swap'; swap: SwapView }
  /** (3) I have no package: the owner line only. */
  | { kind: 'none' }
  /** (4) either package started, (5) my one request is out elsewhere. */
  | { kind: 'blocked'; reason: 'theirsStarted' | 'mineStarted' | 'oneRequest' }
  /** (6) 🔁 申请互换 */
  | { kind: 'request' };

const isFinished = (t: TaskView) => t.status === 'DONE' || t.status === 'HALF';

/** Swaps still waiting for an answer (the server already drops expired ones; a screen left open may not know yet). */
export function pendingSwaps(project: ProjectView, now = Date.now()): SwapView[] {
  return project.swaps.filter((s) => new Date(s.expiresAt).getTime() > now);
}

/** The package's tasks in the order the server lists them. */
export function packageTasks(project: ProjectView, pkg: PackageView): TaskView[] {
  const byId = new Map(project.tasks.map((t) => [t.id, t]));
  return pkg.taskIds.map((id) => byId.get(id)).filter((t): t is TaskView => t !== undefined);
}

export function pickFoot(project: ProjectView, pkg: PackageView, now = Date.now()): PickFoot {
  const me = project.viewerMemberId;
  const mine = project.packages.find((p) => p.ownerMemberId === me) ?? null;

  if (pkg.ownerMemberId === me) {
    const tasks = packageTasks(project, pkg);
    const first = tasks.find((t) => !isFinished(t)) ?? tasks[0] ?? null;
    return { kind: 'mine', firstTaskId: first?.id ?? null };
  }

  if (pkg.ownerMemberId === null) {
    if (project.viewerRole === 'LEADER' && project.basics.leaderManages) return { kind: 'free', action: 'managesOnly' };
    if (mine?.started) return { kind: 'free', action: 'locked' };
    return { kind: 'free', action: mine ? 'switch' : 'pick' };
  }

  const ownerId = pkg.ownerMemberId;
  const owner = project.members.find((m) => m.id === ownerId) ?? null;
  const swaps = pendingSwaps(project, now);
  const taken = (action: TakenAction): PickFoot => ({ kind: 'taken', owner, started: pkg.started, action });

  const incoming = swaps.find((s) => s.requesterMemberId === ownerId && s.targetMemberId === me);
  if (incoming) return taken({ kind: 'swap', swap: incoming });
  const outgoing = swaps.find((s) => s.requesterMemberId === me && s.targetMemberId === ownerId);
  if (outgoing) return taken({ kind: 'swap', swap: outgoing });
  if (!mine) return taken({ kind: 'none' });
  if (pkg.started) return taken({ kind: 'blocked', reason: 'theirsStarted' });
  if (mine.started) return taken({ kind: 'blocked', reason: 'mineStarted' });
  if (swaps.some((s) => s.requesterMemberId === me)) return taken({ kind: 'blocked', reason: 'oneRequest' });
  return taken({ kind: 'request' });
}

/** Where the carousel starts: the viewer's package, else the first free one, else the first. */
export function startIndex(project: ProjectView, packages: PackageView[]): number {
  const mine = packages.findIndex((p) => p.ownerMemberId === project.viewerMemberId);
  if (mine >= 0) return mine;
  return Math.max(0, packages.findIndex((p) => p.ownerMemberId === null));
}
