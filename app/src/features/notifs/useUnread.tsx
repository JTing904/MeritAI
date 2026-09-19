import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import type { UnreadCount } from '@shared/types';
import { useSession } from '@/lib/session';

export type UnreadState = {
  /** Unread notifications (the 通知 tab badge). */
  count: number;
  /** Fetch the count again (after home loads, after marking read, …). */
  refresh: () => void;
};

const NONE: UnreadState = { count: 0, refresh() {} };

/** How often the badge is refreshed while the app is in the foreground. */
const POLL_MS = 60_000;

const UnreadContext = createContext<UnreadState>(NONE);

/**
 * Keeps the unread count for the tab badge. Mounted once in the root layout, inside SessionProvider.
 * Fetched when someone signs in, every 60 s while the app is in the foreground, when it comes back to
 * the foreground, and whenever a screen calls refresh().
 */
export function UnreadProvider({ children }: { children: ReactNode }) {
  const { status, user, request } = useSession();
  const [count, setCount] = useState(0);
  const userId = status === 'signedIn' ? (user?.id ?? null) : null;
  // Only the newest answer may set the count (a slow poll must not undo a newer refresh).
  const latest = useRef(0);

  const refresh = useCallback(() => {
    if (!userId) return;
    const id = ++latest.current;
    request<UnreadCount>('/notifications/unread-count').then(
      (res) => {
        if (id === latest.current) setCount(res.count);
      },
      // Offline or a server hiccup: keep the last count; the next poll tries again.
      () => {},
    );
  }, [userId, request]);

  useEffect(() => {
    // Signed out, or someone else signed in: the old count is not theirs.
    latest.current++;
    setCount(0);
    if (!userId) return;

    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (!timer) timer = setInterval(refresh, POLL_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };

    refresh();
    if (AppState.currentState !== 'background') start();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        refresh();
        start();
      } else if (state === 'background') stop();
    });
    return () => {
      stop();
      sub.remove();
    };
  }, [userId, refresh]);

  const value = useMemo(() => ({ count, refresh }), [count, refresh]);
  return <UnreadContext.Provider value={value}>{children}</UnreadContext.Provider>;
}

/** The unread count; `{ count: 0, refresh() {} }` outside the provider. */
export function useUnread(): UnreadState {
  return useContext(UnreadContext);
}
