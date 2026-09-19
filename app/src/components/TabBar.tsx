import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { Pressable, StyleSheet, View } from 'react-native';
import { useI18n } from '@/i18n';
import { makeStyles, useTheme } from '@/theme';
import { MAX_WIDTH } from '@/theme/tokens';
import { Icon, type IconName } from './Icon';
import { Txt } from './Txt';

const TABS: Record<string, { icon: IconName; label: 'home' | 'tasks' | 'notifs' | 'me' }> = {
  index: { icon: 'home', label: 'home' },
  tasks: { icon: 'tasks', label: 'tasks' },
  notifs: { icon: 'bell', label: 'notifs' },
  me: { icon: 'user', label: 'me' },
};

const useStyles = makeStyles((c) =>
  StyleSheet.create({
    bar: { backgroundColor: c.card, borderTopWidth: 1, borderTopColor: c.line },
    inner: { flexDirection: 'row', paddingTop: 6, paddingHorizontal: 8, width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center' },
    tab: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: 4 },
    pill: { width: 48, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
    badge: {
      position: 'absolute',
      top: -1,
      left: 33,
      minWidth: 17,
      height: 17,
      borderRadius: 8.5,
      paddingHorizontal: 5,
      backgroundColor: c.bad,
      alignItems: 'center',
      justifyContent: 'center',
    },
  }),
);

/** Bottom navigation from the prototype: four tabs, the active one on a grape pill. */
export function TabBar({ state, navigation, insets, unread = 0 }: BottomTabBarProps & { unread?: number }) {
  const s = useStyles();
  const { c } = useTheme();
  const { t } = useI18n();

  return (
    <View style={[s.bar, { paddingBottom: 18 + insets.bottom }]} role="tablist" aria-label={t.tabs.nav}>
      <View style={s.inner}>
        {state.routes.map((route, index) => {
          const meta = TABS[route.name];
          if (!meta) return null;
          const focused = state.index === index;
          const label = t.tabs[meta.label];
          const onPress = () => {
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
          };
          const showBadge = route.name === 'notifs' && unread > 0;
          return (
            <Pressable
              key={route.key}
              onPress={onPress}
              role="tab"
              aria-selected={focused}
              aria-label={showBadge ? `${label}, ${t.tabs.unread(unread)}` : label}
              style={s.tab}>
              {/* collapsable={false}: Fabric flattens a background-less View away; re-creating it when the
                  background appears loses borderRadius on Android. Keep the native view from the start. */}
              <View collapsable={false} style={[s.pill, { backgroundColor: focused ? c.grapeSoft : 'transparent' }]}>
                <Icon name={meta.icon} color={focused ? c.grapeText : c.muted} />
                {showBadge && (
                  <View style={s.badge}>
                    <Txt v="num" size={10} weight={700} color="onBad" style={{ lineHeight: 17 }}>
                      {unread > 99 ? '99+' : unread}
                    </Txt>
                  </View>
                )}
              </View>
              {/* One line, never broken mid-word: a large system font shrinks the label to fit the tab. */}
              <Txt v="tab" color={focused ? 'grapeText' : 'muted'} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={1.2}>
                {label}
              </Txt>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
