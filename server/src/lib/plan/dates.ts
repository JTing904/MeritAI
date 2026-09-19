// Wall-clock maths in a project's IANA time zone, with Intl only (no date library).
// A date-only due date means 23:59 that day in the project's zone; rule-parsed tasks get due dates
// spread evenly between now and the project deadline.

// An IANA zone name ("Asia/Kuala_Lumpur", "UTC", "Etc/GMT+8"). Intl also takes offsets like "+08:00",
// which Postgres's AT TIME ZONE reads with the opposite (POSIX) sign, so they are refused.
const ZONE_NAME_RE = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/;
const CANONICAL_CASE_RE = /^[A-Z][A-Za-z0-9_+-]*(?:\/[A-Z0-9][A-Za-z0-9_+-]*)*$/;

/**
 * The zone name as stored: "asia/kuala_lumpur" → "Asia/Kuala_Lumpur"; null for unknown names and offsets.
 * A correctly written alias ("Asia/Calcutta") is kept as given, so it still matches the device's zone.
 */
export function canonicalTimeZone(tz: string): string | null {
  if (typeof tz !== "string" || tz.length > 64 || !ZONE_NAME_RE.test(tz)) return null;
  let resolved: string;
  try {
    resolved = new Intl.DateTimeFormat("en-US", { timeZone: tz }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
  if (!ZONE_NAME_RE.test(resolved)) return null;
  if (resolved.toLowerCase() === tz.toLowerCase()) return resolved;
  return CANONICAL_CASE_RE.test(tz) ? tz : resolved;
}

/** True for an IANA zone name Intl knows (e.g. "Asia/Kuala_Lumpur"); offsets like "+08:00" are not zones. */
export function isValidTimeZone(tz: string): boolean {
  return canonicalTimeZone(tz) !== null;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(tz, f);
  }
  return f;
}

type WallClock = { year: number; month: number; day: number; hour: number; minute: number; second: number };

/** What a clock in `tz` shows at that instant. */
export function wallClock(instant: Date, tz: string): WallClock {
  const parts: Record<string, number> = {};
  for (const p of formatter(tz).formatToParts(instant)) if (p.type !== "literal") parts[p.type] = Number(p.value);
  return parts as WallClock;
}

/** Milliseconds the zone is ahead of UTC at that instant (Asia/Kuala_Lumpur → 8 h). */
function zoneOffset(instantMs: number, tz: string): number {
  const w = wallClock(new Date(instantMs), tz);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return asUtc - Math.floor(instantMs / 1000) * 1000;
}

/**
 * The instant when the wall clock in `tz` reads the given local time (month 1–12).
 * A time skipped by a daylight-saving change lands just after the gap.
 */
export function zonedTime(year: number, month: number, day: number, hour: number, minute: number, tz: string): Date {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const first = wall - zoneOffset(wall, tz);
  // Near a DST change the offset at the answer can differ from the offset at the guess.
  const second = wall - zoneOffset(first, tz);
  for (const candidate of [second, first]) {
    const w = wallClock(new Date(candidate), tz);
    if (w.day === day && w.hour === hour && w.minute === minute) return new Date(candidate);
  }
  return new Date(Math.max(first, second));
}

/** The calendar date of an instant in `tz`, as "YYYY-MM-DD". */
export function localDate(instant: Date, tz: string): string {
  const w = wallClock(instant, tz);
  return `${w.year}-${String(w.month).padStart(2, "0")}-${String(w.day).padStart(2, "0")}`;
}

export const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * "2026-10-01" → 23:59:59.999 that day in `tz` (what a date-only due date means; shown as 23:59). The
 * whole last minute counts, so work handed in at 23:59:30 isn't late (A19).
 */
export function endOfLocalDay(ymd: string, tz: string): Date {
  const [year, month, day] = ymd.split("-").map(Number) as [number, number, number];
  return new Date(zonedTime(year, month, day, 23, 59, tz).getTime() + 59_999);
}

/** A due-date input ("YYYY-MM-DD" or an ISO date-time) as an instant; date-only means 23:59 in `tz`. */
export function toInstant(input: string, tz: string): Date {
  return DATE_ONLY.test(input) ? endOfLocalDay(input, tz) : new Date(input);
}

/**
 * Even due dates for `count` tasks: task i (0-based) is due at 23:59 in `tz` on the local date of
 * start + (i+1)/count × (deadline − start), never after the deadline; the last task is due at the
 * deadline itself. The dates never go backwards. A deadline at or before `start` gives every task the deadline.
 */
export function spreadDueDates(count: number, start: Date, deadline: Date, tz: string): Date[] {
  const span = deadline.getTime() - start.getTime();
  return Array.from({ length: Math.max(0, count) }, (_, i) => {
    if (i === count - 1 || span <= 0) return new Date(deadline);
    const point = new Date(start.getTime() + ((i + 1) / count) * span);
    const endOfDay = endOfLocalDay(localDate(point, tz), tz);
    return endOfDay > deadline ? new Date(deadline) : endOfDay;
  });
}
