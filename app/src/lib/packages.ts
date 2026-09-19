import { BALANCE_TOLERANCE } from '@shared/planning';
import type { PackageView } from '@shared/types';

export type PackageSpread = {
  /** All the same; even = within 2 points and none empty (REQUIREMENTS §13); otherwise uneven. */
  kind: 'equal' | 'even' | 'uneven';
  /** Tenths (0 without packages). */
  max: number;
  min: number;
  /** Their points split exactly over the packages, tenths. */
  average: number;
};

/** How even the packages are, as wizard step 6 and the pick screen say it. */
export function packageSpread(packages: Pick<PackageView, 'points' | 'taskIds'>[]): PackageSpread {
  const points = packages.map((p) => p.points);
  const max = points.length ? Math.max(...points) : 0;
  const min = points.length ? Math.min(...points) : 0;
  // Their own sum, not 100: finished work of people who left has no package any more.
  const average = points.length ? Math.round(points.reduce((a, b) => a + b, 0) / points.length) : 0;
  if (max === min) return { kind: 'equal', max, min, average };
  const even = max - min <= BALANCE_TOLERANCE && packages.every((p) => p.taskIds.length > 0);
  return { kind: even ? 'even' : 'uneven', max, min, average };
}
