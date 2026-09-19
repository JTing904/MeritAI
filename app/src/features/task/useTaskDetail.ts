import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import type { TaskDetail } from '@shared/types';
import { useToast } from '@/components/Toast';
import { useI18n } from '@/i18n';
import { ApiClientError, errorCode, type ClientErrorCode } from '@/lib/api';
import { useSession } from '@/lib/session';

export type TaskDetailState = {
  /** Null until the first load succeeds. */
  detail: TaskDetail | null;
  /** Why the first load failed (null while loading and once something is shown): show it with 再试一次. */
  error: ClientErrorCode | null;
  /** Fetches the task again (also runs whenever the screen regains focus). */
  reload: () => Promise<void>;
  /** Shows the detail a write returned (every task write answers with the fresh TaskDetail). */
  setDetail: (detail: TaskDetail) => void;
  /**
   * For a failed write: toasts the error; a 409, FORBIDDEN or NOT_FOUND also reloads (someone changed
   * things). Only when that reload finds the task gone (or the viewer no longer in the project) does the
   * screen go back.
   */
  onError: (err: unknown) => void;
};

/** GET /api/projects/:id/tasks/:taskId for the task page (useProject's rules, for one task). */
export function useTaskDetail(projectId: string, taskId: string): TaskDetailState {
  const { request } = useSession();
  const { t } = useI18n();
  // show is stable; the object useToast returns is not.
  const { show: showToast } = useToast();
  const [detail, setDetailState] = useState<TaskDetail | null>(null);
  const [error, setError] = useState<ClientErrorCode | null>(null);
  // Only the newest load (or write result) may set state: a slow focus reload must not undo a write.
  const latest = useRef(0);
  const hasData = useRef(false);

  // quiet: the caller already toasted NOT_FOUND (one failure, one toast).
  const load = useCallback(
    async (quiet: boolean) => {
      const reqId = ++latest.current;
      if (!hasData.current) setError(null);
      try {
        const next = await request<TaskDetail>(`/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}`);
        if (reqId !== latest.current) return;
        hasData.current = true;
        setDetailState(next);
        setError(null);
      } catch (err) {
        if (reqId !== latest.current) return;
        const code = errorCode(err);
        if (!hasData.current) setError(code);
        else if (code === 'NOT_FOUND') {
          // The task was deleted, or the viewer left the project, while looking at it.
          if (!quiet) showToast(t.errors.NOT_FOUND);
          if (router.canGoBack()) router.back();
          else router.replace('/');
        }
        // Otherwise keep what is on screen; the next focus tries again.
      }
    },
    [projectId, taskId, request, showToast, t],
  );

  const reload = useCallback(() => load(false), [load]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const setDetail = useCallback((next: TaskDetail) => {
    ++latest.current;
    hasData.current = true;
    setDetailState(next);
    setError(null);
  }, []);

  const onError = useCallback(
    (err: unknown) => {
      const code = errorCode(err);
      showToast(t.errors[code]);
      const status = err instanceof ApiClientError ? err.status : 0;
      // A write's NOT_FOUND is often something inside the task (evidence someone removed, a checklist
      // item): reload quietly, which goes back only if the task itself is gone.
      if (code === 'NOT_FOUND') void load(true);
      else if (status === 409 || code === 'FORBIDDEN') void reload();
    },
    [load, reload, showToast, t],
  );

  return { detail, error, reload, setDetail, onError };
}
