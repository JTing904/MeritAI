import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import type { TaskDetail } from '@shared/types';
import { useToast } from '@/components/Toast';
import { forgetProject } from '@/features/project/useProject';
import { useI18n } from '@/i18n';
import { ApiClientError, errorCode, type ClientErrorCode } from '@/lib/api';
import { applyWrite, hasCached, queryCache, useCached } from '@/lib/cache';
import { taskKey } from '@/lib/cacheKeys';
import { onReconnect } from '@/lib/network';
import { useSession } from '@/lib/session';

export type TaskDetailState = {
  /** Null until there is something to show (the cached copy, or the first load). */
  detail: TaskDetail | null;
  /** Why the first load failed (null while loading and once something is shown): show it with 再试一次. */
  error: ClientErrorCode | null;
  /**
   * The server answered at least once since the screen opened. Until then `detail` may be the copy kept
   * from an earlier visit (a change it shows then happened while away, not while looking).
   */
  confirmed: boolean;
  /** Fetches the task again (always asks the server; focus uses the cache's 30 s rule). */
  reload: () => Promise<void>;
  /** Shows the detail a write returned (every task write answers with the fresh TaskDetail). */
  setDetail: (detail: TaskDetail) => void;
  /**
   * For a failed write: toasts the error; a 409, FORBIDDEN or NOT_FOUND also reloads (someone changed
   * things). Only when that reload finds the task gone (or the viewer no longer in the project) does the
   * screen go back.
   */
  onError: (err: unknown) => void;
  /** M6: an attempt waits for the AI (the page polls every 5 s meanwhile). */
  aiBusy: boolean;
};

/** How often the task page asks again while the AI reviews a hand-in (M6). */
const AI_POLL_MS = 5000;

/** GET /api/projects/:id/tasks/:taskId for the task page, through the data cache (useProject's rules, for one task). */
export function useTaskDetail(projectId: string, taskId: string): TaskDetailState {
  const { cached } = useSession();
  const { t } = useI18n();
  // show is stable; the object useToast returns is not.
  const { show: showToast } = useToast();
  const key = taskKey(projectId, taskId);
  const cachedDetail = useCached<TaskDetail>(key);
  const [error, setError] = useState<ClientErrorCode | null>(null);
  // Leaving the project drops it from the cache just before the screen closes: keep the last detail meanwhile.
  const last = useRef<{ key: string; detail: TaskDetail } | null>(null);
  if (cachedDetail) last.current = { key, detail: cachedDetail };
  const detail = cachedDetail ?? (!error && last.current?.key === key ? last.current.detail : null);
  const [confirmed, setConfirmed] = useState(false);

  // quiet: the caller already toasted NOT_FOUND (one failure, one toast).
  const load = useCallback(
    async (quiet: boolean, force: boolean) => {
      const had = hasCached(key);
      if (!had) setError(null);
      try {
        await cached<TaskDetail>(key, { force });
        setError(null);
        setConfirmed(true);
      } catch (err) {
        const code = errorCode(err);
        if (code === 'NOT_FOUND' || code === 'FORBIDDEN') {
          // The task was deleted (404), or the viewer is no longer in the project (403): forget it.
          if (code === 'FORBIDDEN') forgetProject(projectId);
          else queryCache.drop((k) => k === key);
          // Going back keeps the last detail on screen for the transition; otherwise say why it's gone.
          if (!had || code !== 'NOT_FOUND') setError(code);
          else {
            if (!quiet) showToast(t.errors.NOT_FOUND);
            if (router.canGoBack()) router.back();
            else router.replace('/');
          }
        } else if (!had) setError(code);
        // Otherwise keep what is on screen; the next focus tries again.
      }
    },
    [projectId, key, cached, showToast, t],
  );

  const reload = useCallback(() => load(false, true), [load]);

  useFocusEffect(
    useCallback(() => {
      void load(false, false);
      return onReconnect(() => void load(false, true));
    }, [load]),
  );

  // M6: while the AI reviews an attempt (QUEUED / RUNNING), ask again every 5 s (a 304 when nothing moved);
  // it stops once the result is in, and while the screen is out of view.
  const aiBusy = !!detail?.attempts.some((a) => a.aiState === 'QUEUED' || a.aiState === 'RUNNING');
  useFocusEffect(
    useCallback(() => {
      if (!aiBusy) return;
      const timer = setInterval(() => void load(true, true), AI_POLL_MS);
      return () => clearInterval(timer);
    }, [aiBusy, load]),
  );

  const setDetail = useCallback(
    (next: TaskDetail) => {
      // request() already did this for the write; again here for details from elsewhere (idempotent).
      applyWrite(key, next);
      setError(null);
      setConfirmed(true);
    },
    [key],
  );

  const onError = useCallback(
    (err: unknown) => {
      const code = errorCode(err);
      showToast(t.errors[code]);
      const status = err instanceof ApiClientError ? err.status : 0;
      // A write's NOT_FOUND is often something inside the task (evidence someone removed, a checklist
      // item): reload quietly, which goes back only if the task itself is gone.
      if (code === 'NOT_FOUND') void load(true, true);
      else if (status === 409 || code === 'FORBIDDEN') void reload();
    },
    [load, reload, showToast, t],
  );

  return { detail, error: detail ? null : error, confirmed, reload, setDetail, onError, aiBusy };
}
