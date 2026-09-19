import type { TaskStatus, TaskView } from '@shared/types';

/** Keys of t.labels.status / t.labels.statusEmoji. */
export type StatusKey = TaskStatus | 'OVERDUE';

/** What a task's status chip / emoji shows: overdue 🐢 wins over TODO, DOING and FAIL (proto §5.2). */
export function displayStatus(task: Pick<TaskView, 'status' | 'overdue'>): StatusKey {
  const open = task.status === 'TODO' || task.status === 'DOING' || task.status === 'FAIL';
  return task.overdue && open ? 'OVERDUE' : task.status;
}
