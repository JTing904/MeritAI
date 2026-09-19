import type { labelsZh } from './labels.zh';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const month = (m: number) => MONTHS[m - 1] ?? String(m);
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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
    REVIEWING: 'Waiting for review',
    DONE: 'Done',
    HALF: 'Half points',
    FAIL: 'Not passed',
    OVERDUE: 'Overdue',
  },
  statusEmoji: { TODO: '⭕', DOING: '🔨', REVIEWING: '📨', DONE: '✅', HALF: '🌓', FAIL: '❌', OVERDUE: '🐢' },
  grade: { EXCELLENT: 'Excellent', PASS: 'Pass', HALF: 'Half', FAIL: 'Fail', SELF: 'Done' },
  gradeEmoji: { EXCELLENT: '✅', PASS: '✅', HALF: '🌓', FAIL: '❌', SELF: '✅' },
  when: {
    today: (time) => `Today ${time}`,
    yesterday: (time) => `Yesterday ${time}`,
    thisYear: (m, d, time) => `${d} ${month(m)} ${time}`,
    older: (y, m, d, time) => `${d} ${month(m)} ${y} ${time}`,
  },
  fileType: { word: 'Word', pdf: 'PDF', ppt: 'PowerPoint', image: 'Image', excel: 'Excel', csv: 'CSV', file: 'File' },
  linkMeta: (host) => `Link · ${host}`,
  due: {
    today: (time) => `Today ${time}`,
    tomorrow: (time) => `Tomorrow ${time}`,
    weekday: (weekday, time) => `${WEEKDAYS[weekday] ?? ''} ${time}`,
    date: (m, d) => `${d} ${month(m)}`,
  },
};
