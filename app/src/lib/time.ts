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
