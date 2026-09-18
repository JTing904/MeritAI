import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { LoginResult, MeData, MeUpdate } from '@shared/types';
import { api, ApiClientError } from './api';
import { readPref, writePref } from './prefs';
import { loadToken, saveToken } from './token';

/** unreachable: a token is saved but the server can't be reached and nothing is cached yet. */
type Status = 'loading' | 'signedOut' | 'signedIn' | 'unreachable';

type SessionValue = {
  status: Status;
  user: MeData | null;
  /** The last signed-in user (stays set during the sign-out transition). */
  lastUser: MeData | null;
  /** Authenticated API call. An UNAUTHENTICATED answer signs the device out. */
  request: <T>(path: string, init?: Parameters<typeof api>[1]) => Promise<T>;
  devSignIn: (userId: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Try the startup check again (from the "can't reach the server" screen). */
  retry: () => void;
  updateMe: (patch: MeUpdate) => Promise<void>;
  refreshMe: () => Promise<void>;
};

const SessionContext = createContext<SessionValue | null>(null);
const USER_CACHE = 'meritai.me';
const STARTUP_TIMEOUT_MS = 8000;

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUser] = useState<MeData | null>(null);
  const token = useRef<string | null>(null);
  // Screens behind the signed-in guard can render once more while signing out; they keep the last user.
  const lastUser = useRef<MeData | null>(null);
  if (user) lastUser.current = user;

  const setSignedIn = useCallback((me: MeData) => {
    setUser(me);
    setStatus('signedIn');
    void writePref(USER_CACHE, JSON.stringify(me));
  }, []);

  const clear = useCallback(async () => {
    token.current = null;
    await Promise.all([saveToken(null), writePref(USER_CACHE, null)]);
    setUser(null);
    setStatus('signedOut');
  }, []);

  const request = useCallback(
    async <T,>(path: string, init: Parameters<typeof api>[1] = {}) => {
      try {
        return await api<T>(path, { ...init, token: token.current });
      } catch (err) {
        if (err instanceof ApiClientError && err.code === 'UNAUTHENTICATED') await clear();
        throw err;
      }
    },
    [clear],
  );

  // Startup: restore the saved token. Only an UNAUTHENTICATED answer signs the device out; if the server
  // is unreachable or erroring, keep the token and use the cached profile (or offer a retry).
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), STARTUP_TIMEOUT_MS);
    (async () => {
      const saved = await loadToken();
      if (!saved) return !cancelled && setStatus('signedOut');
      token.current = saved;
      try {
        const me = await api<MeData>('/me', { token: saved, signal: ctrl.signal });
        if (!cancelled) setSignedIn(me);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiClientError && err.code === 'UNAUTHENTICATED') return void (await clear());
        const cached = await readPref(USER_CACHE);
        if (cancelled) return;
        if (cached) {
          setUser(JSON.parse(cached) as MeData);
          setStatus('signedIn');
        } else setStatus('unreachable');
      } finally {
        clearTimeout(timer);
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [attempt, clear, setSignedIn]);

  const retry = useCallback(() => {
    setStatus('loading');
    setAttempt((n) => n + 1);
  }, []);

  const devSignIn = useCallback(
    async (userId: string) => {
      const res = await api<LoginResult>('/dev/login', { method: 'POST', body: { userId } });
      token.current = res.token;
      await saveToken(res.token);
      setSignedIn(res.user);
    },
    [setSignedIn],
  );

  const signOut = useCallback(async () => {
    try {
      await api('/auth/session', { method: 'DELETE', token: token.current });
    } catch {
      // Offline: still sign out locally; the server session expires on its own.
    }
    await clear();
  }, [clear]);

  const updateMe = useCallback(
    async (patch: MeUpdate) => {
      if (user) setUser({ ...user, ...patch }); // optimistic
      try {
        setSignedIn(await request<MeData>('/me', { method: 'PATCH', body: patch }));
      } catch (err) {
        if (user) setUser(user);
        throw err;
      }
    },
    [request, setSignedIn, user],
  );

  const refreshMe = useCallback(async () => setSignedIn(await request<MeData>('/me')), [request, setSignedIn]);

  const value = useMemo(
    () => ({ status, user, lastUser: lastUser.current, request, devSignIn, signOut, retry, updateMe, refreshMe }),
    [status, user, request, devSignIn, signOut, retry, updateMe, refreshMe],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}

/** The signed-in user; only use inside screens behind the signed-in guard. */
export function useMe(): MeData {
  const { user, lastUser } = useSession();
  const me = user ?? lastUser;
  if (!me) throw new Error('useMe used before anyone signed in');
  return me;
}

