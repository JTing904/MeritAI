import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import type { ProjectView } from '@shared/types';
import { useToast } from '@/components/Toast';
import { useI18n } from '@/i18n';
import { ApiClientError, errorCode, type ClientErrorCode } from '@/lib/api';
import { applyWrite, hasCached, queryCache, useCached } from '@/lib/cache';
import { HOME_KEY, MY_TASKS_KEY, projectKey, underProject } from '@/lib/cacheKeys';
import { onReconnect } from '@/lib/network';
import { useSession } from '@/lib/session';

export type ProjectState = {
  /** Null until there is something to show (the cached copy, or the first load). */
  project: ProjectView | null;
  /** Why the first load failed (null while loading and once something is shown): show it with 再试一次. */
  error: ClientErrorCode | null;
  /** Fetches the project again (always asks the server; focus uses the cache's 30 s rule). */
  reload: () => Promise<void>;
  /** Shows the view a write returned (every M3 write answers with the fresh ProjectView). */
  setProject: (view: ProjectView) => void;
  /**
   * For a failed write: toasts the error; a 409, FORBIDDEN or NOT_FOUND also reloads (someone changed
   * things). Only when that reload finds the project gone (or the viewer no longer in it) does it go home.
   */
  onError: (err: unknown) => void;
};

/**
 * The project, or the viewer, is gone (404) or no longer allowed (403): forget everything cached under it,
 * and home / 我的任务 must be checked again.
 */
export function forgetProject(id: string) {
  queryCache.drop(underProject(id));
  queryCache.markStale((k) => k === HOME_KEY || k === MY_TASKS_KEY);
}

/**
 * GET /api/projects/:id for the project screens (project page, pick, settings, members, task), through the
 * data cache: every screen of the same project shares one copy, the last one shows at once, and it is
 * checked with the server on focus (within 30 s only when a write changed something).
 */
export function useProject(id: string): ProjectState {
  const { cached } = useSession();
  const { t } = useI18n();
  // show is stable; the object useToast returns is not.
  const { show: showToast } = useToast();
  const key = projectKey(id);
  const cachedView = useCached<ProjectView>(key);
  const [error, setError] = useState<ClientErrorCode | null>(null);
  // Leaving or deleting the project drops it from the cache just before the screen closes: keep showing
  // the last view meanwhile (not after a 404/403, which shows the error).
  const last = useRef<{ key: string; view: ProjectView } | null>(null);
  if (cachedView) last.current = { key, view: cachedView };
  const project = cachedView ?? (!error && last.current?.key === key ? last.current.view : null);

  // quiet: the caller already toasted NOT_FOUND (one failure, one toast). The cache keeps a slow load
  // from undoing a write that answered meanwhile.
  const load = useCallback(
    async (quiet: boolean, force: boolean) => {
      const had = hasCached(key);
      if (!had) setError(null);
      try {
        await cached<ProjectView>(key, { force });
        setError(null);
      } catch (err) {
        const code = errorCode(err);
        if (code === 'NOT_FOUND' || code === 'FORBIDDEN') {
          // Removed from the project (or it was deleted): nothing of it may stay on this device.
          forgetProject(id);
          // Going home keeps the last view on screen for the transition; otherwise say why it's gone.
          if (!had || code !== 'NOT_FOUND') setError(code);
          else {
            if (!quiet) showToast(t.errors.NOT_FOUND);
            // Pop back to the home already in the stack (replace would leave the dead project screens under it).
            router.dismissTo('/');
          }
        } else if (!had) setError(code);
        // Otherwise keep what is on screen; the next focus tries again.
      }
    },
    [id, key, cached, showToast, t],
  );

  const reload = useCallback(() => load(false, true), [load]);

  useFocusEffect(
    useCallback(() => {
      void load(false, false);
      return onReconnect(() => void load(false, true));
    }, [load]),
  );

  const setProject = useCallback(
    (view: ProjectView) => {
      // request() already did this for the write; again here for views from elsewhere (idempotent).
      applyWrite(key, view);
      setError(null);
    },
    [key],
  );

  const onError = useCallback(
    (err: unknown) => {
      const code = errorCode(err);
      showToast(t.errors[code]);
      const status = err instanceof ApiClientError ? err.status : 0;
      // A write's NOT_FOUND is usually something inside the project (a member left, a re-split removed a
      // package, a task moved), not the project itself: reload, which goes home only if the project is gone.
      if (code === 'NOT_FOUND') void load(true, true);
      else if (status === 409 || code === 'FORBIDDEN') void reload();
    },
    [load, reload, showToast, t],
  );

  return { project, error: project ? null : error, reload, setProject, onError };
}
