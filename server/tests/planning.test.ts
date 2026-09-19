import { describe, expect, it } from "vitest";
import {
  apportion,
  balancePackages,
  formatPoints,
  formatTotal,
  packageCount,
  previewBalance,
  rescaleToFull,
  type PlanUnit,
} from "../../shared/planning";

/** Small deterministic PRNG so the property checks are reproducible. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Free-standing tasks t0, t1, … with the given points. */
const tasks = (points: number[]): PlanUnit[] => points.map((p, i) => ({ id: `t${i}`, points: p, group: null }));

/** Tasks of one feature group: ids "<group>0", "<group>1", … */
const group = (name: string, points: number[]): PlanUnit[] =>
  points.map((p, i) => ({ id: `${name}${i}`, points: p, group: name }));

/** Checks the invariants every result must satisfy and returns the package loads (preload included). */
function checkShape(units: PlanUnit[], count: number, result: ReturnType<typeof balancePackages>, preload: number[] = []) {
  expect(result.packages).toHaveLength(count);
  const order = new Map(units.map((u, i) => [u.id, i]));
  const seen = result.packages.flatMap((p) => p.taskIds);
  expect([...seen].sort()).toEqual(units.map((u) => u.id).sort());
  for (const pkg of result.packages) {
    const indices = pkg.taskIds.map((id) => order.get(id)!);
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
    expect(pkg.points).toBe(sum(indices.map((i) => units[i]!.points)));
  }
  const loads = result.packages.map((p, i) => p.points + (preload[i] ?? 0));
  expect(result.spread).toBe(Math.max(...loads) - Math.min(...loads));
  return loads;
}

/** Package index of every task id. */
const packageOf = (result: ReturnType<typeof balancePackages>) =>
  new Map(result.packages.flatMap((p, i) => p.taskIds.map((id) => [id, i] as const)));

describe("packageCount / formatPoints / formatTotal / rescaleToFull", () => {
  it("counts one package per member, minus a managing leader", () => {
    expect(packageCount(5, false)).toBe(5);
    expect(packageCount(5, true)).toBe(4);
    expect(packageCount(2, true)).toBe(1);
  });

  it("formats tenths with one decimal", () => {
    expect(formatPoints(125)).toBe("12.5");
    expect(formatPoints(200)).toBe("20.0");
    expect(formatPoints(1000)).toBe("100.0");
    expect(formatPoints(0)).toBe("0.0");
  });

  it("formats totals without a trailing .0, otherwise with one decimal", () => {
    expect(formatTotal(1000)).toBe("100");
    expect(formatTotal(200)).toBe("20");
    expect(formatTotal(0)).toBe("0");
    expect(formatTotal(333)).toBe("33.3");
    expect(formatTotal(125)).toBe("12.5");
    expect(formatTotal(5)).toBe("0.5");
    expect(formatTotal(1001)).toBe("100.1");
  });

  it("rescales to 1000 keeping proportions", () => {
    // 100 points (10 tasks × 10) plus a new 10-point task: everyone × 100/110.
    const out = rescaleToFull([...Array<number>(10).fill(100), 100]);
    expect(sum(out)).toBe(1000);
    expect(out.every((p) => p === 91 || p === 90)).toBe(true);
  });
});

describe("apportion", () => {
  it("matches the documented examples", () => {
    expect(apportion([1, 1, 1])).toEqual([334, 333, 333]);
    expect(apportion([200, 850])).toEqual([190, 810]);
  });

  it("keeps totals that already fit", () => {
    expect(apportion([120, 30, 50, 800])).toEqual([120, 30, 50, 800]);
    expect(apportion([25, 25, 50], 100)).toEqual([25, 25, 50]);
  });

  it("gives ties to the lower index", () => {
    expect(apportion([1, 1, 1, 1, 1, 1, 1])).toEqual([143, 143, 143, 143, 143, 143, 142]);
    expect(apportion([1, 1, 1], 2)).toEqual([1, 1, 0]);
  });

  it("uses the largest remainder, not rounding each share", () => {
    // Quotas 166.67, 166.67, 666.67 → floors 166 + 166 + 666 = 998; two extra units by remainder.
    expect(apportion([1, 1, 4])).toEqual([167, 167, 666]);
    // 12.5% / 37.5% / 50% of 10: quotas 1.25, 3.75, 5 → [1, 4, 5].
    expect(apportion([12.5, 37.5, 50], 10)).toEqual([1, 4, 5]);
  });

  it("treats non-finite and non-positive weights as 0", () => {
    expect(apportion([Number.NaN, 1, -5, Number.POSITIVE_INFINITY, 1])).toEqual([0, 500, 0, 0, 500]);
    expect(apportion([0, 3, 0])).toEqual([0, 1000, 0]);
  });

  it("splits equally when every weight is 0", () => {
    expect(apportion([0, 0, 0])).toEqual([334, 333, 333]);
    expect(apportion([0, -1, Number.NaN, 0])).toEqual([250, 250, 250, 250]);
  });

  it("handles empty input, a zero total and huge weights", () => {
    expect(apportion([])).toEqual([]);
    expect(apportion([3, 7], 0)).toEqual([0, 0]);
    expect(apportion([Number.MAX_VALUE, Number.MAX_VALUE])).toEqual([500, 500]);
    expect(() => apportion([1], -1)).toThrow(RangeError);
    expect(() => apportion([1], 1.5)).toThrow(RangeError);
  });

  it("always sums exactly and stays within one unit of each quota", () => {
    const random = rng(42);
    for (let run = 0; run < 500; run++) {
      const n = 1 + Math.floor(random() * 30);
      const fractional = run % 2 === 1;
      const raw = Array.from({ length: n }, () =>
        fractional ? random() * 97.3 : Math.floor(random() * 400),
      );
      const total = run % 5 === 0 ? 1 + Math.floor(random() * 5000) : 1000;
      const out = apportion(raw, total);
      expect(out).toHaveLength(n);
      expect(sum(out)).toBe(total);
      const rawSum = sum(raw);
      out.forEach((share, i) => {
        expect(Number.isInteger(share)).toBe(true);
        const quota = rawSum > 0 ? (raw[i]! / rawSum) * total : total / n;
        expect(share).toBeGreaterThanOrEqual(Math.floor(quota - 1e-6));
        expect(share).toBeLessThanOrEqual(Math.ceil(quota + 1e-6));
      });
    }
  });
});

describe("balancePackages", () => {
  it("splits the mockup plan (4 features × 20 + common 20) into five whole 20.0 packages", () => {
    const units = [
      ...group("login", [120, 30, 50]),
      ...group("cart", [125, 30, 45]),
      ...group("orders", [115, 35, 50]),
      ...group("admin", [110, 40, 50]),
      ...tasks([80, 60, 40, 20]),
    ];
    expect(sum(units.map((u) => u.points))).toBe(1000);
    const result = balancePackages(units, 5);
    checkShape(units, 5, result);
    expect(result.packages.map((p) => p.points)).toEqual([200, 200, 200, 200, 200]);
    expect(result.spread).toBe(0);
    expect(result.splitGroups).toEqual([]);
    expect(result.packages.map((p) => p.taskIds)).toEqual([
      ["login0", "login1", "login2"],
      ["cart0", "cart1", "cart2"],
      ["orders0", "orders1", "orders2"],
      ["admin0", "admin1", "admin2"],
      ["t0", "t1", "t2", "t3"],
    ]);
  });

  it("splits a group larger than a package and reports it", () => {
    const units = [...group("big", [300, 200, 100]), ...group("small", [120, 80]), ...tasks([200])];
    const result = balancePackages(units, 2);
    const loads = checkShape(units, 2, result);
    expect(loads).toEqual([500, 500]);
    expect(result.splitGroups).toEqual(["big"]);
    const where = packageOf(result);
    expect(where.get("small0")).toBe(where.get("small1"));
  });

  it("balances [30,25,20,15,10] (×10) into 500 / 500", () => {
    const units = tasks([300, 250, 200, 150, 100]);
    const result = balancePackages(units, 2);
    const loads = checkShape(units, 2, result);
    expect(loads).toEqual([500, 500]);
    expect(result.spread).toBe(0);
    // Greedy gives 550 / 450; the re-split moves the fewest tasks to reach 500 / 500.
    expect(result.packages.map((p) => p.taskIds)).toEqual([
      ["t1", "t3", "t4"],
      ["t0", "t2"],
    ]);
  });

  it("evens out packages that already carry points (preload)", () => {
    const units = tasks([10, 10, 10, 10]);
    const result = balancePackages(units, 2, { preload: [20] });
    const loads = checkShape(units, 2, result, [20]);
    expect(loads).toEqual([30, 30]);
    expect(result.packages.map((p) => p.points)).toEqual([10, 30]);
    expect(result.spread).toBe(0);
  });

  it("includes preload in the spread when it cannot be evened out", () => {
    const units = tasks([10, 10]);
    const result = balancePackages(units, 3, { preload: [100, 0, 5] });
    const loads = checkShape(units, 3, result, [100, 0, 5]);
    expect(loads).toEqual([100, 10, 15]);
    expect(result.spread).toBe(90);
  });

  it("is deterministic for equal weights", () => {
    const units = tasks([100, 100, 100, 100, 100, 100]);
    const first = balancePackages(units, 3);
    const second = balancePackages(tasks([100, 100, 100, 100, 100, 100]), 3);
    expect(second).toEqual(first);
    expect(first.packages.map((p) => p.taskIds)).toEqual([
      ["t0", "t3"],
      ["t1", "t4"],
      ["t2", "t5"],
    ]);
    expect(first.spread).toBe(0);

    const seven = tasks(apportion([1, 1, 1, 1, 1, 1, 1]));
    expect(balancePackages(seven, 3)).toEqual(balancePackages(seven, 3));
  });

  it("puts everything in the only package when count is 1", () => {
    const units = [...group("a", [400, 100]), ...tasks([500])];
    const result = balancePackages(units, 1);
    checkShape(units, 1, result);
    expect(result.packages).toEqual([{ taskIds: ["a0", "a1", "t0"], points: 1000 }]);
    expect(result.spread).toBe(0);
    expect(result.splitGroups).toEqual([]);
    expect(balancePackages(units, 1, { preload: [70] }).spread).toBe(0);
  });

  it("allows empty packages when there are more packages than tasks", () => {
    const units = tasks([600, 400]);
    const result = balancePackages(units, 4);
    checkShape(units, 4, result);
    expect(result.packages.map((p) => p.taskIds)).toEqual([["t0"], ["t1"], [], []]);
    expect(result.spread).toBe(600);
    expect(balancePackages([], 3)).toEqual({
      packages: [
        { taskIds: [], points: 0 },
        { taskIds: [], points: 0 },
        { taskIds: [], points: 0 },
      ],
      spread: 0,
      splitGroups: [],
    });
  });

  it("keeps groups whole while the spread is within the tolerance", () => {
    // Whole groups give 160 / 140 (spread 20); splitting both would give 150 / 150.
    const units = [...group("a", [90, 70]), ...group("b", [80, 60])];
    const whole = balancePackages(units, 2);
    expect(checkShape(units, 2, whole).sort()).toEqual([140, 160]);
    expect(whole.splitGroups).toEqual([]);

    const tight = balancePackages(units, 2, { tolerance: 10 });
    expect(checkShape(units, 2, tight)).toEqual([150, 150]);
    expect(tight.splitGroups).toEqual(["a", "b"]);
  });

  it("breaks only as many groups as needed, largest first", () => {
    // a=300 against b=150 + c=150: already even, nothing to break.
    const even = [...group("a", [200, 100]), ...group("b", [100, 50]), ...group("c", [100, 50])];
    expect(balancePackages(even, 2).splitGroups).toEqual([]);

    // a=400 cannot sit whole next to b=100 + c=100 (400 vs 200): breaking a alone is enough.
    const units = [...group("a", [200, 100, 100]), ...group("b", [60, 40]), ...group("c", [70, 30])];
    const result = balancePackages(units, 2);
    expect(checkShape(units, 2, result)).toEqual([300, 300]);
    expect(result.splitGroups).toEqual(["a"]);
  });

  it("returns the smallest spread with the fewest broken groups when nothing fits", () => {
    // An empty package fixes the spread at 90 whether or not the group is broken, so it stays whole.
    const units = [...group("g", [15, 20]), ...tasks([90])];
    const result = balancePackages(units, 4, { tolerance: 0 });
    expect(checkShape(units, 4, result)).toEqual([90, 35, 0, 0]);
    expect(result.splitGroups).toEqual([]);
    const loose = balancePackages(units.map((u) => ({ ...u, group: null })), 4, { tolerance: 0 });
    expect(checkShape(units, 4, loose)).toEqual([90, 20, 15, 0]);
    // Uneven single tasks: the best achievable spread is returned even above the tolerance.
    const odd = tasks([70, 20, 20]);
    const oddResult = balancePackages(odd, 2, { tolerance: 0 });
    expect(checkShape(odd, 2, oddResult).sort()).toEqual([40, 70]);
  });

  it("stays within one task of perfect and never above the tolerance when that is reachable", () => {
    const random = rng(7);
    for (let run = 0; run < 300; run++) {
      const n = 1 + Math.floor(random() * 25);
      const count = 1 + Math.floor(random() * 8);
      const points = apportion(Array.from({ length: n }, () => 1 + Math.floor(random() * 50)));
      const units = tasks(points);
      const result = balancePackages(units, count);
      checkShape(units, count, result);
      // Pairwise-optimal packages never differ by more than the largest task.
      expect(result.spread).toBeLessThanOrEqual(Math.max(...points));
      expect(balancePackages(tasks(points), count)).toEqual(result);
    }
  });

  it("finds the optimal two-package split for free-standing tasks", () => {
    const random = rng(99);
    for (let run = 0; run < 100; run++) {
      const n = 2 + Math.floor(random() * 10);
      const points = Array.from({ length: n }, () => 1 + Math.floor(random() * 300));
      const total = sum(points);
      let optimum = Infinity;
      for (let mask = 0; mask < 1 << n; mask++) {
        const a = sum(points.filter((_, i) => mask & (1 << i)));
        optimum = Math.min(optimum, Math.abs(total - 2 * a));
      }
      expect(balancePackages(tasks(points), 2).spread).toBe(optimum);
    }
  });

  it("keeps groups whole on random plans whenever whole groups fit the tolerance", () => {
    const random = rng(2026);
    for (let run = 0; run < 200; run++) {
      const units: PlanUnit[] = [];
      const groupCount = 1 + Math.floor(random() * 6);
      for (let g = 0; g < groupCount; g++) {
        const size = 1 + Math.floor(random() * 4);
        units.push(...group(`g${g}_`, Array.from({ length: size }, () => 10 + Math.floor(random() * 90))));
      }
      units.push(...tasks(Array.from({ length: Math.floor(random() * 5) }, () => 10 + Math.floor(random() * 60))));
      const count = 1 + Math.floor(random() * 6);
      const tolerance = Math.floor(random() * 40);
      const result = balancePackages(units, count, { tolerance });
      checkShape(units, count, result);
      if (result.splitGroups.length > 0) {
        // Splitting only happens when whole groups missed the tolerance.
        const wholeOnly = balancePackages(units, count, { tolerance: Infinity });
        expect(wholeOnly.splitGroups).toEqual([]);
        expect(wholeOnly.spread).toBeGreaterThan(tolerance);
      }
      const where = packageOf(result);
      for (let g = 0; g < groupCount; g++) {
        const packagesOfGroup = new Set(units.filter((u) => u.group === `g${g}_`).map((u) => where.get(u.id)));
        expect(packagesOfGroup.size > 1).toBe(result.splitGroups.includes(`g${g}_`));
      }
    }
  });

  it("rejects an invalid package count", () => {
    expect(() => balancePackages(tasks([1]), 0)).toThrow(RangeError);
    expect(() => balancePackages(tasks([1]), 1.5)).toThrow(RangeError);
  });
});

describe("previewBalance", () => {
  const units = (points: number[], group: string | null = null) => points.map((p) => ({ points: p, group }));

  it("rescales to 1000 first and reports the packages confirming would make", () => {
    // 35 / 30 / 20 / 10 typed → 368 / 316 / 211 / 105; four tasks can't fill five packages.
    expect(previewBalance(units([35, 30, 20, 10]), 5)).toEqual({
      packagePoints: [368, 316, 211, 105, 0],
      spread: 368,
      emptyPackages: 1,
      balanced: false,
    });
    expect(previewBalance(units([400, 300, 200, 100]), 2)).toEqual({ packagePoints: [500, 500], spread: 0, emptyPackages: 0, balanced: true });
  });

  it("counts a spread of up to 2.0 as even, but never an empty package", () => {
    expect(previewBalance(units([51, 49]), 2)).toMatchObject({ spread: 20, balanced: true });
    expect(previewBalance(units([52, 48]), 2)).toMatchObject({ spread: 40, balanced: false });
    expect(previewBalance(units([]), 3)).toEqual({ packagePoints: [0, 0, 0], spread: 0, emptyPackages: 3, balanced: false });
  });

  it("keeps feature groups together like confirming does", () => {
    const plan = [...units([30, 20], "a"), ...units([25, 25], "b")];
    const preview = previewBalance(plan, 2);
    expect(preview).toMatchObject({ spread: 0, balanced: true });
    expect(preview.packagePoints).toEqual([500, 500]);
  });
});
