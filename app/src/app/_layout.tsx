import { DarkTheme, DefaultTheme, Stack, ThemeProvider as NavThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect, useMemo, useRef } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Button } from '@/components/Button';
import { headingLevel } from '@/components/Screen';
import { ToastProvider } from '@/components/Toast';
import { Txt } from '@/components/Txt';
import { UnreadProvider } from '@/features/notifs/useUnread';
import { I18nProvider, useI18n } from '@/i18n';
import { API_URL } from '@/lib/api';
import { SessionProvider, useSession } from '@/lib/session';
import { ThemeProvider, useTheme } from '@/theme';
import { loadWebFonts } from '@/theme/fonts';

void SplashScreen.preventAutoHideAsync().catch(() => {});

/** Shown when a saved login exists but the server can't be reached and nothing is cached yet. */
function Unreachable() {
  const { c } = useTheme();
  const { t } = useI18n();
  const { retry } = useSession();
  return (
    <View style={{ flex: 1, backgroundColor: c.paper, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <View style={{ width: '100%', maxWidth: 420, gap: 12 }}>
        <Txt v="title" role="heading" {...headingLevel(1)}>
          {t.startup.unreachableTitle}
        </Txt>
        <Txt v="text" color="ink2">
          {t.startup.unreachableBody}
        </Txt>
        <Txt v="meta">{API_URL}</Txt>
        <Button title={t.common.retry} block onPress={retry} />
      </View>
    </View>
  );
}

function ThemedApp() {
  const { c, dark } = useTheme();
  const { locale } = useI18n();
  const { status, user, updateMe } = useSession();

  const navTheme = useMemo(() => {
    const base = dark ? DarkTheme : DefaultTheme;
    return { ...base, colors: { ...base.colors, background: c.paper, card: c.card, text: c.ink, border: c.line, primary: c.grape } };
  }, [c, dark]);

  // The Android window behind the app follows the theme, so dark mode never flashes light.
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(c.paper).catch(() => {});
  }, [c.paper]);

  // Keep the splash screen up until we know whether someone is signed in (no login-screen flash).
  useEffect(() => {
    if (status !== 'loading') void SplashScreen.hideAsync().catch(() => {});
  }, [status]);

  // Push notifications use the language chosen on this device. Try once per (user, language);
  // a failure is retried on the next sign-in or language change, never in a loop.
  const synced = useRef<string | null>(null);
  useEffect(() => {
    if (status !== 'signedIn' || !user || user.locale === locale) return;
    const key = `${user.id}:${locale}`;
    if (synced.current === key) return;
    synced.current = key;
    void updateMe({ locale }).catch(() => {});
  }, [status, user, locale, updateMe]);

  if (status === 'loading') return <View style={{ flex: 1, backgroundColor: c.paper }} />;
  if (status === 'unreachable') return <Unreachable />;

  return (
    <NavThemeProvider value={navTheme}>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.paper } }}>
        <Stack.Protected guard={status === 'signedIn'}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="new/index" />
          <Stack.Screen name="new/[id]/index" />
          <Stack.Screen name="new/[id]/basics" />
          <Stack.Screen name="new/[id]/input" />
          <Stack.Screen name="new/[id]/cant-read" />
          <Stack.Screen name="new/[id]/plan" />
          <Stack.Screen name="new/[id]/done" />
          <Stack.Screen name="join/index" />
          <Stack.Screen name="join/[code]" />
          <Stack.Screen name="project/[id]/index" />
          <Stack.Screen name="project/[id]/pick" />
          <Stack.Screen name="project/[id]/settings" />
          <Stack.Screen name="project/[id]/members" />
          <Stack.Screen name="project/[id]/task/[taskId]" />
          <Stack.Screen name="dev/gallery" />
        </Stack.Protected>
        <Stack.Protected guard={status === 'signedOut'}>
          <Stack.Screen name="login" />
        </Stack.Protected>
      </Stack>
    </NavThemeProvider>
  );
}

export default function RootLayout() {
  useEffect(loadWebFonts, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <I18nProvider>
            <ToastProvider>
              <SessionProvider>
                <UnreadProvider>
                  <ThemedApp />
                </UnreadProvider>
              </SessionProvider>
            </ToastProvider>
          </I18nProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
