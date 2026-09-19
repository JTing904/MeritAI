import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import type { DraftView } from '@shared/types';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { useToast } from '@/components/Toast';
import { Txt } from '@/components/Txt';
import { useI18n } from '@/i18n';
import { errorCode, type ClientErrorCode } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useTheme } from '@/theme';
import { projectHref } from './nav';
import { leaveWizard, WizardScreen } from './WizardScreen';

/**
 * Loads a draft for a wizard step and remembers that step for 继续编辑 (draftStep; null = don't).
 * A project that is no longer a draft opens its project page; a missing one returns home.
 */
export function useDraft(id: string, step: number | null) {
  const { request } = useSession();
  const { t } = useI18n();
  // useToast() returns a new object each render; its show() is stable.
  const { show } = useToast();
  const [draft, setDraft] = useState<DraftView | null>(null);
  const [error, setError] = useState<ClientErrorCode | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      const d = await request<DraftView>(`/projects/${id}/draft`);
      if (!alive.current) return;
      setDraft(d);
      if (step !== null && d.basics.draftStep !== step) {
        request<DraftView>(`/projects/${id}`, { method: 'PATCH', body: { draftStep: step } })
          .then(() => alive.current && setDraft((prev) => prev && { ...prev, basics: { ...prev.basics, draftStep: step } }))
          .catch(() => {});
      }
    } catch (err) {
      if (!alive.current) return;
      const code = errorCode(err);
      if (code === 'NOT_A_DRAFT') return router.replace(projectHref(id));
      if (code === 'NOT_FOUND' || code === 'FORBIDDEN') {
        show(t.errors[code]);
        return leaveWizard();
      }
      setError(code);
    }
  }, [id, step, request, t, show]);

  useEffect(() => {
    void load();
  }, [load]);

  return { draft, setDraft, error, reload: load };
}

/** Wizard frame while a draft loads, or the error with a retry. */
export function DraftLoading({ step, error, onRetry }: { step: number; error: ClientErrorCode | null; onRetry: () => void }) {
  const { c } = useTheme();
  const { t } = useI18n();
  return (
    <WizardScreen step={step} onClose={leaveWizard}>
      {error ? (
        <Card style={{ gap: 10 }}>
          <Txt v="rowTitle">{t.wizard.loadFailed}</Txt>
          <Txt v="small" color="ink2">
            {t.errors[error]}
          </Txt>
          <Button title={t.common.retry} kind="soft" block onPress={onRetry} />
        </Card>
      ) : (
        <View style={{ paddingVertical: 48, alignItems: 'center' }}>
          <ActivityIndicator color={c.grape} />
        </View>
      )}
    </WizardScreen>
  );
}
