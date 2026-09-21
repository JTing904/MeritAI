// Calendar arithmetic in a project's time zone (the lifecycle sheets).
import { addDays, compareDay, dayOf } from '@/features/wizard/calendar';
import { endOfDay, toIso, toWall } from '@/features/wizard/zoned';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Calendar days from `b` to `a` in `tz` (a later day → positive), whatever the times of day. */
export function daysBetween(a: string | Date, b: string | Date, tz: string): number {
  return Math.round(compareDay(dayOf(toWall(a, tz)), dayOf(toWall(b, tz))) / DAY_MS);
}

/** The same wall-clock time `n` days later in `tz`, as ISO. */
export function plusDays(iso: string, n: number, tz: string): string {
  const w = toWall(iso, tz);
  return toIso({ ...addDays(dayOf(w), n), h: w.h, mi: w.mi }, tz);
}

/** 23:59 `n` days after `from`'s day in `tz`, as ISO. */
export function endOfDayAfter(from: Date, n: number, tz: string): string {
  return toIso(endOfDay(addDays(dayOf(toWall(from, tz)), n)), tz);
}
