import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { LoginResult, MeData, MeUpdate } from '@shared/types';
import { useToast } from '@/components/Toast';
import { forgetTypedBriefs } from '@/features/wizard/typedBrief';
import { useI18n } from '@/i18n';
import { api, ApiClientError, apiConditional } from './api';
import { applyWrite, queryCache } from './cache';
import type { Conditional, FetchOutcome } from './cacheCore';
import { ME_KEY } from './cacheKeys';
import { isOnline, onReconnect } from './network';
import { clearUserPrefs, readPref, writePref } from './prefs';
import { loadToken, saveToken } from './token';

/** unreachable: a token is saved but the server can't be reached and nothing is cached yet. */
type Status = 'loading' | 'signedOut' | 'signedIn' | 'unreachable';

type SessionValue = {
  status: Status;
  user: MeData | null;
  /** The last signed-in user (stays set during the sign-out transition). */
  lastUser: MeData | null;
  /**
   * Authenticated API call. An UNAUTHENTICATED answer signs the device out (with a 登录已过期 toast), but only
   * when it answered the token in use now: a late 401 for an old token never signs out a newer session.
   */
  request: <T>(path: string, init?: Parameters<typeof api>[1]) => Promise<T>;
  /**
   * A GET through the data cache (lib/cache.ts): answers from the cache when the path was fetched in the
   * last 30 s and nothing changed it since (unless `force`), otherwise asks the server with the cached
   * ETag. Screens read the data with useCached(path). The 401 rule of `request` applies.
   */
  cached: <T>(path: string, opts?: { force?: boolean }) => Promise<FetchOutcome<T>>;
  devSignIn: (userId: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Try the startup check again (from the "can't reach the server" screen). */
  retry: () => void;
  updateMe: (patch: MeUpdate) => Promise<void>;
  refreshMe: () => Promise<void>;
  /** Show a profile a write answered with (M6: saving or deleting the AI key answers with MeData). */
  setMe: (me: MeData) => Promise<void>;
};

const SessionContext = createContext<SessionValue | null>(null);
const USER_CACHE = 'meritai.me';
const STARTUP_TIMEOUT_MS = 8000;
/** Sign-out tells the server, but clears this device after this long even if the server doesn't answer. */
const SIGN_OUT_WAIT_MS = 3000;

function parseCachedUser(raw: string | null): MeData | null {
  if (!raw) return null;
  try {
    const me = JSON.parse(raw) as MeData;
    return me && typeof me === 'object' && typeof me.id === 'string' ? me : null;
  } catch {
    return null; // A corrupt cache must not keep the splash screen up.
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUser] = useState<MeData | null>(null);
  const token = useRef<string | null>(null);
  const { t } = useI18n();
  // show is stable; the object useToast returns is not.
  const { show: showToast } = useToast();
  const expiredText = useRef(t.errors.UNAUTHENTICATED);
  expiredText.current = t.errors.UNAUTHENTICATED;
  // Screens behind the signed-in guard can render once more while signing out; they keep the last user.
  const lastUser = useRef<MeData | null>(null);
  if (user) lastUser.current = user;

  /** Show this user. The data cache is opened for them first (their stored pages loaded), never another's. */
  const setSignedIn = useCallback(async (me: MeData, etag: string | null = null) => {
    if (queryCache.currentOwner !== me.id) {
      if (queryCache.currentOwner) await queryCache.wipe();
      await queryCache.open(me.id);
    }
    queryCache.set(ME_KEY, me, etag);
    setUser(me);
    setStatus('signedIn');
    void writePref(USER_CACHE, JSON.stringify(me));
  }, []);

  /** Signed out (by choice or because the session expired): forget the token and everything kept for the user. */
  const clear = useCallback(async () => {
    token.current = null;
    forgetTypedBriefs();
    // The cache first (memory, and its pending writes), then every other meritai.* key of the user.
    await queryCache.wipe();
    await Promise.all([saveToken(null), clearUserPrefs()]);
    setUser(null);
    setStatus('signedOut');
  }, []);

  /** A 401 for `sent`: sign out only if that is still the session in use, and say why once. */
  const expired = useCallback(
    async (sent: string | null) => {
      if (!sent || token.current !== sent) return;
      showToast(expiredText.current);
      await clear();
    },
    [clear, showToast],
  );

  const request = useCallback(
    async <T,>(path: string, init: Parameters<typeof api>[1] = {}) => {
      const sent = token.current;
      try {
        const result = await api<T>(path, { ...init, token: sent });
        // A write: refresh the cache from its answer and mark what it may have changed (cacheKeys.writeEffect).
        if ((init.method ?? 'GET') !== 'GET' && token.current === sent) applyWrite(path, result);
        return result;
      } catch (err) {
        if (err instanceof ApiClientError && err.code === 'UNAUTHENTICATED') await expired(sent);
        throw err;
      }
    },
    [expired],
  );

  const conditional = useCallback(
    async <T,>(path: string, etag: string | null): Promise<Conditional<T>> => {
      const sent = token.current;
      try {
        return await apiConditional<T>(path, { token: sent, ifNoneMatch: etag });
      } catch (err) {
        if (err instanceof ApiClientError && err.code === 'UNAUTHENTICATED') await expired(sent);
        throw err;
      }
    },
    [expired],
  );

  const cached = useCallback(
    <T,>(path: string, opts?: { force?: boolean }): Promise<FetchOutcome<T>> => {
      // Offline with something to show: keep showing it (a pull still tries, and says 没有网络 if it fails).
      const kept = queryCache.get<T>(path);
      if (!isOnline() && kept && !opts?.force) return Promise.resolve({ data: kept.data, fromNetwork: false });
      return queryCache.fetch<T>(path, (etag) => conditional<T>(path, etag), opts);
    },
    [conditional],
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
      // Signed in before on this device: show the app at once with the cached profile and pages, and
      // check the profile (and the session) with the server behind it (a 304 when nothing changed).
      const known = parseCachedUser(await readPref(USER_CACHE));
      if (cancelled) return;
      if (known) {
        await queryCache.open(known.id);
        if (cancelled) return;
        setUser(queryCache.peek<MeData>(ME_KEY) ?? known);
        setStatus('signedIn');
      }
      try {
        const etag = known ? (queryCache.get<MeData>(ME_KEY)?.etag ?? null) : null;
        const res = await apiConditional<MeData>('/me', { token: saved, signal: ctrl.signal, ifNoneMatch: etag });
        if (cancelled) return;
        if (res.notModified) {
          const me = queryCache.peek<MeData>(ME_KEY);
          if (me) await setSignedIn(me, res.etag ?? etag);
        } else await setSignedIn(res.data, res.etag);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiClientError && err.code === 'UNAUTHENTICATED') return void (await expired(saved));
        // Unreachable or erroring: keep the token and what is cached; with nothing cached, offer a retry.
        if (!known) setStatus('unreachable');
      } finally {
        clearTimeout(timer);
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [attempt, expired, setSignedIn]);

  const retry = useCallback(() => {
    setStatus('loading');
    setAttempt((n) => n + 1);
  }, []);

  const devSignIn = useCallback(
    async (userId: string) => {
      const res = await api<LoginResult>('/dev/login', { method: 'POST', body: { userId } });
      token.current = res.token;
      await saveToken(res.token);
      await setSignedIn(res.user);
    },
    [setSignedIn],
  );

  const signOut = useCallback(async () => {
    try {
      await api('/auth/session', { method: 'DELETE', token: token.current, timeoutMs: SIGN_OUT_WAIT_MS });
    } catch {
      // Offline or too slow: still sign out locally; the server session expires on its own.
    }
    await clear();
  }, [clear]);

  const updateMe = useCallback(
    async (patch: MeUpdate) => {
      if (user) setUser({ ...user, ...patch }); // optimistic
      try {
        await setSignedIn(await request<MeData>('/me', { method: 'PATCH', body: patch }));
      } catch (err) {
        if (user) setUser(user);
        throw err;
      }
    },
    [request, setSignedIn, user],
  );

  const refreshMe = useCallback(async () => {
    const sent = token.current;
    const { data } = await cached<MeData>(ME_KEY, { force: true });
    if (sent && token.current === sent) await setSignedIn(data, queryCache.get<MeData>(ME_KEY)?.etag ?? null);
  }, [cached, setSignedIn]);

  // Back online after being offline: a start that couldn't reach the server tries again; a signed-in app
  // checks the session and profile quietly.
  const statusRef = useRef(status);
  statusRef.current = status;
  useEffect(
    () =>
      onReconnect(() => {
        if (statusRef.current === 'unreachable') retry();
        else if (statusRef.current === 'signedIn') void refreshMe().catch(() => {});
      }),
    [retry, refreshMe],
  );

  const value = useMemo(
    () => ({ status, user, lastUser: lastUser.current, request, cached, devSignIn, signOut, retry, updateMe, refreshMe, setMe: setSignedIn }),
    [status, user, request, cached, devSignIn, signOut, retry, updateMe, refreshMe, setSignedIn],
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

