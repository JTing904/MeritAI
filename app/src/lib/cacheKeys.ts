// Cache keys (request paths) and what a successful write does to the cache. Pure, so it can be checked
// with plain Node; lib/cache.ts applies the result.

export const HOME_KEY = '/home';
export const MY_TASKS_KEY = '/tasks/mine';
export const ME_KEY = '/me';
export const UNREAD_KEY = '/notifications/unread-count';

export const projectKey = (projectId: string) => `/projects/${encodeURIComponent(projectId)}`;
export const taskKey = (projectId: string, taskId: string) => `${projectKey(projectId)}/tasks/${encodeURIComponent(taskId)}`;

/** The project's own view and everything under it (tasks, feed). */
export const underProject = (projectId: string) => {
  const base = projectKey(projectId);
  return (key: string) => key === base || key.startsWith(`${base}/`) || key.startsWith(`${base}?`);
};

export const isNotificationsKey = (key: string) => key.startsWith('/notifications');

/**
 * Written to storage (kept across restarts, until sign-out): the screens that should open instantly.
 * Not: a brief's full text, previews, drafts in the wizard, anything else.
 */
export function isPersistable(key: string): boolean {
  if (key === HOME_KEY || key === MY_TASKS_KEY || key === ME_KEY || key === UNREAD_KEY) return true;
  if (key.startsWith('/notifications?') && !key.includes('cursor=')) return true;
  // /projects/:id, /projects/:id/tasks/:taskId, /projects/:id/feed?limit=… (first page).
  return /^\/projects\/[^/?]+(\/tasks\/[^/?]+|\/feed\?limit=\d+)?$/.test(key);
}

/** What one successful write means for the cache. */
export type WriteEffect = {
  /** Fetch these again the next time they show. */
  stale: ((key: string) => boolean)[];
  /** Gone for this user: remove. */
  drop: ((key: string) => boolean)[];
  /** Fresh data the write answered with. */
  set: { key: string; data: unknown }[];
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A ProjectView (not a DraftView: only members' views have viewerMemberId and packages). */
function asProjectView(v: unknown): { id: string; view: Obj } | null {
  if (!isObj(v) || !isObj(v.basics) || typeof v.basics.id !== 'string') return null;
  if (typeof v.viewerMemberId !== 'string' || !Array.isArray(v.packages) || typeof v.packagesVersion !== 'number') return null;
  // adjustedTasks is only for the one response that moved due dates; a later show must not repeat it.
  const { adjustedTasks: _moved, ...view } = v;
  return { id: v.basics.id, view };
}

/** A TaskDetail. */
function asTaskDetail(v: unknown): { projectId: string; taskId: string } | null {
  if (!isObj(v) || !isObj(v.task) || !isObj(v.project) || !Array.isArray(v.attempts)) return null;
  if (typeof v.task.id !== 'string' || typeof v.project.id !== 'string') return null;
  return { projectId: v.project.id, taskId: v.task.id };
}

/**
 * After any successful non-GET request: home and 我的任务 may have changed (they summarise every
 * project); a write under /projects/:id may have changed that project and its tasks; a response that is
 * a ProjectView or TaskDetail is the fresh data for its key. Leaving or deleting a project removes it.
 */
export function writeEffect(path: string, result: unknown): WriteEffect {
  const bare = path.split('?')[0] ?? path;
  // Marking read, the profile, signing out: nothing on home or 我的任务 changes.
  const personal = /^\/(notifications|me|auth)(\/|$)/.test(bare);
  const effect: WriteEffect = { stale: personal ? [] : [(k) => k === HOME_KEY || k === MY_TASKS_KEY], drop: [], set: [] };

  const m = /^\/projects\/([^/]+)(\/.*)?$/.exec(bare);
  if (m) {
    const id = decodeURIComponent(m[1]!);
    const rest = m[2] ?? '';
    if (rest === '/leave' || rest === '/leave-as-leader' || rest === '/delete' || rest === '') {
      // rest '' is DELETE /projects/:id (a draft) or PATCH /projects/:id: a PATCH answers with the view, set below.
      if (rest !== '' || result === null || result === undefined) effect.drop.push(underProject(id));
      else effect.stale.push(underProject(id));
    } else effect.stale.push(underProject(id));
  }
  // The time machine (development) moved the server clock and ran the reminders: anything may read
  // differently now (due chips, lifecycle, new notifications).
  if (bare === '/dev/time-machine') effect.stale.push(() => true);
  // Swaps and invites change the project and the notification cards that show them.
  if (/^\/(swaps|invites|join)\//.test(bare)) effect.stale.push(isNotificationsKey);

  const project = asProjectView(result);
  if (project) {
    effect.stale.push(underProject(project.id));
    effect.set.push({ key: projectKey(project.id), data: project.view });
  }
  const task = asTaskDetail(result);
  if (task) {
    effect.stale.push(underProject(task.projectId));
    effect.set.push({ key: taskKey(task.projectId, task.taskId), data: result });
  }
  return effect;
}
