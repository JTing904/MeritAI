// 「把太大的任务自动拆成几部分」 (wizard step 5): when the packages would come out uneven, the biggest
// tasks are split into equal parts named "书面报告（第 1/2 部分）" / "Written report (part 1/2)".
import type { Locale } from "../../../../shared/constants";
import { apportion, previewBalance } from "../../../../shared/planning";

/** Splitting never grows a plan beyond this many tasks. */
export const MAX_SPLIT_TASKS = 60;
/** Same limit as a task title typed in the app. */
const MAX_TITLE_LENGTH = 120;

export type SplitCandidate = {
  /** Tenths, as the leader typed them (any total). */
  points: number;
  /** Feature id: the balancer keeps a feature's tasks in one package when it can. */
  group: string | null;
  /** Only tasks nobody started can be split (their points can still change). */
  splittable: boolean;
};

/** Equal parts of `points` that add up exactly (largest remainder; earlier parts take the extra tenth). */
export function equalParts(points: number, parts: number): number[] {
  return apportion(new Array<number>(parts).fill(1), points);
}

function expand(tasks: SplitCandidate[], parts: number[]) {
  return tasks.flatMap((t, i) => equalParts(t.points, parts[i]!).map((points) => ({ points, group: t.group })));
}

/**
 * How many equal parts each task becomes (1 = unchanged). Each round re-splits the task whose parts
 * are currently the biggest into one more equal part, and stops as soon as the packages come out
 * even (see previewBalance), the plan reaches MAX_SPLIT_TASKS or nothing is left to split. If they
 * never come out even, the earliest round with the best result wins, so no task is cut up for nothing.
 */
export function planSplit(tasks: SplitCandidate[], count: number, maxTasks = MAX_SPLIT_TASKS): number[] {
  const parts = tasks.map(() => 1);
  const first = previewBalance(expand(tasks, parts), count);
  if (first.balanced) return parts;
  let best = { parts: parts.slice(), empty: first.emptyPackages, spread: first.spread };
  for (let total = tasks.length; total < maxTasks; total++) {
    let pick = -1;
    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i]!;
      // Every part keeps at least one tenth.
      if (!t.splittable || t.points < parts[i]! + 1) continue;
      // Biggest part first (points / parts, compared without division); ties go to the earlier task.
      if (pick < 0 || t.points * parts[pick]! > tasks[pick]!.points * parts[i]!) pick = i;
    }
    if (pick < 0) break;
    parts[pick]!++;
    const b = previewBalance(expand(tasks, parts), count);
    if (b.balanced) return parts;
    if (b.emptyPackages < best.empty || (b.emptyPackages === best.empty && b.spread < best.spread)) {
      best = { parts: parts.slice(), empty: b.emptyPackages, spread: b.spread };
    }
  }
  return best.parts;
}

const PART_ZH_RE = /^(.*?)\s*[（(]\s*第\s*(\d+)\s*\/\s*(\d+)\s*部分\s*[）)]$/;
const PART_EN_RE = /^(.*?)\s*\(\s*part\s+(\d+)\s*\/\s*(\d+)\s*\)$/i;

/** The title without its part label: "书面报告（第 1/2 部分）" → "书面报告"; null when it is not a part. */
export function partBase(title: string): string | null {
  const m = PART_ZH_RE.exec(title) ?? PART_EN_RE.exec(title);
  const base = m?.[1]?.trim();
  return base ? base : null;
}

/** "书面报告（第 1/2 部分）" (zh) or "Written report (part 1/2)" (en), cut to fit the title limit. */
export function partTitle(base: string, index: number, of: number, locale: Locale): string {
  const label = locale === "zh" ? `（第 ${index}/${of} 部分）` : ` (part ${index}/${of})`;
  const chars = [...base];
  while (chars.length > 0 && chars.join("").length + label.length > MAX_TITLE_LENGTH) chars.pop();
  return chars.join("").trimEnd() + label;
}

export type SplitRow = {
  /** Index of the task this row comes from. */
  source: number;
  /** The first part keeps the original task (its id); the others are new tasks. */
  first: boolean;
  title: string;
  points: number;
  /** Into how many parts the source task was split this time (1 = not split). */
  parts: number;
};

/**
 * The plan after splitting, in order: each split task's parts take its place. Parts are numbered
 * across every task that shares their base title, so splitting "报告（第 1/2 部分）" and
 * "报告（第 2/2 部分）" once more gives "报告（第 1/4 部分）" … "报告（第 4/4 部分）".
 */
export function splitRows(tasks: { title: string; points: number }[], parts: number[], locale: Locale): SplitRow[] {
  const rows: (SplitRow & { base: string | null })[] = [];
  const touched = new Set<string>();
  tasks.forEach((t, i) => {
    const k = parts[i] ?? 1;
    if (k <= 1) {
      rows.push({ source: i, first: true, title: t.title, points: t.points, parts: 1, base: partBase(t.title) });
      return;
    }
    const base = partBase(t.title) ?? t.title.trim();
    touched.add(base);
    equalParts(t.points, k).forEach((points, j) => rows.push({ source: i, first: j === 0, title: t.title, points, parts: k, base }));
  });
  const numbered = rows.filter((r) => r.base !== null && touched.has(r.base));
  const totals = new Map<string, number>();
  for (const r of numbered) totals.set(r.base!, (totals.get(r.base!) ?? 0) + 1);
  const seen = new Map<string, number>();
  for (const r of numbered) {
    const index = (seen.get(r.base!) ?? 0) + 1;
    seen.set(r.base!, index);
    r.title = partTitle(r.base!, index, totals.get(r.base!)!, locale);
  }
  return rows.map(({ base: _base, ...row }) => row);
}
