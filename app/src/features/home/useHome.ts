import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import type { HomeData } from '@shared/types';
import { useToast } from '@/components/Toast';
import { useUnread } from '@/features/notifs/useUnread';
import { useI18n } from '@/i18n';
import { errorCode, type ClientErrorCode } from '@/lib/api';
import { useSession } from '@/lib/session';

/**
 * GET /api/home, refetched every time the home tab gains focus (coming back from a project,
 * the wizard or the join screen) and on pull-to-refresh.
 */
export function useHome() {
  const { request } = useSession();
  const { t } = useI18n();
  // show is stable; the object useToast returns is not (it would re-run the focus effect every render).
  const { show: showToast } = useToast();
  // The tab badge is refreshed after every home load; kept in a ref so a new function identity doesn't refetch home.
  const { refresh: refreshUnread } = useUnread();
  const unread = useRef(refreshUnread);
  unread.current = refreshUnread;
  const [data, setData] = useState<HomeData | null>(null);
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
        const next = await request<HomeData>('/home');
        if (id !== latest.current) return;
        hasData.current = true;
        setData(next);
        setError(null);
        unread.current();
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

  /** Update the list right away (e.g. hide an answered invite) before the refetch lands. */
  const patch = useCallback((fn: (d: HomeData) => HomeData) => setData((d) => (d ? fn(d) : d)), []);

  return { data, error, refreshing, refresh, retry, reload: load, patch };
}
