import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import type { ProjectView } from '@shared/types';
import { useToast } from '@/components/Toast';
import { useI18n } from '@/i18n';
import { ApiClientError, errorCode, type ClientErrorCode } from '@/lib/api';
import { useSession } from '@/lib/session';

export type ProjectState = {
  /** Null until the first load succeeds. */
  project: ProjectView | null;
  /** Why the first load failed (null while loading and once something is shown): show it with 再试一次. */
  error: ClientErrorCode | null;
  /** Fetches the project again (also runs whenever the screen regains focus). */
  reload: () => Promise<void>;
  /** Shows the view a write returned (every M3 write answers with the fresh ProjectView). */
  setProject: (view: ProjectView) => void;
  /**
   * For a failed write: toasts the error; a 409, FORBIDDEN or NOT_FOUND also reloads (someone changed
   * things). Only when that reload finds the project gone (or the viewer no longer in it) does it go home.
   */
  onError: (err: unknown) => void;
};

/** GET /api/projects/:id for the project screens (project page, pick, settings, members, task). */
export function useProject(id: string): ProjectState {
  const { request } = useSession();
  const { t } = useI18n();
  // show is stable; the object useToast returns is not.
  const { show: showToast } = useToast();
  const [project, setProjectState] = useState<ProjectView | null>(null);
  const [error, setError] = useState<ClientErrorCode | null>(null);
  // Only the newest load (or write result) may set state: a slow focus reload must not undo a write.
  const latest = useRef(0);
  const hasData = useRef(false);

  // quiet: the caller already toasted NOT_FOUND (one failure, one toast).
  const load = useCallback(async (quiet: boolean) => {
    const reqId = ++latest.current;
    if (!hasData.current) setError(null);
    try {
      const next = await request<ProjectView>(`/projects/${encodeURIComponent(id)}`);
      if (reqId !== latest.current) return;
      hasData.current = true;
      setProjectState(next);
      setError(null);
    } catch (err) {
      if (reqId !== latest.current) return;
      const code = errorCode(err);
      if (!hasData.current) setError(code);
      else if (code === 'NOT_FOUND') {
        // Removed from the project (or it was deleted) while looking at it.
        if (!quiet) showToast(t.errors.NOT_FOUND);
        // Pop back to the home already in the stack (replace would leave the dead project screens under it).
        router.dismissTo('/');
      }
      // Otherwise keep what is on screen; the next focus tries again.
    }
  }, [id, request, showToast, t]);

  const reload = useCallback(() => load(false), [load]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const setProject = useCallback((view: ProjectView) => {
    ++latest.current;
    hasData.current = true;
    setProjectState(view);
    setError(null);
  }, []);

  const onError = useCallback(
    (err: unknown) => {
      const code = errorCode(err);
      showToast(t.errors[code]);
      const status = err instanceof ApiClientError ? err.status : 0;
      // A write's NOT_FOUND is usually something inside the project (a member left, a re-split removed a
      // package, a task moved), not the project itself: reload, which goes home only if the project is gone.
      if (code === 'NOT_FOUND') void load(true);
      else if (status === 409 || code === 'FORBIDDEN') void reload();
    },
    [load, reload, showToast, t],
  );

  return { project, error, reload, setProject, onError };
}
