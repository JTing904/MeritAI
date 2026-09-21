import type { Messages } from '@/i18n/zh';
import { appNow } from '@/lib/lifecycle';

// Moved to shared/format.ts (the server uses them too); re-exported so existing imports keep working.
export { givenName, projectTag } from '@shared/format';

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Whole calendar days from today to the deadline in the viewer's time zone (0 = today, negative = past). */
export function daysUntil(iso: string, now = appNow()): number {
  return Math.round((startOfDay(new Date(iso)) - startOfDay(now)) / DAY_MS);
}

/** "今天 14:20" / "昨天 14:20" / "9月18日 14:20" / "2025年9月18日" in the viewer's time zone. */
export function formatWhen(iso: string, when: Messages['home']['when'], now = appNow()): string {
  const d = new Date(iso);
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const days = Math.round((startOfDay(now) - startOfDay(d)) / DAY_MS);
  if (days <= 0) return when.today(time);
  if (days === 1) return when.yesterday(time);
  if (d.getFullYear() === now.getFullYear()) return when.thisYear(d.getMonth() + 1, d.getDate(), time);
  return when.older(d.getFullYear(), d.getMonth() + 1, d.getDate());
}
