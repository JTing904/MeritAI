import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import type { MyTasksView } from '@shared/types';
import { useToast } from '@/components/Toast';
import { useI18n } from '@/i18n';
import { errorCode, type ClientErrorCode } from '@/lib/api';
import { hasCached, useCached } from '@/lib/cache';
import { MY_TASKS_KEY } from '@/lib/cacheKeys';
import { onReconnect } from '@/lib/network';
import { useSession } from '@/lib/session';

/** GET /api/tasks/mine through the data cache, checked on focus and pull-to-refresh (as useHome). */
export function useMyTasks() {
  const { cached } = useSession();
  const { t } = useI18n();
  // show is stable; the object useToast returns is not (it would re-run the focus effect every render).
  const { show: showToast } = useToast();
  const data = useCached<MyTasksView>(MY_TASKS_KEY);
  const [error, setError] = useState<ClientErrorCode | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Only the newest load may set the error / spinner.
  const latest = useRef(0);

  const load = useCallback(
    async (mode: 'focus' | 'pull' | 'reload') => {
      const id = ++latest.current;
      const pull = mode === 'pull';
      if (pull) setRefreshing(true);
      try {
        await cached<MyTasksView>(MY_TASKS_KEY, { force: mode !== 'focus' });
        if (id !== latest.current) return;
        setError(null);
      } catch (err) {
        if (id !== latest.current) return;
        // With something already on screen, keep it and only say why the refresh failed.
        if (!hasCached(MY_TASKS_KEY)) setError(errorCode(err));
        else if (pull) showToast(t.errors[errorCode(err)]);
      } finally {
        if (id === latest.current) setRefreshing(false);
      }
    },
    [cached, showToast, t],
  );

  useFocusEffect(
    useCallback(() => {
      void load('focus');
      return onReconnect(() => void load('reload'));
    }, [load]),
  );

  const retry = useCallback(() => {
    setError(null);
    void load('reload');
  }, [load]);

  const refresh = useCallback(() => void load('pull'), [load]);

  return { data, error: data ? null : error, refreshing, refresh, retry };
}
