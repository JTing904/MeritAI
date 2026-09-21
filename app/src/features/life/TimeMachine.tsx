import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { TickResult, TimeMachineInput, TimeMachineState, UnreadCount } from '@shared/types';
import { Button } from '@/components/Button';
import { Txt } from '@/components/Txt';
import { useToast } from '@/components/Toast';
import { useUnread } from '@/features/notifs/useUnread';
import { useLocalDates } from '@/features/project/parts';
import { useI18n } from '@/i18n';
import type { Messages } from '@/i18n/zh';
import { ApiClientError, errorCode } from '@/lib/api';
import { UNREAD_KEY } from '@/lib/cacheKeys';
import { setClockOffset } from '@/lib/lifecycle';
import { useSession } from '@/lib/session';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const styles = StyleSheet.create({
  col: { paddingVertical: 13, paddingHorizontal: 14, gap: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});

/** 「3 天 4 小时」 from an offset (sign handled by the caller). */
function spanText(ms: number, k: Messages['life']['timeMachine']): string {
  const minutes = Math.round(Math.abs(ms) / 60_000);
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  const parts = [d > 0 ? k.days(d) : null, h > 0 ? k.hours(h) : null, m > 0 && d === 0 ? k.minutes(m) : null].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : k.minutes(0);
}

/** How far to the next Sunday 20:05 (device zone) after `now`: today's when it is Sunday before 20:05. */
function toNextSunday(now: Date): number {
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate() + ((7 - now.getDay()) % 7), 20, 5, 0, 0);
  if (target.getTime() <= now.getTime()) target.setDate(target.getDate() + 7);
  return target.getTime() - now.getTime();
}

/** Notifications one tick sent (every reminder kind, and the lifecycle notices). */
const sent = (tick: TickResult | null) =>
  tick
    ? tick.dueSoon +
      tick.overdue +
      tick.blocked +
      tick.weekly +
      tick.deleteWarnings +
      tick.projectsDue +
      tick.autoEndWarnings +
      tick.autoEnded
    : 0;

/**
 * 时间机器 (M5, development builds only; the server's dev gate): shows the server clock and its offset,
 * jumps it forward (each jump runs one tick on the server), and afterwards treats every cached screen as
 * stale (cacheKeys.writeEffect) and refreshes the profile and the unread badge right away.
 */
export function TimeMachine() {
  const { t } = useI18n();
  const k = t.life.timeMachine;
  const { request, cached, refreshMe } = useSession();
  const { report } = useUnread();
  const { show } = useToast();
  const dates = useLocalDates();
  const [state, setState] = useState<TimeMachineState | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const take = useCallback((next: TimeMachineState) => {
    setClockOffset(next.offsetMs);
    setState(next);
  }, []);

  // Re-read on every focus: the tab stays mounted, and the offset may have been moved elsewhere.
  useFocusEffect(
    useCallback(() => {
      request<TimeMachineState>('/dev/time-machine').then(take, (err) => {
        if (err instanceof ApiClientError && (err.code === 'NOT_FOUND' || err.status === 404)) setUnavailable(true);
      });
    }, [request, take]),
  );

  const jump = async (key: string, body: TimeMachineInput) => {
    if (busy) return;
    setBusy(key);
    try {
      // request() applies the write effect: every cached key is stale now.
      const next = await request<TimeMachineState>('/dev/time-machine', { method: 'POST', body });
      take(next);
      show(k.ticked(sent(next.tick)));
      // The screen showing now (我) and the badge: fetch again at once; the others refetch when they show.
      await Promise.all([
        refreshMe().catch(() => {}),
        cached<UnreadCount>(UNREAD_KEY, { force: true }).then(
          ({ data }) => report(data.count),
          () => {},
        ),
      ]);
    } catch (err) {
      show(t.errors[errorCode(err)]);
    } finally {
      setBusy(null);
    }
  };

  if (unavailable) {
    return (
      <View style={styles.col}>
        <Txt v="text">{k.title}</Txt>
        <Txt v="meta">{k.unavailable}</Txt>
      </View>
    );
  }

  const offset = state?.offsetMs ?? 0;
  const offsetLine = offset === 0 ? k.none : offset > 0 ? k.offset(spanText(offset, k)) : k.behind(spanText(offset, k));
  const now = state ? new Date(state.now) : null;
  const btn = (key: string, title: string, body: TimeMachineInput | (() => TimeMachineInput)) => (
    <Button
      key={key}
      title={title}
      kind="soft"
      small
      loading={busy === key}
      disabled={!state || (busy !== null && busy !== key)}
      onPress={() => jump(key, typeof body === 'function' ? body() : body)}
    />
  );

  return (
    <View style={styles.col}>
      <Txt v="text">{k.title}</Txt>
      <Txt v="meta" size={12}>
        {now ? `${k.now(dates.long(now))} · ${offsetLine}` : k.loading}
      </Txt>
      <View style={styles.row}>
        {btn('hour', k.hour, { advanceMs: HOUR })}
        {btn('day', k.day, { advanceMs: DAY })}
        {btn('week', k.week, { advanceMs: 7 * DAY })}
        {/* Counted at the press: the server clock is real time plus the offset. */}
        {btn('sunday', k.sunday, () => ({ advanceMs: toNextSunday(new Date(Date.now() + offset)) }))}
        {btn('reset', k.reset, { reset: true })}
      </View>
      <Txt v="meta" size={12}>
        {k.hint}
      </Txt>
    </View>
  );
}
