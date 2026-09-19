import { useMemo } from 'react';
import { useI18n } from '@/i18n';
import type { DateParts } from '@/i18n/sections/wizard.zh';
import { dayOfWeek, toWall, utcOffsetLabel, type Wall } from './zoned';

/** Zones offered in the time-zone sheet (the device zone is added first when it is missing). */
export const ZONES = [
  'Asia/Kuala_Lumpur',
  'Asia/Singapore',
  'Asia/Jakarta',
  'Asia/Bangkok',
  'Asia/Ho_Chi_Minh',
  'Asia/Manila',
  'Asia/Shanghai',
  'Asia/Hong_Kong',
  'Asia/Taipei',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Asia/Kolkata',
  'Asia/Dubai',
  'Australia/Perth',
  'Australia/Melbourne',
  'Australia/Sydney',
  'Pacific/Auckland',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'UTC',
];

const pad = (n: number) => String(n).padStart(2, '0');

/** Date formatting in a project's time zone, in the app language. */
export function useDates(tz: string) {
  const { t } = useI18n();
  return useMemo(() => {
    const thisYear = toWall(Date.now(), tz).y;
    const parts = (w: Wall): DateParts => ({
      year: w.y === thisYear ? null : w.y,
      month: w.mo,
      day: w.d,
      weekday: dayOfWeek(w),
      time: `${pad(w.h)}:${pad(w.mi)}`,
    });
    const at = (kind: keyof Omit<typeof t.wizard.dates, 'zone'>) => (value: string | Date | Wall) =>
      t.wizard.dates[kind](parts(isWall(value) ? value : toWall(value, tz)));
    return {
      /** 11月6日（周五）23:59 */
      long: at('long'),
      /** 10月30日 23:59 */
      dateTime: at('dateTime'),
      /** 10月1日 */
      date: at('date'),
      /** 10/9 */
      short: at('short'),
      /** 吉隆坡（UTC+8） */
      zone: (zone = tz) => t.wizard.dates.zone(zoneName(zone, t.wizard.zones), utcOffsetLabel(zone)),
    };
  }, [t, tz]);
}

function isWall(v: unknown): v is Wall {
  return typeof v === 'object' && v !== null && 'mo' in v;
}

export function zoneName(tz: string, names: Record<string, string>): string {
  return names[tz] ?? (tz.split('/').pop() ?? tz).replace(/_/g, ' ');
}
