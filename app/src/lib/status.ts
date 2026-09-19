import type { TaskStatus, TaskView } from '@shared/types';
import type { ChipTone } from '@/components/Chip';
import type { Messages } from '@/i18n/zh';

/**
 * Finished work (never moves, earns its points): the server's isFinished. Grade-based since M4, so a HALF
 * task under re-review (status REVIEWING, grade HALF) is still finished.
 */
export const isFinished = (task: Pick<TaskView, 'status' | 'grade'>): boolean =>
  task.status === 'DONE' || task.status === 'HALF' || (task.grade !== null && task.grade !== 'FAIL');

/** Keys of t.labels.status / t.labels.statusEmoji. */
export type StatusKey = TaskStatus | 'OVERDUE';

/** What a task's status chip / emoji shows: overdue 🐢 wins over TODO, DOING and FAIL (proto §5.2). */
export function displayStatus(task: Pick<TaskView, 'status' | 'overdue'>): StatusKey {
  const open = task.status === 'TODO' || task.status === 'DOING' || task.status === 'FAIL';
  return task.overdue && open ? 'OVERDUE' : task.status;
}

const TONE: Record<StatusKey, ChipTone> = {
  TODO: 'default',
  DOING: 'default',
  REVIEWING: 'default',
  DONE: 'good',
  HALF: 'warn',
  FAIL: 'bad',
  OVERDUE: 'bad',
};

export type TaskChip = { key: StatusKey; label: string; emoji: string; tone: ChipTone };

/**
 * A task's status as a chip (M4): the COUNTING grade decides (status / grade), never an attempt being
 * looked at. DONE shows the grade word (优秀 / 合格 / 完成). Tiles use `emoji`; the task page's head chip
 * shows `label` alone, except REVIEWING (📨 等组长审核) and OVERDUE (🐢 已过期), which keep their emoji.
 */
export function taskChip(task: Pick<TaskView, 'status' | 'overdue' | 'grade'>, t: Pick<Messages, 'labels'>): TaskChip {
  const key = displayStatus(task);
  const label = key === 'DONE' && task.grade ? t.labels.grade[task.grade] : t.labels.status[key];
  return { key, label, emoji: t.labels.statusEmoji[key], tone: TONE[key] };
}
