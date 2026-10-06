// Pure planning logic shared by the server (and usable by the app for previews).
// Points are integers in TENTHS of a contribution point: a project's tasks sum to exactly 1000 (= 100.0 分).
import type { BalanceView } from './types';

/** Packages may differ by up to 2.0 分 and still count as even (REQUIREMENTS §13). */
export const BALANCE_TOLERANCE = 20;

/** Packages a project has: one per member, minus the leader when the leader only manages. */
export function packageCount(teamSize: number, leaderManages: boolean): number {
  return Math.max(1, teamSize - (leaderManages ? 1 : 0));
}

/** Formats tenths as the UI shows them: 125 → "12.5", 200 → "20.0". */
export function formatPoints(tenths: number): string {
  return (tenths / 10).toFixed(1);
}

/**
 * Formats a total the way the UI shows totals (合计, package totals, 每包都是 / 大约): whole numbers
 * without ".0", otherwise one decimal like formatPoints. 1000 → "100", 200 → "20", 333 → "33.3".
 * Task points and earned points keep formatPoints.
 */
export function formatTotal(tenths: number): string {
  return tenths % 10 === 0 ? String(tenths / 10) : formatPoints(tenths);
}

/**
 * Scales non-negative raw weights to integers that sum exactly to `total` (default 1000 tenths),
 * using the largest-remainder method; ties go to the lower index. Non-finite or ≤ 0 weights count
 * as 0; if every weight is 0 the total is split equally.
 * e.g. apportion([1, 1, 1]) → [334, 333, 333]; apportion([200, 850]) → [190, 810].
 */
export function apportion(raw: number[], total = 1000): number[] {
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new RangeError('apportion: total must be a non-negative integer');
  }
  if (raw.length === 0) return [];
  let weights = raw.map((w) => (Number.isFinite(w) && w > 0 ? w : 0));
  let sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0) {
    weights = weights.map(() => 1);
    sum = weights.length;
  } else if (!Number.isFinite(sum)) {
    // Weights near Number.MAX_VALUE overflow the sum; only their proportions matter.
    const max = Math.max(...weights);
    weights = weights.map((w) => w / max);
    sum = weights.reduce((a, b) => a + b, 0);
  }

  // Integer weights (the usual case: tenths) are split exactly. Fractional ones go through floats,
  // with remainders rounded so that mathematically equal remainders still tie.
  const exact = weights.every(Number.isSafeInteger) && Number.isSafeInteger(sum * total);
  const shares: number[] = [];
  const remainders: number[] = [];
  for (const w of weights) {
    if (exact) {
      const scaled = w * total;
      const r = scaled % sum;
      shares.push((scaled - r) / sum);
      remainders.push(r);
    } else {
      const quota = (w / sum) * total;
      const share = Math.floor(quota);
      shares.push(share);
      remainders.push(Math.round((quota - share) * 1e9));
    }
  }

  const order = shares.map((_, i) => i).sort((a, b) => remainders[b]! - remainders[a]! || a - b);
  let left = total - shares.reduce((a, b) => a + b, 0);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) {
    const i = order[k]!;
    shares[i] = shares[i]! + 1;
  }
  return shares;
}

/** One task to place into a package. */
export type PlanUnit = {
  id: string;
  /** Tenths. */
  points: number;
  /** Feature group id: tasks of one group should stay in one package. Null = free-standing task. */
  group: string | null;
};

export type BalanceOptions = {
  /**
   * Largest acceptable difference between the heaviest and lightest package, in tenths
   * (default 20 = 2.0 分). Groups are kept whole while the spread stays within it; beyond it,
   * the largest groups are broken into single tasks until it fits (or everything is single).
   */
  tolerance?: number;
  /** Points each package already carries (tasks already started stay with their owner; M3 re-split). */
  preload?: number[];
};

export type BalancedPackages = {
  /**
   * Exactly `count` packages; each lists task ids in their original order.
   * `points` is the sum of the listed tasks (preload not included).
   */
  packages: { taskIds: string[]; points: number }[];
  /** Heaviest minus lightest package, tenths (preload included). */
  spread: number;
  /** Groups that had to be split across packages, in order of first appearance. */
  splitGroups: string[];
};

/**
 * Splits tasks into `count` packages with (nearly) equal points, keeping feature groups together
 * when possible. Deterministic: the same input always gives the same output.
 * Algorithm: treat each group (and each free-standing task) as one item; greedy largest-first into
 * the lightest package, then repeated pairwise optimal re-splits (exact subset-sum over integer
 * points, preferring the fewest moves; greedy for fractional or very large points). If the spread
 * exceeds the tolerance, break the largest remaining group into its tasks and try again. When
 * nothing fits, the attempt with the smallest spread wins (the earliest one, i.e. the fewest broken
 * groups, on a tie).
 */
export function balancePackages(units: PlanUnit[], count: number, opts: BalanceOptions = {}): BalancedPackages {
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new RangeError('balancePackages: count must be a positive integer');
  }
  const tolerance = opts.tolerance ?? 20;
  const preload = Array.from({ length: count }, (_, p) => opts.preload?.[p] ?? 0);

  // Unit indices per group, in order of first appearance.
  const groups = new Map<string, number[]>();
  units.forEach((u, i) => {
    if (u.group === null) return;
    const members = groups.get(u.group);
    if (members) members.push(i);
    else groups.set(u.group, [i]);
  });

  const attempt = (broken: Set<string>) => {
    const items: number[][] = [];
    const placed = new Set<string>();
    units.forEach((u, i) => {
      if (u.group === null || broken.has(u.group)) items.push([i]);
      else if (!placed.has(u.group)) {
        placed.add(u.group);
        items.push(groups.get(u.group)!);
      }
    });
    const where = distribute(items.map((members) => sumPoints(units, members)), preload);
    const packageOf: number[] = new Array<number>(units.length).fill(0);
    items.forEach((members, k) => members.forEach((i) => (packageOf[i] = where[k]!)));
    const loads = preload.slice();
    units.forEach((u, i) => (loads[packageOf[i]!]! += u.points));
    return { packageOf, spread: Math.max(...loads) - Math.min(...loads) };
  };

  const broken = new Set<string>();
  let best = attempt(broken);
  let latest = best;
  while (latest.spread > tolerance) {
    let next: string | null = null;
    let nextPoints = -Infinity;
    for (const [group, members] of groups) {
      if (broken.has(group) || members.length < 2) continue;
      const points = sumPoints(units, members);
      if (points > nextPoints) {
        next = group;
        nextPoints = points;
      }
    }
    if (next === null) break;
    broken.add(next);
    latest = attempt(broken);
    if (latest.spread < best.spread) best = latest;
  }

  const packages = preload.map(() => ({ taskIds: [] as string[], points: 0 }));
  units.forEach((u, i) => {
    const pkg = packages[best.packageOf[i]!]!;
    pkg.taskIds.push(u.id);
    pkg.points += u.points;
  });
  const splitGroups = [...groups]
    .filter(([, members]) => new Set(members.map((i) => best.packageOf[i])).size > 1)
    .map(([group]) => group);
  return { packages, spread: best.spread, splitGroups };
}

/**
 * The packages confirming would make right now: points rescaled to 1000, then balanced into `count`
 * packages with feature groups kept together (the same steps as 「分成 N 个任务包」).
 */
export function previewBalance(tasks: { points: number; group: string | null }[], count: number): BalanceView {
  const points = apportion(tasks.map((t) => t.points));
  const result = balancePackages(
    tasks.map((t, i) => ({ id: String(i), points: points[i]!, group: t.group })),
    count,
    { tolerance: BALANCE_TOLERANCE },
  );
  const emptyPackages = result.packages.filter((p) => p.taskIds.length === 0).length;
  return {
    packagePoints: result.packages.map((p) => p.points),
    spread: result.spread,
    emptyPackages,
    balanced: result.spread <= BALANCE_TOLERANCE && emptyPackages === 0,
  };
}

/**
 * Rescales every task's points so they sum to 1000 again after tasks were added or removed,
 * keeping their proportions (e.g. adding a 10-point task to 100 points → everyone × 100/110).
 * Returns new points in the same order.
 */
export function rescaleToFull(points: number[]): number[] {
  return apportion(points, 1000);
}

/** 「组员 3」, 「个人方案 3」, "Member 3", "Individual solution 3": a feature naming a per-member copy. */
export const COPY_FEATURE_RE = /^\s*(?:组员|成员|个人方案|member|individual\s+solution)\s*#?(\d+)\s*$/i;

/** The per-member copy number a feature names (COPY_FEATURE_RE), or null. */
export function copyNumber(feature: string | null | undefined): number | null {
  const m = feature?.match(COPY_FEATURE_RE);
  return m ? Number(m[1]) : null;
}

/**
 * Like apportion, but every share is at least 1 when `total` allows it (a new task is never worth 0):
 * each gets 1 first, the rest is apportioned by weight.
 */
export function apportionAtLeastOne(raw: number[], total: number): number[] {
  if (raw.length === 0 || total < raw.length) return apportion(raw, total);
  return apportion(raw, total - raw.length).map((n) => n + 1);
}

export type ResplitPlacementInput = {
  /** Every package of the project, in index order. */
  packages: { index: number; ownerMemberId: string | null }[];
  /** Tasks that stay: tenths now and their package (null: in none). */
  kept: { points: number; packageIndex: number | null }[];
  /** Tasks that go (only for the packages' points before). */
  removed: { points: number; packageIndex: number | null }[];
  /** The new tasks: tenths on the proposal's scale, and their feature (groups stay together; copies go to their number). */
  added: { points: number; feature: string | null; packageIndex?: number | null }[];
  /**
   * The kept tasks keep their tenths and the new ones share the rest (1000 − kept), unless the leader changed
   * some points on the review page (owner decision 2026-10-02: kept points move only then). Default true.
   */
  keepKept?: boolean;
};

export type ResplitPlacement = {
  /** The kept tasks' tenths after the rescale, in input order. */
  keptPoints: number[];
  /** The new tasks after the rescale, where they go (package index and its owner; null without packages). */
  added: { points: number; packageIndex: number | null; ownerMemberId: string | null }[];
  /** Per package (input order): tenths now (kept + removed) and after (kept + new). */
  packages: { index: number; pointsBefore: number; pointsAfter: number }[];
};

/**
 * 让 AI 重新拆 (docs/plan/m6-resplit-spec.md): where the new tasks go and what everything is worth. Kept and
 * new tasks are rescaled together in proportion to exactly 1000; per-member copies (「组员 n」 / 「个人方案 n」)
 * go into package n when it exists; the rest are balanced into the packages with the kept points preloaded
 * (feature groups kept together). Pure and deterministic: the review page and the apply compute the same.
 */
export function placeResplit(input: ResplitPlacementInput): ResplitPlacement {
  const { packages, kept, removed, added } = input;
  const keptTotal = kept.reduce((s, t) => s + t.points, 0);
  const fixed = (input.keepKept ?? true) && added.length > 0 && keptTotal < 1000;
  const scaled = fixed
    ? [...kept.map((t) => t.points), ...apportion(added.map((t) => t.points), 1000 - keptTotal)]
    : kept.length + added.length > 0
      ? apportion([...kept.map((t) => t.points), ...added.map((t) => t.points)], 1000)
      : [];
  const keptPoints = scaled.slice(0, kept.length);
  const addedPoints = scaled.slice(kept.length);
  const slot = new Map(packages.map((p, i) => [p.index, i]));
  const loads = packages.map(() => 0);
  kept.forEach((t, i) => {
    const at = t.packageIndex === null ? undefined : slot.get(t.packageIndex);
    if (at !== undefined) loads[at]! += keptPoints[i]!;
  });

  const where: (number | null)[] = added.map(() => null);
  if (packages.length > 0) {
    // A task already placed (the proposal's own, kept where it was when the leader deletes or adds on the
    // review page, owner decision 2026-10-02) stays; copies numbered n go into package n; the others are
    // balanced around everything placed.
    added.forEach((t, i) => {
      const pinned = t.packageIndex === null || t.packageIndex === undefined ? undefined : slot.get(t.packageIndex);
      const n = copyNumber(t.feature);
      const at = pinned ?? (n === null ? undefined : slot.get(n));
      if (at === undefined) return;
      where[i] = at;
      loads[at]! += addedPoints[i]!;
    });
    const free = added.map((t, i) => ({ t, i })).filter((x) => where[x.i] === null);
    const balanced = balancePackages(
      free.map((x) => ({ id: String(x.i), points: addedPoints[x.i]!, group: x.t.feature })),
      packages.length,
      { preload: loads.slice() },
    );
    balanced.packages.forEach((pkg, p) => {
      for (const id of pkg.taskIds) {
        where[Number(id)] = p;
        loads[p]! += addedPoints[Number(id)]!;
      }
    });
  }

  const before = packages.map(() => 0);
  for (const t of [...kept, ...removed]) {
    const at = t.packageIndex === null ? undefined : slot.get(t.packageIndex);
    if (at !== undefined) before[at]! += t.points;
  }
  return {
    keptPoints,
    added: added.map((_, i) => {
      const at = where[i];
      const pkg = at === null || at === undefined ? null : packages[at]!;
      return { points: addedPoints[i]!, packageIndex: pkg?.index ?? null, ownerMemberId: pkg?.ownerMemberId ?? null };
    }),
    packages: packages.map((p, i) => ({ index: p.index, pointsBefore: before[i]!, pointsAfter: loads[i]! })),
  };
}

// ── balancing internals ─────────────────────────────────────────────

const MAX_PASSES = 100;
/** Cells of the subset-sum table per pair (items × (points + 1)); above it the greedy split is used. */
const EXACT_LIMIT = 4_000_000;

function sumPoints(units: PlanUnit[], indices: number[]): number {
  return indices.reduce((s, i) => s + units[i]!.points, 0);
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

/** Assigns weighted items to packages (index per item). `preload` fixes the package count. */
function distribute(weights: number[], preload: number[]): number[] {
  const loads = preload.slice();
  const where: number[] = new Array<number>(weights.length).fill(0);
  const byWeight = weights.map((_, i) => i).sort((a, b) => weights[b]! - weights[a]! || a - b);
  for (const i of byWeight) {
    let lightest = 0;
    for (let p = 1; p < loads.length; p++) if (loads[p]! < loads[lightest]!) lightest = p;
    where[i] = lightest;
    loads[lightest]! += weights[i]!;
  }

  // Each accepted re-split strictly narrows one pair, so this settles; the cap is only a safety net.
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let improved = false;
    for (let a = 0; a < loads.length; a++) {
      for (let b = a + 1; b < loads.length; b++) {
        if (resplit(weights, where, loads, a, b)) improved = true;
      }
    }
    if (!improved) break;
  }
  return where;
}

/** Re-splits the items of packages `a` and `b` between them if that narrows their gap. */
function resplit(weights: number[], where: number[], loads: number[], a: number, b: number): boolean {
  const idx = where.flatMap((p, i) => (p === a || p === b ? [i] : []));
  if (idx.length === 0) return false;
  const w = idx.map((i) => weights[i]!);
  const inA = idx.map((i) => where[i] === a);
  const heldA = sum(w.filter((_, k) => inA[k]));
  const baseA = loads[a]! - heldA;
  const baseB = loads[b]! - (sum(w) - heldA);
  const total = sum(w);
  const gap = (x: number) => Math.abs(2 * x + baseA - baseB - total);

  const exact = w.every((x) => Number.isSafeInteger(x) && x >= 0) && w.length * (total + 1) <= EXACT_LIMIT;
  const side = exact ? exactSplit(w, inA, gap) : greedySplit(w, baseA, baseB);
  const newA = sum(w.filter((_, k) => side[k]));
  if (!(gap(newA) < gap(heldA) - 1e-9)) return false;

  idx.forEach((i, k) => (where[i] = side[k] ? a : b));
  loads[a] = baseA + newA;
  loads[b] = baseB + (total - newA);
  return true;
}

/**
 * Subset-sum over integer weights: which items go to side A so that `gap(sum of A)` is smallest,
 * moving as few items as possible (from `inA`) among equally good splits.
 */
function exactSplit(w: number[], inA: boolean[], gap: (x: number) => number): boolean[] {
  const m = w.length;
  const width = sum(w) + 1;
  const NONE = m + 1;
  let moves: number[] = new Array<number>(width).fill(NONE);
  moves[0] = 0;
  const toA = new Uint8Array(m * width);
  let reach = 0;
  for (let k = 0; k < m; k++) {
    const wk = w[k]!;
    const next: number[] = new Array<number>(width).fill(NONE);
    for (let x = 0; x <= reach; x++) {
      const done = moves[x]!;
      if (done === NONE) continue;
      const viaB = done + (inA[k] ? 1 : 0);
      if (viaB < next[x]!) {
        next[x] = viaB;
        toA[k * width + x] = 0;
      }
      const viaA = done + (inA[k] ? 0 : 1);
      if (viaA < next[x + wk]!) {
        next[x + wk] = viaA;
        toA[k * width + x + wk] = 1;
      }
    }
    reach += wk;
    moves = next;
  }

  let best = -1;
  for (let x = 0; x < width; x++) {
    if (moves[x] === NONE) continue;
    if (best < 0 || gap(x) < gap(best) || (gap(x) === gap(best) && moves[x]! < moves[best]!)) best = x;
  }
  const side: boolean[] = new Array<boolean>(m).fill(false);
  for (let k = m - 1, x = best; k >= 0; k--) {
    side[k] = toA[k * width + x] === 1;
    if (side[k]) x -= w[k]!;
  }
  return side;
}

/** Largest first onto the lighter side (ties → A). */
function greedySplit(w: number[], baseA: number, baseB: number): boolean[] {
  const side: boolean[] = new Array<boolean>(w.length).fill(false);
  let loadA = baseA;
  let loadB = baseB;
  for (const k of w.map((_, i) => i).sort((p, q) => w[q]! - w[p]! || p - q)) {
    if (loadA <= loadB) {
      side[k] = true;
      loadA += w[k]!;
    } else {
      loadB += w[k]!;
    }
  }
  return side;
}
