// What the task page works out from a TaskDetail (who may do what, which attempts to show).
import type { AttemptView, Grade, ProjectView, TaskDetail, TaskView } from '@shared/types';
import type { ChipTone } from '@/components/Chip';
import type { useSession } from '@/lib/session';

export type Request = ReturnType<typeof useSession>['request'];

/**
 * A task write: shows `busy` on the button named `key`, then the TaskDetail it returned. Only one runs at a
 * time: while one is running, another call does nothing and resolves false (a double tap, Enter twice).
 */
export type RunWrite = (
  key: string,
  path: string,
  init: { method: 'POST' | 'PUT' | 'DELETE'; body?: unknown; idempotencyKey?: string },
  opts?: {
    /** Called with the fresh detail (toast, confetti, closing a sheet). */
    done?: (detail: TaskDetail) => void;
    /** Return true when the error was shown in place (an inline field error); otherwise onError runs. */
    fail?: (err: unknown) => boolean;
  },
) => Promise<boolean>;

/** Everything the task page's blocks need. */
export type TaskCtx = {
  project: ProjectView;
  detail: TaskDetail;
  task: TaskView;
  viewerId: string;
  leader: boolean;
  /** The viewer owns the task. */
  mine: boolean;
  /** ACTIVE or AWAITING_CONFIRM project: writes are allowed (ended or draft projects are read-only). */
  running: boolean;
  /** ENDED (M5): read-only, except the leader grading a PENDING attempt. */
  ended: boolean;
  /** The request running now (its button shows loading; every other button is disabled). */
  busy: string | null;
  run: RunWrite;
  /** A member's name (members who left too); null when unknown. */
  nameOf: (memberId: string | null) => string | null;
  /** Base path of this task's API routes. */
  base: string;
  toast: (message: string) => void;
  onError: (err: unknown) => void;
};

export const FULL_GRADES: Grade[] = ['EXCELLENT', 'PASS', 'SELF'];
export const isFullGrade = (g: Grade | null): boolean => g !== null && FULL_GRADES.includes(g);

/** The task's own due date, else the project deadline. */
export const effectiveDue = (detail: TaskDetail): string => detail.task.dueAt ?? detail.project.deadline;

/** Tenths a task earns with this grade (the server's earnedFor). */
export function earnedFor(points: number, grade: Grade | null): number {
  if (grade === null) return 0;
  if (isFullGrade(grade)) return points;
  return grade === 'HALF' ? Math.round(points / 2) : 0;
}

/** good / warn / bad: the colour of a grade's result panel. */
export function gradeTone(grade: Grade): Exclude<ChipTone, 'default' | 'grape'> {
  if (isFullGrade(grade)) return 'good';
  return grade === 'HALF' ? 'warn' : 'bad';
}

const rank = (g: Grade | null): number => (g === null ? -1 : isFullGrade(g) ? 2 : g === 'HALF' ? 1 : 0);

/** The best graded attempt other than `except` (latest on a tie), for 「第 1 次拿一半（5.0 分）」. */
export function bestOther(detail: TaskDetail, except: string): AttemptView | null {
  let best: AttemptView | null = null;
  for (const a of detail.attempts) {
    if (a.id === except || a.status !== 'GRADED' || a.grade === null) continue;
    if (!best || rank(a.grade) >= rank(best.grade)) best = a;
  }
  return best;
}

/**
 * The owner's editable evidence block (交证据 with upload tiles) is showing: the owner, an active project,
 * not a meeting, not full marks, nothing waiting for review; and either no graded attempt yet (first time)
 * or a resubmission started (a DRAFT attempt exists or 修改后重新提交 was pressed).
 */
export function showsEvidenceEditor(ctx: TaskCtx, resubmitting: boolean): boolean {
  const { detail, task } = ctx;
  if (!ctx.mine || !ctx.running || task.kind === 'MEETING' || task.status === 'DONE') return false;
  if (detail.current?.status === 'PENDING') return false;
  const graded = detail.attempts.some((a) => a.status === 'GRADED');
  return !graded || resubmitting || detail.current?.status === 'DRAFT';
}

/**
 * The attempts in the 交证据 history (oldest first): handed in, graded, or a draft that holds evidence.
 * The draft the owner is editing above is left out.
 */
export function historyAttempts(detail: TaskDetail, editingDraft: boolean): AttemptView[] {
  return detail.attempts.filter((a) => {
    if (a.status === 'DRAFT') return !editingDraft && a.evidence.length > 0;
    return true;
  });
}

/** The live (not undone) override of an attempt, newest first in `changes`. */
export const liveChange = (attempt: AttemptView) => attempt.changes.find((ch) => ch.undoneAt === null) ?? null;
