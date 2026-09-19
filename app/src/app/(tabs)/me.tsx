import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { HealthData } from '@shared/api';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { List, SectionHeader } from '@/components/Card';
import { Chip } from '@/components/Chip';
import { ConfirmSheet } from '@/components/ConfirmSheet';
import { Seg, Toggle } from '@/components/Controls';
import { Icon } from '@/components/Icon';
import { PageTitle, Screen } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { Txt } from '@/components/Txt';
import { useI18n, type Locale } from '@/i18n';
import { api, API_URL, errorCode } from '@/lib/api';
import { useMe, useSession } from '@/lib/session';
import { useTheme, type ThemeMode } from '@/theme';

type ServerState = 'checking' | 'ok' | 'dbDown' | 'down';

function useServerHealth() {
  const [state, setState] = useState<ServerState>('checking');
  const check = useCallback(() => {
    setState('checking');
    api<HealthData>('/health')
      .then((h) => setState(h.db ? 'ok' : 'dbDown'))
      .catch(() => setState('down'));
  }, []);
  // Only the developer tools show it: release builds don't spend a request on it.
  useEffect(() => {
    if (__DEV__) check();
  }, [check]);
  return { state, check };
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 14 },
  col: { paddingVertical: 13, paddingHorizontal: 14, gap: 8 },
  grow: { flex: 1, minWidth: 0, gap: 1 },
});

export default function MeScreen() {
  const { t, locale, setLocale } = useI18n();
  const { c, mode, setMode } = useTheme();
  const me = useMe();
  const { updateMe, signOut } = useSession();
  const toast = useToast();
  const server = useServerHealth();
  const [confirmOut, setConfirmOut] = useState(false);

  const setSwitch = (patch: { pushEnabled?: boolean; weeklyEnabled?: boolean }) =>
    updateMe(patch).catch((err) => toast.show(t.errors[errorCode(err)]));

  const serverChip = {
    checking: <Chip>{t.me.serverChecking}</Chip>,
    ok: <Chip tone="good">{t.me.serverOk}</Chip>,
    dbDown: <Chip tone="warn">{t.me.serverDbDown}</Chip>,
    down: <Chip tone="bad">{t.me.serverDown}</Chip>,
  }[server.state];

  return (
    <Screen bottomInset={false}>
      <PageTitle>{t.me.title}</PageTitle>

      <View style={styles.head}>
        <Avatar name={me.name} hl={me.color} size="lg" decorative />
        <View style={styles.grow}>
          <Txt v="meName">{me.name}</Txt>
          {me.email && (
            <Txt v="meta" size={13} numberOfLines={1}>
              {me.email}
            </Txt>
          )}
        </View>
      </View>

      <List>
        <View style={styles.col}>
          <Txt v="text">{t.me.appearance}</Txt>
          <Seg<ThemeMode>
            label={t.me.appearance}
            value={mode}
            onChange={setMode}
            options={[
              { value: 'system', label: t.me.themeSystem },
              { value: 'light', label: t.me.themeLight },
              { value: 'dark', label: t.me.themeDark },
            ]}
          />
        </View>
        <View style={styles.col}>
          <Txt v="text">{t.me.language}</Txt>
          <Seg<Locale>
            label={t.me.language}
            value={locale}
            onChange={setLocale}
            options={[
              { value: 'zh', label: '中文' },
              { value: 'en', label: 'English' },
            ]}
          />
        </View>
        <View style={styles.row}>
          <View style={styles.grow}>
            <Txt v="text">{t.me.push}</Txt>
            <Txt v="meta" size={12}>
              {t.me.pushSub}
            </Txt>
          </View>
          <Toggle label={t.me.push} value={me.pushEnabled} onChange={(v) => setSwitch({ pushEnabled: v })} />
        </View>
        <View style={styles.row}>
          <View style={styles.grow}>
            <Txt v="text">{t.me.weekly}</Txt>
            <Txt v="meta" size={12}>
              {t.me.weeklySub}
            </Txt>
          </View>
          <Toggle label={t.me.weekly} value={me.weeklyEnabled} onChange={(v) => setSwitch({ weeklyEnabled: v })} />
        </View>
      </List>

      <Button title={t.me.signOut} kind="danger" block onPress={() => setConfirmOut(true)} />

      {__DEV__ ? (
        <>
          <SectionHeader title={t.me.devTools} />
          <List>
            <Pressable onPress={server.check} role="button" accessibilityHint={t.common.retry} style={styles.row}>
              <View style={styles.grow}>
                <Txt v="text">{t.me.server}</Txt>
                <Txt v="meta" size={12} numberOfLines={1}>
                  {API_URL}
                </Txt>
              </View>
              {serverChip}
            </Pressable>
            <Pressable onPress={() => router.push('/dev/gallery')} role="button" style={styles.row}>
              <Txt v="text" style={{ flex: 1 }}>
                {t.me.gallery}
              </Txt>
              <Icon name="chevron" size={18} color={c.muted} />
            </Pressable>
          </List>
        </>
      ) : null}

      <Txt v="meta" center>
        {t.me.version(Constants.expoConfig?.version ?? '?')}
      </Txt>

      <ConfirmSheet
        visible={confirmOut}
        title={t.me.signOutTitle}
        body={t.me.signOutBody}
        confirmLabel={t.me.signOut}
        danger
        onConfirm={signOut}
        onClose={() => setConfirmOut(false)}
      />
    </Screen>
  );
}
