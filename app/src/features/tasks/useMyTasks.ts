import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import type { MyTasksView } from '@shared/types';
import { useToast } from '@/components/Toast';
import { useI18n } from '@/i18n';
import { errorCode, type ClientErrorCode } from '@/lib/api';
import { useSession } from '@/lib/session';

/** GET /api/tasks/mine, refetched every time the tab gains focus and on pull-to-refresh (as useHome). */
export function useMyTasks() {
  const { request } = useSession();
  const { t } = useI18n();
  // show is stable; the object useToast returns is not (it would re-run the focus effect every render).
  const { show: showToast } = useToast();
  const [data, setData] = useState<MyTasksView | null>(null);
  const [error, setError] = useState<ClientErrorCode | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Only the newest request may write state (a slow focus fetch must not overwrite a newer pull).
  const latest = useRef(0);
  const hasData = useRef(false);

  const load = useCallback(
    async (pull = false) => {
      const id = ++latest.current;
      if (pull) setRefreshing(true);
      try {
        const next = await request<MyTasksView>('/tasks/mine');
        if (id !== latest.current) return;
        hasData.current = true;
        setData(next);
        setError(null);
      } catch (err) {
        if (id !== latest.current) return;
        // With something already on screen, keep it and only say why the refresh failed.
        if (!hasData.current) setError(errorCode(err));
        else if (pull) showToast(t.errors[errorCode(err)]);
      } finally {
        if (id === latest.current) setRefreshing(false);
      }
    },
    [request, showToast, t],
  );

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const retry = useCallback(() => {
    setError(null);
    void load();
  }, [load]);

  const refresh = useCallback(() => void load(true), [load]);

  return { data, error, refreshing, refresh, retry };
}
