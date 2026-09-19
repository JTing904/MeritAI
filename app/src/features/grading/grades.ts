// Grade arithmetic the grading sheets show before the server answers (same rules as server lib/grading.ts).
import { formatPoints } from '@shared/planning';
import type { AttemptView, GradeChangeView, Grade, TaskDetail } from '@shared/types';

/** The four levels a leader can give (SELF is only a meeting's own 标记完成). */
export type LeaderGrade = Exclude<Grade, 'SELF'>;
export const LEADER_GRADES: LeaderGrade[] = ['EXCELLENT', 'PASS', 'HALF', 'FAIL'];

export const isFullGrade = (g: Grade | null): boolean => g === 'EXCELLENT' || g === 'PASS' || g === 'SELF';

/** "The better one": full 2 > HALF 1 > FAIL 0. */
const rank = (g: Grade): number => (isFullGrade(g) ? 2 : g === 'HALF' ? 1 : 0);

/** Tenths a grade earns: full → points, HALF → half (rounded), FAIL / none → 0. */
export function earnedFor(points: number, grade: Grade | null): number {
  if (grade === null) return 0;
  if (isFullGrade(grade)) return points;
  return grade === 'HALF' ? Math.round(points / 2) : 0;
}

/** Half of a task's points, as shown (拿一半分 · 5.0 分). */
export const halfPoints = (points: number): string => formatPoints(Math.round(points / 2));

/** good / warn / bad, as the level buttons and the result panels colour a grade. */
export function gradeTone(grade: Grade): 'good' | 'warn' | 'bad' {
  if (isFullGrade(grade)) return 'good';
  return grade === 'HALF' ? 'warn' : 'bad';
}

/**
 * What the TASK would earn if `attempt` got `grade`: the best of that and every other graded attempt
 * (the counting attempt is the best one, so lowering one attempt can leave an older, better one counting).
 */
export function earnedAfterOverride(detail: TaskDetail, attempt: Pick<AttemptView, 'id'>, grade: LeaderGrade): number {
  let best: Grade = grade;
  for (const a of detail.attempts) {
    if (a.id === attempt.id || a.status !== 'GRADED' || a.grade === null) continue;
    if (rank(a.grade) > rank(best)) best = a.grade;
  }
  return earnedFor(detail.task.points, best);
}

/** The task's most recent override that isn't undone (what 撤销上次推翻 walks back), with its attempt. */
export function latestLiveChange(detail: TaskDetail): { change: GradeChangeView; attempt: AttemptView } | null {
  let found: { change: GradeChangeView; attempt: AttemptView } | null = null;
  for (const attempt of detail.attempts) {
    for (const change of attempt.changes) {
      if (change.undoneAt !== null) continue;
      if (!found || change.createdAt > found.change.createdAt) found = { change, attempt };
    }
  }
  return found;
}

/** The effective due: the task's own, else the project deadline. */
export const effectiveDue = (detail: TaskDetail): string => detail.task.dueAt ?? detail.project.deadline;
