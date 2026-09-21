import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import type { NotificationPage, NotificationView, UnreadCount } from '@shared/types';
import { useToast } from '@/components/Toast';
import { useI18n } from '@/i18n';
import { errorCode, type ClientErrorCode } from '@/lib/api';
import { queryCache } from '@/lib/cache';
import { onReconnect } from '@/lib/network';
import { useSession } from '@/lib/session';
import { useUnread } from './useUnread';

/** 全部 / 跟我有关 (mine=1). */
export type NotifFilter = 'all' | 'mine';

const PAGE_SIZE = 30;

type List = { filter: NotifFilter; items: NotificationView[]; nextCursor: string | null };

function listPath(filter: NotifFilter, cursor: string | null) {
  let path = `/notifications?limit=${PAGE_SIZE}`;
  if (cursor) path += `&cursor=${encodeURIComponent(cursor)}`;
  if (filter === 'mine') path += '&mine=1';
  return path;
}

/**
 * The 通知 tab's list. Every time the tab gains focus (a new visit) it shows the cached first page and
 * checks it with the server (the data cache's rules; always when the badge counts a different number of
 * unread), marks everything up to its first item read (POST /notifications/read), then refreshes the
 * badge. Items that were unread keep their dot until the next visit. Later pages are not cached.
 */
export function useNotifications() {
  const { request, cached } = useSession();
  const { count: badgeCount, refresh: refreshBadge, report: reportBadge } = useUnread();
  const badge = useRef(badgeCount);
  badge.current = badgeCount;
  const { t } = useI18n();
  // show is stable; the object useToast returns is not (it would re-run the focus effect every render).
  const { show: showToast } = useToast();
  const [filter, setFilterState] = useState<NotifFilter>('all');
  const [list, setListState] = useState<List | null>(() => {
    const page = queryCache.peek<NotificationPage>(listPath('all', null));
    return page ? { filter: 'all', items: page.items, nextCursor: page.nextCursor } : null;
  });
  const [error, setError] = useState<ClientErrorCode | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);

  const filterRef = useRef(filter);
  const listRef = useRef(list);
  const setList = (next: List | null) => {
    listRef.current = next;
    setListState(next);
  };
  // Only the newest first-page load may write state (a slow focus load must not overwrite a newer pull).
  const latest = useRef(0);
  const firstLoading = useRef(false);
  const moreLoading = useRef(false);
  // Set as soon as a page fails (before the re-render drops Screen.onEndReached): until 再试一次 or a new
  // first page, a late content-size check must not send the same page again.
  const moreFailedRef = useRef(false);
  // Ids shown unread during this visit: they keep their dot after being marked read.
  const visit = useRef(new Set<string>());
  // Unread items are always the newest ones (marking read goes up to a position in the list), so the
  // first `unreadCount` items of the full list were unread when the page loaded, even those on later
  // pages that arrive already marked read. 0 for 跟我有关, where positions differ.
  const unreadPrefix = useRef(0);

  const remember = (items: NotificationView[], offset: number) => {
    items.forEach((item, i) => {
      if (!item.read || offset + i < unreadPrefix.current) visit.current.add(item.id);
    });
  };

  const markRead = useCallback(
    async (which: NotifFilter, upToId: string) => {
      try {
        // The answer is the unread count left: the badge takes it without asking again.
        const left = await request<UnreadCount>('/notifications/read', { method: 'POST', body: { upToId } });
        reportBadge(left.count);
        // The cached first page is read now too (everything up to its first item); the other filter's
        // page has read rows as well: check it next time.
        const key = listPath(which, null);
        queryCache.update<NotificationPage>(key, (page) => ({
          ...page,
          unreadCount: left.count,
          items: page.items.map((item) => (item.read ? item : { ...item, read: true })),
        }));
        queryCache.markStale((k) => k.startsWith('/notifications?') && k !== key);
      } catch {
        // Not fatal: the items stay unread and the next visit tries again.
        refreshBadge();
      }
    },
    [request, refreshBadge, reportBadge],
  );

  const show = (which: NotifFilter, page: NotificationPage) => {
    unreadPrefix.current = which === 'all' ? page.unreadCount : 0;
    remember(page.items, 0);
    setList({ filter: which, items: page.items, nextCursor: page.nextCursor });
  };

  const loadFirst = useCallback(
    async (which: NotifFilter, force = false, pull = false) => {
      const id = ++latest.current;
      const key = listPath(which, null);
      firstLoading.current = true;
      if (pull) setRefreshing(true);
      // The copy from the last visit shows at once.
      const kept = queryCache.peek<NotificationPage>(key);
      if (kept && listRef.current?.filter !== which) show(which, kept);
      // The badge counts unread rows the cached page doesn't have: something new arrived.
      const behind = which === 'all' && kept !== undefined && kept.unreadCount !== badge.current;
      try {
        const { data: page, fromNetwork } = await cached<NotificationPage>(key, { force: force || pull || behind });
        if (id !== latest.current) return;
        if (fromNetwork) reportBadge(page.unreadCount); // every unread row, whichever filter
        show(which, page);
        setError(null);
        moreFailedRef.current = false;
        setMoreFailed(false);
        const first = page.items[0];
        if (first && page.items.some((item) => !item.read)) void markRead(which, first.id);
      } catch (err) {
        if (id !== latest.current) return;
        // With something already on screen, keep it and only say why the refresh failed.
        if (!listRef.current) setError(errorCode(err));
        else if (pull) showToast(t.errors[errorCode(err)]);
      } finally {
        if (id === latest.current) {
          firstLoading.current = false;
          setRefreshing(false);
        }
      }
    },
    // show, remember and setList only touch refs and a state setter, so they are left out.
    [cached, markRead, reportBadge, showToast, t],
  );

  useFocusEffect(
    useCallback(() => {
      visit.current = new Set();
      void loadFirst(filterRef.current);
      return onReconnect(() => void loadFirst(filterRef.current, true));
    }, [loadFirst]),
  );

  const setFilter = useCallback(
    (next: NotifFilter) => {
      if (next === filterRef.current) return;
      filterRef.current = next;
      setFilterState(next);
      setList(null);
      setError(null);
      moreFailedRef.current = false;
      setMoreFailed(false);
      void loadFirst(next);
    },
    [loadFirst],
  );

  /** Next page (Screen.onEndReached). After a failed page only retryMore (再试一次) loads again. */
  const loadMore = useCallback(async () => {
    const current = listRef.current;
    if (!current?.nextCursor || firstLoading.current || moreLoading.current || moreFailedRef.current) return;
    moreLoading.current = true;
    setLoadingMore(true);
    setMoreFailed(false);
    try {
      const page = await request<NotificationPage>(listPath(current.filter, current.nextCursor));
      // A first-page load replaced the list meanwhile: this page belongs to the old one.
      if (listRef.current !== current) return;
      remember(page.items, current.items.length);
      const known = new Set(current.items.map((item) => item.id));
      setList({
        ...current,
        items: [...current.items, ...page.items.filter((item) => !known.has(item.id))],
        nextCursor: page.nextCursor,
      });
    } catch (err) {
      if (listRef.current !== current) return;
      moreFailedRef.current = true;
      setMoreFailed(true);
      showToast(t.errors[errorCode(err)]);
    } finally {
      moreLoading.current = false;
      setLoadingMore(false);
    }
  }, [request, showToast, t]);

  /** 再试一次 under the list after a failed page. */
  const retryMore = useCallback(() => {
    moreFailedRef.current = false;
    void loadMore();
  }, [loadMore]);

  const refresh = useCallback(() => void loadFirst(filterRef.current, true, true), [loadFirst]);
  /** Load the first page again without the pull spinner (after answering a swap). */
  const reload = useCallback(() => loadFirst(filterRef.current, true), [loadFirst]);
  const retry = useCallback(() => {
    setError(null);
    void loadFirst(filterRef.current, true);
  }, [loadFirst]);

  /** Show the grape dot: unread now, or unread when this visit began. */
  const isUnread = (item: NotificationView) => !item.read || visit.current.has(item.id);

  return {
    filter,
    setFilter,
    items: list?.items ?? null,
    hasMore: !!list?.nextCursor,
    error,
    refreshing,
    loadingMore,
    moreFailed,
    refresh,
    reload,
    retry,
    loadMore,
    retryMore,
    isUnread,
  };
}
