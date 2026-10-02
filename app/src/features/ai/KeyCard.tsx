import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Linking, StyleSheet, View, AppState } from 'react-native';
import { AI_PROVIDERS, AI_REVIEWS_PER_PROJECT_DAY, AI_REVIEWS_PER_TASK_DAY, GEMINI_KEY_URL, type AiProviderName } from '@shared/constants';
import { projectTag } from '@shared/format';
import type { AiKeyInput, HomeData, MeAi, MeData } from '@shared/types';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Chip } from '@/components/Chip';
import { ConfirmSheet } from '@/components/ConfirmSheet';
import { Seg } from '@/components/Controls';
import { useToast } from '@/components/Toast';
import { Txt } from '@/components/Txt';
import { CheckRow, TextLink } from '@/features/task/parts';
import { Field, Hint, Input } from '@/features/wizard/Field';
import { useI18n } from '@/i18n';
import { errorCode } from '@/lib/api';
import { useCached } from '@/lib/cache';
import { HOME_KEY } from '@/lib/cacheKeys';
import { useMe, useSession } from '@/lib/session';
import { dateTimeLabel, relativeTime } from '@/lib/time';
import { useTheme } from '@/theme';
import { maskedKey, resetClock } from './models';
import { ErrCard, ErrList, KeyRow, KeyText, UseBar, WarnBox } from './parts';

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  row2: { flexDirection: 'row', gap: 8 },
});

/** 「你当组长的 2 个项目都用它：CS302、MKT201」 from the home list (null when it isn't loaded or there are none). */
function useLedLine(): string | null {
  const { t } = useI18n();
  const home = useCached<HomeData>(HOME_KEY);
  const led = (home?.projects ?? []).filter((p) => p.role === 'LEADER' && p.status !== 'DRAFT' && p.status !== 'ENDED');
  if (led.length === 0) return null;
  return t.ai.me.ledProjects(led.length, led.map((p) => projectTag(p.name, p.shortCode)).join(t.ai.me.tagSep));
}

/** 「每天下午 3 点左右重置。」 (Gemini) or the time the counts go back to 0. */
export function useResetText() {
  const { t } = useI18n();
  return (provider: AiProviderName | null, resetsAt: string | null | undefined) =>
    provider === 'GEMINI' || !resetsAt ? t.ai.me.resetGemini : t.ai.me.resetAt(resetClock(resetsAt));
}

function CardHead({ chip }: { chip?: { text: string; tone: 'default' | 'good' } }) {
  const { t } = useI18n();
  return (
    <View style={styles.head}>
      <Txt v="body" size={15.5} weight={900}>
        {t.ai.me.title}
      </Txt>
      {chip ? <Chip tone={chip.tone}>{chip.text}</Chip> : null}
    </View>
  );
}

/**
 * The 我 page's AI key card (MeKeyEmpty / MeKeySaved / MeKeyError mockups): the form while no key is saved
 * (or 换一把 was pressed), the saved key with today's usage, or the key's problem.
 */
export function AiKeyCard() {
  const me = useMe();
  const ai = me.ai;
  const { refreshMe } = useSession();
  const [replacing, setReplacing] = useState(false);
  // Today's usage and the key's status move on their own: check the profile each time the page shows (304 when unchanged).
  // On focus, and when the app comes back to the foreground on this page; pull-to-refresh on the page
  // does the rest. No timer: an open page costs no requests.
  useFocusEffect(
    useCallback(() => {
      void refreshMe().catch(() => {});
      const sub = AppState.addEventListener('change', (state) => {
        if (state === 'active') void refreshMe().catch(() => {});
      });
      return () => sub.remove();
    }, [refreshMe]),
  );
  if (!ai || replacing) return <KeyForm replacing={!!ai} onDone={() => setReplacing(false)} />;
  if (ai.status === 'INVALID') return <InvalidCard ai={ai} onReplace={() => setReplacing(true)} />;
  if (ai.status === 'QUOTA') return <QuotaCard ai={ai} onReplace={() => setReplacing(true)} />;
  return <SavedCard ai={ai} onReplace={() => setReplacing(true)} />;
}

function KeyForm({ replacing, onDone }: { replacing: boolean; onDone: () => void }) {
  const { t } = useI18n();
  const m = t.ai.me;
  const { request, setMe } = useSession();
  const { show } = useToast();
  const led = useLedLine();
  const current = useMe().ai?.provider;
  const [provider, setProvider] = useState<AiProviderName>(current ?? 'GEMINI');
  const [key, setKey] = useState('');
  const [adult, setAdult] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const name = t.ai.provider[provider];

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const body: AiKeyInput = { provider, key: key.trim(), adult };
      await setMe(await request<MeData>('/me/ai-key', { method: 'PUT', body }));
      show(m.saved);
      setKey('');
      onDone();
    } catch (err) {
      const code = errorCode(err);
      // The key or the tick is wrong: say it under the field; anything else as a toast.
      if (code === 'AI_KEY_INVALID' || code === 'AI_ADULT_REQUIRED' || code === 'VALIDATION') setError(t.errors[code]);
      else show(t.errors[code]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={{ gap: 12 }}>
      <CardHead chip={replacing ? undefined : { text: m.chipEmpty, tone: 'default' }} />
      {replacing ? null : (
        <Txt v="meta" style={{ marginTop: -4 }}>
          {m.intro}
        </Txt>
      )}
      <Seg<AiProviderName>
        label={m.providers}
        value={provider}
        onChange={(p) => {
          setProvider(p);
          setError(null);
        }}
        options={AI_PROVIDERS.map((p) => ({ value: p, label: t.ai.provider[p], sub: m.providerSub[p] }))}
      />
      <Field label={m.keyLabel(name)} error={error}>
        <Input
          label={m.keyLabel(name)}
          value={key}
          onChangeText={(v) => {
            setKey(v);
            setError(null);
          }}
          placeholder={m.placeholder[provider]}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          importantForAutofill="no"
          spellCheck={false}
          secureTextEntry
          textContentType="password"
          maxLength={300}
          invalid={!!error}
        />
      </Field>
      {provider === 'GEMINI' ? (
        <View style={{ marginTop: -4 }}>
          <TextLink title={m.getKey} onPress={() => void Linking.openURL(GEMINI_KEY_URL).catch(() => show(t.errors.NETWORK))} />
        </View>
      ) : null}
      <WarnBox>⚠️ {m.privacy[provider]}</WarnBox>
      <CheckRow on={adult} onPress={() => setAdult((v) => !v)}>
        {m.adult}
      </CheckRow>
      <Button title={m.save} block loading={busy} disabled={!key.trim() || !adult} onPress={save} />
      {replacing ? <Button title={m.cancelReplace} kind="soft" block onPress={onDone} disabled={busy} /> : null}
      <Hint>{m.onePerAccount(led)}</Hint>
      {replacing ? null : <Hint>{m.withoutKey}</Hint>}
    </Card>
  );
}

function SavedCard({ ai, onReplace }: { ai: MeAi; onReplace: () => void }) {
  const { t } = useI18n();
  const m = t.ai.me;
  const { c } = useTheme();
  const led = useLedLine();
  const reset = useResetText();
  const remove = useDeleteKey();
  const usage = ai.usageToday;
  const ratio = (u: { used: number; limit: number | null }) => (u.limit ? u.used / u.limit : null);

  return (
    <Card style={{ gap: 12 }}>
      <CardHead chip={{ text: m.chipOk, tone: 'good' }} />
      <KeyRow sub={ai.checkedAt ? m.checked(relativeTime(ai.checkedAt, t.labels.relative)) : null}>
        <KeyText provider={t.ai.provider[ai.provider]} masked={maskedKey(ai.provider, ai.last4)} />
      </KeyRow>
      {usage ? (
        <>
          <Txt v="label">{m.usageTitle}</Txt>
          <UseBar label={m.usageGood} count={m.usageCount(usage.good.used, usage.good.limit)} ratio={ratio(usage.good)} />
          <UseBar
            label={m.usageLight}
            count={m.usageCount(usage.light.used, usage.light.limit)}
            ratio={ratio(usage.light)}
            color={c.hl.mint.base}
          />
          <Hint>{`${reset(ai.provider, usage.resetsAt)}${m.chainHint}`}</Hint>
        </>
      ) : null}
      <Hint>{m.limitsHint(AI_REVIEWS_PER_PROJECT_DAY, AI_REVIEWS_PER_TASK_DAY)}</Hint>
      <View style={styles.row2}>
        <Button title={m.replace} kind="soft" block style={{ flex: 1 }} onPress={onReplace} />
        <Button title={m.delete} kind="danger" block style={{ flex: 1 }} onPress={remove.ask} />
      </View>
      <Hint>{m.deleteHint(led)}</Hint>
      {remove.sheet}
    </Card>
  );
}

function InvalidCard({ ai, onReplace }: { ai: MeAi; onReplace: () => void }) {
  const { t } = useI18n();
  const m = t.ai.me;
  const { show } = useToast();
  const remove = useDeleteKey();
  const when = ai.checkedAt ? dateTimeLabel(ai.checkedAt, t.labels.when) : '';
  return (
    <ErrCard tone="bad" title={m.invalidTitle}>
      <KeyRow tint sub={m.invalidCheck(when, t.ai.company[ai.provider])}>
        <KeyText provider={t.ai.provider[ai.provider]} masked={maskedKey(ai.provider, ai.last4)} />
      </KeyRow>
      <ErrList label={m.nowLabel} lines={m.invalidNow} />
      <ErrList label={m.fixLabel} lines={[m.invalidFix[ai.provider]]} />
      <Button title={m.replaceKey} block onPress={onReplace} />
      {ai.provider === 'GEMINI' ? (
        <TextLink title={m.getKeyShort} onPress={() => void Linking.openURL(GEMINI_KEY_URL).catch(() => show(t.errors.NETWORK))} />
      ) : null}
      <View style={{ alignSelf: 'flex-start' }}>
        <TextLink title={m.delete} onPress={remove.ask} />
      </View>
      {remove.sheet}
    </ErrCard>
  );
}

function QuotaCard({ ai, onReplace }: { ai: MeAi; onReplace: () => void }) {
  const { t } = useI18n();
  const m = t.ai.me;
  const usage = ai.usageToday;
  const back = ai.provider === 'GEMINI' || !usage ? m.backGemini : m.backAt(resetClock(usage.resetsAt));
  const good = usage ? m.usageCount(usage.good.used, usage.good.limit) : '';
  return (
    <ErrCard tone="warn" title={m.quotaTitle}>
      <KeyRow tint sub={m.quotaLine(good)}>
        <KeyText provider={t.ai.provider[ai.provider]} masked={maskedKey(ai.provider, ai.last4)} />
      </KeyRow>
      <ErrList label={m.nowLabel} lines={m.quotaNow(back)} />
      <ErrList label={m.whatLabel} lines={m.quotaWhat(t.ai.company[ai.provider])} />
      <Button title={m.replaceKey} kind="soft" block onPress={onReplace} />
    </ErrCard>
  );
}

/** 删除 with its 确定吗 sheet. */
function useDeleteKey() {
  const { t } = useI18n();
  const m = t.ai.me;
  const { request, setMe } = useSession();
  const { show } = useToast();
  const [open, setOpen] = useState(false);
  const sheet = (
    <ConfirmSheet
      visible={open}
      title={m.deleteTitle}
      body={m.deleteBody}
      confirmLabel={m.delete}
      danger
      onClose={() => setOpen(false)}
      onConfirm={async () => {
        try {
          await setMe(await request<MeData>('/me/ai-key', { method: 'DELETE' }));
          show(m.deleted);
        } catch (err) {
          show(t.errors[errorCode(err)]);
        }
      }}
    />
  );
  return { ask: () => setOpen(true), sheet };
}
