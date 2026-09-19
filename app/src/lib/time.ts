import type { Messages } from '@/i18n/zh';

export type RelativeLabels = Messages['labels']['relative'];

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/**
 * When something happened, in the viewer's time zone (notifications, feed): 刚刚 (under a minute,
 * or a clock slightly ahead), {m} 分钟前, {h} 小时前 (same day), 昨天, M月D日 (this year), YYYY年M月D日.
 */
export function relativeTime(iso: string, labels: RelativeLabels, now = new Date()): string {
  const d = new Date(iso);
  const minutes = Math.floor((now.getTime() - d.getTime()) / 60_000);
  if (minutes < 1) return labels.justNow;
  if (minutes < 60) return labels.minutes(minutes);
  const today = startOfDay(now);
  if (startOfDay(d) === today) return labels.hours(Math.floor(minutes / 60));
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime();
  if (startOfDay(d) === yesterday) return labels.yesterday;
  if (d.getFullYear() === now.getFullYear()) return labels.thisYear(d.getMonth() + 1, d.getDate());
  return labels.older(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

export type WhenLabels = Messages['labels']['when'];
export type DueLabels = Messages['labels']['due'];

const DAY_MS = 24 * 60 * 60 * 1000;

/** 09:12 (24-hour, device zone). */
const clock = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/** Calendar days from `b` to `a` in the device zone (a later day → positive), whatever the times of day. */
export function dayDiff(a: Date, b: Date): number {
  return Math.round((startOfDay(a) - startOfDay(b)) / DAY_MS);
}

/** Sunday 23:59:59.999 of the current Monday–Sunday week, device zone. */
export function weekEnd(now = new Date()): Date {
  const toSunday = (7 - now.getDay()) % 7;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + toSunday, 23, 59, 59, 999);
}

/**
 * A moment with its time, for status lines (交于 …, 评于 …): 今天 09:12 / 昨天 18:40 / 9月23日 21:10 /
 * 2025年9月23日 21:10, device zone.
 */
export function dateTimeLabel(iso: string, labels: WhenLabels, now = new Date()): string {
  const d = new Date(iso);
  const time = clock(d);
  const days = dayDiff(now, d);
  if (days === 0) return labels.today(time);
  if (days === 1) return labels.yesterday(time);
  if (d.getFullYear() === now.getFullYear()) return labels.thisYear(d.getMonth() + 1, d.getDate(), time);
  return labels.older(d.getFullYear(), d.getMonth() + 1, d.getDate(), time);
}

/**
 * A due date, short (the tasks tab and the task page's head chip): 今天 23:59 / 明天 09:30 / 周日 20:00
 * (later this week) / 9月28日 (anything else, a past date too), device zone.
 */
export function dueLabel(iso: string, labels: DueLabels, now = new Date()): string {
  const d = new Date(iso);
  const time = clock(d);
  const days = dayDiff(d, now);
  if (days === 0) return labels.today(time);
  if (days === 1) return labels.tomorrow(time);
  if (days > 1 && d <= weekEnd(now)) return labels.weekday(d.getDay(), time);
  return labels.date(d.getMonth() + 1, d.getDate());
}
