// Calendar arithmetic for the date picker: whole days and months, no time zone (the picker works on
// wall-clock days in the project zone, see zoned.ts).
import { dayOfWeek, type Wall } from './zoned';

/** A calendar day: month 1–12. */
export type Day = Pick<Wall, 'y' | 'mo' | 'd'>;
export type Month = { y: number; mo: number };

const DAY_MS = 86_400_000;
const dayMs = (d: Day) => Date.UTC(d.y, d.mo - 1, d.d);
const fromMs = (ms: number): Day => {
  const t = new Date(ms);
  return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate() };
};

export const dayOf = (w: Day): Day => ({ y: w.y, mo: w.mo, d: w.d });
export const monthOf = (d: Day): Month => ({ y: d.y, mo: d.mo });

/** Negative when a is the earlier day. */
export const compareDay = (a: Day, b: Day) => dayMs(a) - dayMs(b);
export const compareMonth = (a: Month, b: Month) => a.y * 12 + a.mo - (b.y * 12 + b.mo);

export const addDays = (d: Day, n: number): Day => fromMs(dayMs(d) + n * DAY_MS);

export const daysInMonth = (m: Month) => new Date(Date.UTC(m.y, m.mo, 0)).getUTCDate();

export function shiftMonth(m: Month, n: number): Month {
  const i = m.y * 12 + m.mo - 1 + n;
  return { y: Math.floor(i / 12), mo: (i % 12) + 1 };
}

/** The same day n months later; 31 Jan + 1 month is the last day of February. */
export function addMonths(d: Day, n: number): Day {
  const m = shiftMonth(d, n);
  return { ...m, d: Math.min(d.d, daysInMonth(m)) };
}

/** The weeks of a month, Sunday first; null pads the first and the last week to 7 cells. */
export function monthWeeks(m: Month): (Day | null)[][] {
  const cells: (Day | null)[] = Array.from({ length: dayOfWeek({ ...m, d: 1 }) }, () => null);
  for (let d = 1; d <= daysInMonth(m); d++) cells.push({ ...m, d });
  while (cells.length % 7) cells.push(null);
  const weeks: (Day | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export type Presets = 'task' | 'project';
export type QuickKey = 'tomorrow' | 'thisFriday' | 'nextFriday' | 'deadline' | 'twoWeeks' | 'oneMonth' | 'twoMonths';

/**
 * The quick-pick chips above the month. Task: 明天 / 这周五 / 下周五 / 项目截止; project: 下周五 / 两周后 /
 * 一个月后 / 两个月后. Weeks start on Sunday. Chips outside [minDay, maxDay] are left out, and so is one
 * that would repeat another chip's day (这周五 when it is tomorrow; any day that is the project deadline).
 */
export function quickPicks(presets: Presets, today: Day, minDay: Day, maxDay: Day | null): { key: QuickKey; day: Day }[] {
  const thisFriday = addDays(today, 5 - dayOfWeek(today));
  const nextFriday = addDays(thisFriday, 7);
  const tomorrow = addDays(today, 1);
  const picks: { key: QuickKey; day: Day }[] =
    presets === 'task'
      ? [
          { key: 'tomorrow', day: tomorrow },
          ...(compareDay(thisFriday, tomorrow) > 0 ? [{ key: 'thisFriday' as const, day: thisFriday }] : []),
          { key: 'nextFriday', day: nextFriday },
        ]
      : [
          { key: 'nextFriday', day: nextFriday },
          { key: 'twoWeeks', day: addDays(today, 14) },
          { key: 'oneMonth', day: addMonths(today, 1) },
          { key: 'twoMonths', day: addMonths(today, 2) },
        ];
  const inRange = (d: Day) => compareDay(d, minDay) >= 0 && (!maxDay || compareDay(d, maxDay) <= 0);
  if (presets === 'project' || !maxDay) return picks.filter((p) => inRange(p.day));
  // 项目截止 stands for its day: a relative chip on the same day is left out.
  const out = picks.filter((p) => inRange(p.day) && compareDay(p.day, maxDay) !== 0);
  if (inRange(maxDay)) out.push({ key: 'deadline', day: maxDay });
  return out;
}
