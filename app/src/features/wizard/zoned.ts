// Wall-clock times in a project's IANA time zone, with no date library.
// The wizard shows and picks times in the project zone (default = the leader's device zone),
// so "11月6日 23:59" means 23:59 in that zone even when the device is elsewhere.
import { getCalendars } from 'expo-localization';

/** A wall-clock time: month 1–12, hour 0–23. */
export type Wall = { y: number; mo: number; d: number; h: number; mi: number };

export const FALLBACK_TZ = 'Asia/Kuala_Lumpur';

export function deviceTimeZone(): string {
  try {
    const tz = getCalendars()[0]?.timeZone;
    if (tz) return tz;
  } catch {
    // expo-localization unavailable: use Intl below.
  }
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || FALLBACK_TZ;
  } catch {
    return FALLBACK_TZ;
  }
}

const formatters = new Map<string, Intl.DateTimeFormat | null>();

function formatter(tz: string): Intl.DateTimeFormat | null {
  if (!formatters.has(tz)) {
    try {
      formatters.set(
        tz,
        new Intl.DateTimeFormat('en-US', {
          timeZone: tz,
          hourCycle: 'h23',
          year: 'numeric',
          month: 'numeric',
          day: 'numeric',
          hour: 'numeric',
          minute: 'numeric',
        }),
      );
    } catch {
      // Unknown zone, or an engine without time-zone support.
      formatters.set(tz, null);
    }
  }
  return formatters.get(tz) ?? null;
}

function localWall(date: Date): Wall {
  return { y: date.getFullYear(), mo: date.getMonth() + 1, d: date.getDate(), h: date.getHours(), mi: date.getMinutes() };
}

/** The wall-clock time of an instant in `tz` (falls back to the device zone if Intl can't do it). */
export function toWall(at: Date | string | number, tz: string): Wall {
  const date = new Date(at);
  const f = formatter(tz);
  if (!f) return localWall(date);
  try {
    if (typeof f.formatToParts === 'function') {
      const parts = f.formatToParts(date);
      const pick = (type: string) => Number(parts.find((p) => p.type === type)?.value);
      const wall = { y: pick('year'), mo: pick('month'), d: pick('day'), h: pick('hour') % 24, mi: pick('minute') };
      if (Object.values(wall).every(Number.isFinite)) return wall;
    }
    // "9/18/2026, 23:05"
    const m = f.format(date).match(/(\d+)\/(\d+)\/(\d+),?\s+(\d+):(\d+)/);
    if (m) return { y: +m[3]!, mo: +m[1]!, d: +m[2]!, h: +m[4]! % 24, mi: +m[5]! };
  } catch {
    // fall through
  }
  return localWall(date);
}

const wallAsUtc = (w: Wall) => Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi);

/** Minutes `tz` is ahead of UTC at an instant (e.g. +480 for Kuala Lumpur). */
export function offsetMinutes(tz: string, at: Date | number = Date.now()): number {
  const t = typeof at === 'number' ? at : at.getTime();
  const floored = Math.floor(t / 60000) * 60000;
  return Math.round((wallAsUtc(toWall(floored, tz)) - floored) / 60000);
}

/** The instant a wall-clock time in `tz` happens (DST gaps resolve forward, like most calendars). */
export function fromWall(w: Wall, tz: string): Date {
  const guess = wallAsUtc(w);
  const first = guess - offsetMinutes(tz, guess) * 60000;
  const second = guess - offsetMinutes(tz, first) * 60000;
  if (wallAsUtc(toWall(second, tz)) === guess) return new Date(second);
  if (wallAsUtc(toWall(first, tz)) === guess) return new Date(first);
  // Inside a DST gap the wall time never happens: take the later instant.
  return new Date(Math.max(first, second));
}

export const toIso = (w: Wall, tz: string) => fromWall(w, tz).toISOString();

/** 0 = Sunday. */
export const dayOfWeek = (w: Pick<Wall, 'y' | 'mo' | 'd'>) => new Date(Date.UTC(w.y, w.mo - 1, w.d)).getUTCDay();

export const sameDay = (a: Wall, b: Wall) => a.y === b.y && a.mo === b.mo && a.d === b.d;

/** Compare two walls: negative when a is earlier. */
export const compareWall = (a: Wall, b: Wall) => wallAsUtc(a) - wallAsUtc(b);

/** A date-only choice means 23:59 on that day (REQUIREMENTS §13). */
export const endOfDay = (w: Pick<Wall, 'y' | 'mo' | 'd'>): Wall => ({ y: w.y, mo: w.mo, d: w.d, h: 23, mi: 59 });

const pad = (n: number) => String(n).padStart(2, '0');

/** "UTC+8", "UTC+5:30", "UTC-4". */
export function utcOffsetLabel(tz: string, at?: Date | number): string {
  const off = offsetMinutes(tz, at);
  const sign = off < 0 ? '-' : '+';
  const abs = Math.abs(off);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `UTC${sign}${h}${m ? `:${pad(m)}` : ''}`;
}
