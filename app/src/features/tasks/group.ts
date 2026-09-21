import type { MyTaskRow } from '@shared/types';
import { dayDiff, weekEnd } from '@/lib/time';
import { appNow } from '@/lib/lifecycle';

export type GroupKey = 'overdue' | 'today' | 'tomorrow' | 'thisWeek' | 'later';

export const GROUP_ORDER: GroupKey[] = ['overdue', 'today', 'tomorrow', 'thisWeek', 'later'];

/** A row of 待完成 as the tab shows it (device zone, at `now`). */
export type OpenRow = {
  row: MyTaskRow;
  due: Date;
  group: GroupKey;
  /** Past due and not handed in: 🐢, 过期 {d} 天. */
  overdue: boolean;
  /** REVIEWING / HALF past its due: never overdue, listed under 之后 with 「截止 {M月D日} · 已交」 (§15 #2). */
  pastHandedIn: boolean;
  /** Whole calendar days past due (0 = earlier today). */
  daysLate: number;
};

/** REVIEWING and HALF were handed in on time or not: either way they are not in the 过期名单. */
const handedIn = (row: MyTaskRow) => row.status === 'REVIEWING' || row.status === 'HALF';

/**
 * Buckets 待完成 by effective due in the device zone: 已过期, 今天, 明天, 这周 (after tomorrow through
 * Sunday of this Mon–Sun week), 之后; each sorted by due ascending. Empty groups are left out.
 */
export function groupOpen(rows: MyTaskRow[], now = appNow()): { key: GroupKey; rows: OpenRow[] }[] {
  const end = weekEnd(now).getTime();
  const out = new Map<GroupKey, OpenRow[]>();
  for (const row of rows) {
    const due = new Date(row.dueAt);
    const past = due.getTime() < now.getTime();
    const pastHandedIn = past && handedIn(row);
    const overdue = past && !handedIn(row);
    const days = dayDiff(due, now);
    let group: GroupKey;
    if (overdue) group = 'overdue';
    else if (pastHandedIn) group = 'later';
    else if (days === 0) group = 'today';
    else if (days === 1) group = 'tomorrow';
    else if (due.getTime() <= end) group = 'thisWeek';
    else group = 'later';
    const list = out.get(group) ?? [];
    list.push({ row, due, group, overdue, pastHandedIn, daysLate: overdue ? Math.max(0, -days) : 0 });
    out.set(group, list);
  }
  return GROUP_ORDER.filter((key) => out.has(key)).map((key) => ({
    key,
    rows: (out.get(key) ?? []).sort((a, b) => a.due.getTime() - b.due.getTime()),
  }));
}

/** 已完成, newest finishedAt first (the server sends them so; kept stable here). */
export function sortDone(rows: MyTaskRow[]): MyTaskRow[] {
  const at = (r: MyTaskRow) => (r.finishedAt ? new Date(r.finishedAt).getTime() : 0);
  return [...rows].sort((a, b) => at(b) - at(a));
}
