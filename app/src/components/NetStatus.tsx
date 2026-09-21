import { useEffect, useState, type ReactNode } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useI18n } from '@/i18n';
import { recheckNetwork, useNetwork } from '@/lib/network';
import { makeStyles, useTheme } from '@/theme';
import { Button } from './Button';
import { Icon } from './Icon';
import { headingLevel } from './Screen';
import { Txt } from './Txt';

// No network (REQUIREMENTS §13 「省请求、防爆」, 2026-09-21): opening the app offline shows
// NoNetworkScreen instead of the app; losing the network while using it shows NetBar at the top of every
// screen (the page stays as it was); coming back turns the bar green for 2 s.

/** How long 「已连上网络，内容已更新」 stays. */
const BACK_MS = 2000;

const useStyles = makeStyles((c) =>
  StyleSheet.create({
    bar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 8,
      paddingHorizontal: 16,
      width: '100%',
    },
    blocked: {
      flex: 1,
      backgroundColor: c.paper,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 14,
      paddingVertical: 32,
      paddingHorizontal: 28,
    },
    icon: { width: 84, height: 84, borderRadius: 28, backgroundColor: c.warnSoft, alignItems: 'center', justifyContent: 'center' },
    wait: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.warn },
  }),
);

export type NetBarPhase = 'off' | 'back';

/** 'off' while offline, 'back' for 2 s after the network returns, null otherwise. */
export function useNetBarPhase(): NetBarPhase | null {
  const { online, known } = useNetwork();
  const [phase, setPhase] = useState<NetBarPhase | null>(known && !online ? 'off' : null);
  useEffect(() => {
    if (!known) return;
    if (!online) setPhase('off');
    else setPhase((p) => (p === 'off' ? 'back' : p));
  }, [online, known]);
  useEffect(() => {
    if (phase !== 'back') return;
    const timer = setTimeout(() => setPhase(null), BACK_MS);
    return () => clearTimeout(timer);
  }, [phase]);
  return phase;
}

const LIVE = Platform.OS === 'web' ? ({ 'aria-live': 'polite' } as object) : ({ accessibilityLiveRegion: 'polite' } as const);

/** The thin full-width bar: 没有网络 · 显示的是断网前的内容 / 已连上网络，内容已更新. */
export function NetBar({ phase }: { phase: NetBarPhase }) {
  const s = useStyles();
  const { c } = useTheme();
  const { t } = useI18n();
  const off = phase === 'off';
  return (
    <View style={[s.bar, { backgroundColor: off ? c.warnSoft : c.goodSoft }]} role="status" {...LIVE}>
      <Icon name={off ? 'wifiOff' : 'check'} size={off ? 16 : 15} color={off ? c.warn : c.good} />
      <Txt v="label" size={13} weight={700} color={off ? 'warn' : 'good'} numberOfLines={1}>
        {off ? t.offline.bar : t.offline.back}
      </Txt>
    </View>
  );
}

/**
 * Wraps the navigator: while the bar shows, it sits under the status bar and above every screen, and the
 * screens below get a top inset of 0 (the bar already cleared it). The tree keeps the same shape either
 * way, so showing the bar never remounts the screens.
 */
export function WithNetBar({ children, phase }: { children: ReactNode; phase: NetBarPhase | null }) {
  const insets = useSafeAreaInsets();
  const { c } = useTheme();
  return (
    <View style={{ flex: 1 }}>
      {phase && (
        <View style={{ paddingTop: insets.top, backgroundColor: c.paper }}>
          <NetBar phase={phase} />
        </View>
      )}
      <SafeAreaInsetsContext.Provider value={phase ? { ...insets, top: 0 } : insets}>{children}</SafeAreaInsetsContext.Provider>
    </View>
  );
}

/** Opening the app with no network: instead of the app, until the network is back (then it just opens). */
export function NoNetworkScreen({ onRetry }: { onRetry?: () => void }) {
  const s = useStyles();
  const { c } = useTheme();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const retry = onRetry ?? (() => recheckNetwork());
  return (
    <View style={[s.blocked, { paddingTop: 32 + insets.top, paddingBottom: 32 + insets.bottom }]}>
      <View style={s.icon}>
        <Icon name="wifiOff" size={40} color={c.warn} />
      </View>
      <Txt v="brand" size={26} center role="heading" {...headingLevel(1)} style={{ marginTop: 6 }}>
        {t.offline.title}
      </Txt>
      <Txt v="text" size={14.5} color="ink2" center style={{ maxWidth: 280, lineHeight: 23 }}>
        {t.offline.body}
      </Txt>
      <View style={{ width: '100%', maxWidth: 280 }}>
        <Button title={t.common.retry} block onPress={retry} />
      </View>
      <View style={s.wait}>
        <View style={s.dot} />
        <Txt v="meta" size={13}>
          {t.offline.waiting}
        </Txt>
      </View>
    </View>
  );
}
