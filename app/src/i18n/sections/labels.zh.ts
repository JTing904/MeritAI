// Shared vocabulary (task kinds, statuses, grades, dates) used across screens.
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export const labelsZh = {
  kind: { CODE: '代码', DOC: '文档', RESEARCH: '调研', DESIGN: '设计', MEETING: '开会' },
  kindEmoji: { CODE: '💻', DOC: '📄', RESEARCH: '🔎', DESIGN: '🎨', MEETING: '🗣️' },
  points: (p: string) => `${p} 分`,
  contribution: (p: string) => `贡献值 ${p} 分`,
  packageN: (n: number) => `任务包 ${n}`,
  leader: '组长',
  member: '组员',
  you: '你',
  /** relativeTime() in lib/time.ts. */
  relative: {
    justNow: '刚刚',
    minutes: (m: number) => `${m} 分钟前`,
    hours: (h: number) => `${h} 小时前`,
    yesterday: '昨天',
    thisYear: (month: number, day: number) => `${month}月${day}日`,
    older: (year: number, month: number, day: number) => `${year}年${month}月${day}日`,
  },
  /** Task status chips; OVERDUE wins over TODO / DOING / FAIL (displayStatus / taskChip in lib/status.ts). */
  status: { TODO: '待开始', DOING: '进行中', REVIEWING: '等组长审核', DONE: '完成', HALF: '拿一半', FAIL: '不通过', OVERDUE: '已过期' },
  statusEmoji: { TODO: '⭕', DOING: '🔨', REVIEWING: '📨', DONE: '✅', HALF: '🌓', FAIL: '❌', OVERDUE: '🐢' },
  /** Grade words (never 0–100). SELF: a meeting its owner marked done. */
  grade: { EXCELLENT: '优秀', PASS: '合格', HALF: '拿一半', FAIL: '不通过', SELF: '完成' },
  gradeEmoji: { EXCELLENT: '✅', PASS: '✅', HALF: '🌓', FAIL: '❌', SELF: '✅' },
  /** dateTimeLabel() in lib/time.ts: when something was handed in or graded (status lines). */
  when: {
    today: (time: string) => `今天 ${time}`,
    yesterday: (time: string) => `昨天 ${time}`,
    thisYear: (month: number, day: number, time: string) => `${month}月${day}日 ${time}`,
    older: (year: number, month: number, day: number, time: string) => `${year}年${month}月${day}日 ${time}`,
  },
  /** Evidence rows (features/task/upload.ts evidenceMeta): 1.8 MB · Word, 网址 · forms.gle. */
  fileType: { word: 'Word', pdf: 'PDF', ppt: 'PPT', image: '图片', excel: 'Excel', csv: 'CSV', file: '文件' },
  linkMeta: (host: string) => `网址 · ${host}`,
  /** dueLabel() in lib/time.ts: a due date in the tasks tab and the task page's head chip. `weekday`: 0 = Sunday. */
  due: {
    today: (time: string) => `今天 ${time}`,
    tomorrow: (time: string) => `明天 ${time}`,
    weekday: (weekday: number, time: string) => `${WEEKDAYS[weekday] ?? ''} ${time}`,
    date: (month: number, day: number) => `${month}月${day}日`,
  },
};
