import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';
import type { UnreadCount } from '@shared/types';
import { queryCache } from '@/lib/cache';
import { UNREAD_KEY } from '@/lib/cacheKeys';
import { isOnline, onReconnect } from '@/lib/network';
import { useSession } from '@/lib/session';

export type UnreadState = {
  /** Unread notifications (the 通知 tab badge). */
  count: number;
  /** Fetch the count again (after home loads, …); skipped when it was fetched in the last 30 s. */
  refresh: () => void;
  /** A response that already carries the count (the notification list, marking read): use it, no extra request. */
  report: (count: number) => void;
};

const NONE: UnreadState = { count: 0, refresh() {}, report() {} };

/** How often the badge is refreshed while the app is in use (REQUIREMENTS §13: every 5 minutes). */
const POLL_MS = 5 * 60_000;
/** A count this fresh is good enough: refresh() does nothing. */
const FRESH_MS = 30_000;
/** Web: no pointer or key activity for this long counts as away; polling pauses until the next activity. */
const IDLE_MS = 10 * 60_000;

const UnreadContext = createContext<UnreadState>(NONE);

/**
 * Keeps the unread count for the tab badge. Mounted once in the root layout, inside SessionProvider.
 * Fetched when someone signs in, every 5 minutes while the app is in the foreground (on the web: the tab is
 * visible and someone used it in the last 10 minutes), when it comes back, and whenever a screen calls
 * refresh(). Responses that already carry the count report() it instead. The last count is kept in the
 * data cache (shown on the next start at once) and each fetch sends its ETag, so an unchanged count is a 304.
 */
export function UnreadProvider({ children }: { children: ReactNode }) {
  const { status, user, cached } = useSession();
  const [count, setCount] = useState(() => queryCache.peek<UnreadCount>(UNREAD_KEY)?.count ?? 0);
  const userId = status === 'signedIn' ? (user?.id ?? null) : null;
  // Only the newest answer may set the count (a slow poll must not undo a newer refresh or report).
  const latest = useRef(0);
  // When the count was last fetched or reported (0: never, or the last fetch failed).
  const fetchedAt = useRef(0);

  // Signed out, or someone else signed in: the old count is not theirs. Reset while rendering, so the
  // screens' first refresh() (their effects run before this provider's) already counts for the new user.
  const [owner, setOwner] = useState(userId);
  if (owner !== userId) {
    setOwner(userId);
    // The session opened the cache for the new user before showing them: this is their last count.
    setCount(userId ? (queryCache.peek<UnreadCount>(UNREAD_KEY)?.count ?? 0) : 0);
    latest.current++;
    fetchedAt.current = 0;
  }

  const fetchCount = useCallback(
    (force: boolean) => {
      if (!userId || !isOnline()) return; // offline: the next poll or coming back online asks
      if (!force && Date.now() - fetchedAt.current < FRESH_MS) return;
      const id = ++latest.current;
      fetchedAt.current = Date.now(); // also keeps a burst of refresh() calls to one request
      cached<UnreadCount>(UNREAD_KEY, { force: true }).then(
        ({ data }) => {
          if (id === latest.current) setCount(data.count);
        },
        // Offline or a server hiccup: keep the last count; the next poll tries again.
        () => {
          if (id === latest.current) fetchedAt.current = 0;
        },
      );
    },
    [userId, cached],
  );

  const refresh = useCallback(() => fetchCount(false), [fetchCount]);

  const report = useCallback(
    (n: number) => {
      if (!userId) return;
      ++latest.current;
      fetchedAt.current = Date.now();
      setCount(n);
      if (queryCache.peek<UnreadCount>(UNREAD_KEY)?.count !== n) queryCache.set<UnreadCount>(UNREAD_KEY, { count: n });
    },
    [userId],
  );

  useEffect(() => {
    if (!userId) return;

    const web = Platform.OS === 'web' && typeof document !== 'undefined';
    let lastActivity = Date.now();
    const idle = () => web && Date.now() - lastActivity >= IDLE_MS;
    const visible = () => AppState.currentState === 'active' && !(web && document.visibilityState === 'hidden');

    let timer: ReturnType<typeof setInterval> | null = null;
    const tick = () => {
      if (visible() && !idle()) fetchCount(true);
    };
    const start = () => {
      if (!timer) timer = setInterval(tick, POLL_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const resume = () => {
      lastActivity = Date.now();
      fetchCount(false);
      start();
    };

    fetchCount(false);
    if (visible()) start();
    const offReconnect = onReconnect(() => fetchCount(true));
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') resume();
      else stop();
    });

    // Web: a hidden tab or an idle one doesn't poll; coming back fetches right away (unless it's fresh).
    const onVisibility = () => (document.visibilityState === 'hidden' ? stop() : resume());
    const onActivity = () => {
      const wasIdle = idle();
      lastActivity = Date.now();
      if (wasIdle && visible()) resume();
    };
    const activityEvents = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    if (web) {
      document.addEventListener('visibilitychange', onVisibility);
      activityEvents.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    }

    return () => {
      stop();
      sub.remove();
      offReconnect();
      if (web) {
        document.removeEventListener('visibilitychange', onVisibility);
        activityEvents.forEach((e) => window.removeEventListener(e, onActivity));
      }
    };
  }, [userId, fetchCount]);

  const value = useMemo(() => ({ count, refresh, report }), [count, refresh, report]);
  return <UnreadContext.Provider value={value}>{children}</UnreadContext.Provider>;
}

/** The unread count; `{ count: 0, refresh() {}, report() {} }` outside the provider. */
export function useUnread(): UnreadState {
  return useContext(UnreadContext);
}
