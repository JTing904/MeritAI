import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import type { DevPerson } from '@shared/types';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { List, Row } from '@/components/Card';
import { Logo } from '@/components/Logo';
import { headingLevel, Screen } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { Txt } from '@/components/Txt';
import { useI18n } from '@/i18n';
import { api, API_URL, ApiClientError, errorCode } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useTheme } from '@/theme';

// Developer one-tap login (dev servers only). The real GitHub / Google login screen replaces it in M10.
export default function LoginScreen() {
  const { t } = useI18n();
  const { c } = useTheme();
  const toast = useToast();
  const { devSignIn } = useSession();
  const [people, setPeople] = useState<DevPerson[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    setPeople(null);
    api<DevPerson[]>('/dev/people')
      .then(setPeople)
      .catch((err) =>
        setError(err instanceof ApiClientError && err.code === 'NOT_FOUND' ? t.login.devUnavailable : t.errors[errorCode(err)]),
      );
  }, [t]);

  useEffect(load, [load]);

  const signIn = async (person: DevPerson) => {
    setBusyId(person.id);
    try {
      await devSignIn(person.id);
    } catch (err) {
      toast.show(t.errors[errorCode(err)]);
      setBusyId(null);
    }
  };

  return (
    <Screen>
      <View style={{ paddingTop: 12 }}>
        <Logo />
      </View>
      <View style={{ gap: 6 }}>
        <Txt v="title" role="heading" {...headingLevel(1)}>
          {t.login.devTitle}
        </Txt>
        <Txt v="meta">{t.login.devHint}</Txt>
      </View>

      {people === null && !error && <ActivityIndicator color={c.grape} />}

      {error && (
        <View style={{ gap: 12 }}>
          <Txt v="text" color="bad">
            {error}
          </Txt>
          <Txt v="meta">{API_URL}</Txt>
          <Button title={t.common.retry} kind="soft" onPress={load} />
        </View>
      )}

      {people && people.length === 0 && <Txt v="text">{t.login.devEmpty}</Txt>}

      {people && people.length > 0 && (
        <List>
          {people.map((p) => (
            <Row
              key={p.id}
              leading={<Avatar name={p.name} hl={p.color} decorative />}
              title={p.name}
              meta={p.email ?? undefined}
              trailing={busyId === p.id ? <ActivityIndicator color={c.grape} aria-label={t.login.signingIn} /> : undefined}
              onPress={() => signIn(p)}
              disabled={!!busyId}
              accessibilityLabel={p.name}
            />
          ))}
        </List>
      )}
    </Screen>
  );
}
