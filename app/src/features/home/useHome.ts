import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import type { HomeData } from '@shared/types';
import { useToast } from '@/components/Toast';
import { useUnread } from '@/features/notifs/useUnread';
import { useI18n } from '@/i18n';
import { errorCode, type ClientErrorCode } from '@/lib/api';
import { hasCached, queryCache, useCached } from '@/lib/cache';
import { HOME_KEY } from '@/lib/cacheKeys';
import { onReconnect } from '@/lib/network';
import { useSession } from '@/lib/session';

/**
 * GET /api/home through the data cache: the last copy shows at once, and it is checked with the server
 * when the tab gains focus (skipped within 30 s of the last check unless a write changed something), on
 * pull-to-refresh and after the screen's own writes (always).
 */
export function useHome() {
  const { cached } = useSession();
  const { t } = useI18n();
  // show is stable; the object useToast returns is not (it would re-run the focus effect every render).
  const { show: showToast } = useToast();
  // The tab badge is refreshed after every home load; kept in a ref so a new function identity doesn't refetch home.
  const { refresh: refreshUnread } = useUnread();
  const unread = useRef(refreshUnread);
  unread.current = refreshUnread;
  const data = useCached<HomeData>(HOME_KEY);
  const [error, setError] = useState<ClientErrorCode | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Only the newest load may set the error / spinner (the cache itself keeps writes ahead of slow loads).
  const latest = useRef(0);

  const load = useCallback(
    async (mode: 'focus' | 'pull' | 'reload' = 'reload') => {
      const id = ++latest.current;
      const pull = mode === 'pull';
      if (pull) setRefreshing(true);
      try {
        await cached<HomeData>(HOME_KEY, { force: mode !== 'focus' });
        if (id !== latest.current) return;
        setError(null);
        unread.current();
      } catch (err) {
        if (id !== latest.current) return;
        // With something already on screen, keep it and only say why the refresh failed.
        if (!hasCached(HOME_KEY)) setError(errorCode(err));
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
  const reload = useCallback(() => load('reload'), [load]);

  /** Update the list right away (e.g. hide an answered invite) before the refetch lands. */
  const patch = useCallback((fn: (d: HomeData) => HomeData) => queryCache.update<HomeData>(HOME_KEY, fn), []);

  return { data, error: data ? null : error, refreshing, refresh, retry, reload, patch };
}
