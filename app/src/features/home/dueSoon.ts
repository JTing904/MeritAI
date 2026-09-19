import type { Messages } from '@/i18n/zh';
import { weekEnd } from '@/lib/time';

/**
 * The home sub-line from HomeData.dueSoon (M4 spec §2): `k` dues already past, `n` dues from now through
 * Sunday night of this week (device zone). 有 {k} 个任务过期了（，这周还有 {n} 个要交）/ 这周有 {n} 个任务要交 /
 * the idle line.
 */
export function dueSoonLine(dueSoon: string[], copy: Messages['home'], now = new Date()): string {
  const at = now.getTime();
  const end = weekEnd(now).getTime();
  let k = 0;
  let n = 0;
  for (const iso of dueSoon) {
    const due = new Date(iso).getTime();
    if (due < at) k += 1;
    else if (due <= end) n += 1;
  }
  if (k > 0) return copy.subOverdue(k, n);
  if (n > 0) return copy.subWeek(n);
  return copy.subIdle;
}
