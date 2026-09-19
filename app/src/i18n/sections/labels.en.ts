import type { labelsZh } from './labels.zh';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const month = (m: number) => MONTHS[m - 1] ?? String(m);

export const labelsEn: typeof labelsZh = {
  kind: { CODE: 'Code', DOC: 'Document', RESEARCH: 'Research', DESIGN: 'Design', MEETING: 'Meeting' },
  kindEmoji: { CODE: '💻', DOC: '📄', RESEARCH: '🔎', DESIGN: '🎨', MEETING: '🗣️' },
  points: (p) => `${p} pts`,
  contribution: (p) => `${p} pts`,
  packageN: (n) => `Package ${n}`,
  leader: 'Leader',
  member: 'Member',
  you: 'You',
  relative: {
    justNow: 'Just now',
    minutes: (m) => `${m} min ago`,
    hours: (h) => (h === 1 ? '1 hour ago' : `${h} hours ago`),
    yesterday: 'Yesterday',
    thisYear: (m, d) => `${month(m)} ${d}`,
    older: (y, m, d) => `${month(m)} ${d}, ${y}`,
  },
  status: {
    TODO: 'To do',
    DOING: 'In progress',
    REVIEWING: 'In review',
    DONE: 'Done',
    HALF: 'Half points',
    FAIL: 'Not passed',
    OVERDUE: 'Overdue',
  },
  statusEmoji: { TODO: '⭕', DOING: '🔨', REVIEWING: '⏳', DONE: '✅', HALF: '🌓', FAIL: '❌', OVERDUE: '🐢' },
};
