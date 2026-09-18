import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View, type RefreshControlProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useI18n } from '@/i18n';
import { makeStyles, useTheme } from '@/theme';
import { MAX_WIDTH } from '@/theme/tokens';
import { Icon } from './Icon';
import { Txt } from './Txt';

const useStyles = makeStyles((c) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: c.paper },
    content: { paddingHorizontal: 18, paddingTop: 4, gap: 18, width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center' },
    top: { paddingTop: 6 },
    appbar: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 8,
      backgroundColor: c.appbar,
      width: '100%',
      maxWidth: MAX_WIDTH,
      alignSelf: 'center',
    },
    iconBtn: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
    appbarMid: { flex: 1, alignItems: 'center' },
  }),
);

/** Web heading level (RN's `role="heading"` renders as <h1> on web without it). */
export const headingLevel = (level: 1 | 2 | 3) => (Platform.OS === 'web' ? ({ 'aria-level': level } as object) : {});

/** Scrollable page on paper, with the prototype's 18px gutter and 18px gap between blocks. */
export function Screen({
  children,
  header,
  refreshControl,
  bottomInset = true,
}: {
  children: ReactNode;
  /** Pushed screens pass an <AppBar>; root tabs put their title inside children. */
  header?: ReactNode;
  refreshControl?: React.ReactElement<RefreshControlProps>;
  /** Screens under the tab bar pass false (the tab bar already clears the gesture area). */
  bottomInset?: boolean;
}) {
  const s = useStyles();
  const insets = useSafeAreaInsets();
  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      {header}
      <ScrollView
        contentContainerStyle={[s.content, { paddingTop: header ? 18 : 4, paddingBottom: 28 + (bottomInset ? insets.bottom : 0) }]}
        refreshControl={refreshControl}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        {children}
      </ScrollView>
    </View>
  );
}

/** Root-tab page title (我的任务 / 通知 / 我). */
export function PageTitle({ children }: { children: string }) {
  const s = useStyles();
  return (
    <View style={s.top}>
      <Txt v="title" role="heading" {...headingLevel(1)}>
        {children}
      </Txt>
    </View>
  );
}

/** Pushed-screen bar: back, centred title and subtitle, optional right action. */
export function AppBar({ title, sub, onBack, right }: { title: string; sub?: string; onBack?: () => void; right?: ReactNode }) {
  const s = useStyles();
  const { c } = useTheme();
  const { t } = useI18n();
  // A screen opened directly (deep link, reload on web) has nothing to go back to: go home instead.
  const back = onBack ?? (() => (router.canGoBack() ? router.back() : router.replace('/')));
  return (
    <View style={s.appbar}>
      <Pressable onPress={back} role="button" aria-label={t.common.back} style={s.iconBtn}>
        <Icon name="back" color={c.ink} />
      </Pressable>
      <View style={s.appbarMid}>
        <Txt v="appbar" numberOfLines={1} role="heading" {...headingLevel(1)}>
          {title}
        </Txt>
        {sub && (
          <Txt v="appbarSub" numberOfLines={1}>
            {sub}
          </Txt>
        )}
      </View>
      <View style={s.iconBtn}>{right}</View>
    </View>
  );
}
