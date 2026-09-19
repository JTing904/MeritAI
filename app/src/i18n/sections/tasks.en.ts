import type { tasksZh } from './tasks.zh';

export const tasksEn: typeof tasksZh = {
  title: 'My tasks',
  filterLabel: 'Task filter',
  filter: { open: (n) => `To do · ${n}`, done: (n) => `Done · ${n}` },
  group: { overdue: 'Overdue', today: 'Today', tomorrow: 'Tomorrow', thisWeek: 'This week', later: 'Later' },
  extra: {
    overdueDays: (d) => (d === 1 ? '1 day overdue' : `${d} days overdue`),
    overdueToday: 'Overdue since today',
    reviewing: 'Waiting for review',
    half: 'Resubmit for full points',
    fail: 'Needs resubmitting',
  },
  pastDue: { date: (date) => `Due ${date}`, handedIn: 'Handed in' },
  doneLine: {
    graded: (grade) => `Leader graded: ${grade}`,
    selfGraded: 'Pass (leader self-graded)',
    outside: (grade) => `Completed by the leader · ${grade}`,
    meeting: 'Marked done by you',
    overridden: (grade) => `Leader changed it to: ${grade}`,
  },
  earned: (pts) => `+${pts} pts`,
  withoutPackage: (tag) => `You haven't picked a package in ${tag} yet. Once you do, its tasks show up here.`,
  emptyOpen: 'Nothing to do right now ☕',
  emptyDone: 'No finished tasks yet',
  footer:
    'Tasks from all your projects are here, each group sorted by due time. Tasks waiting for review stay under To do; they count as done once graded.',
};
