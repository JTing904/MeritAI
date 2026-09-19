// Shared vocabulary (task kinds, statuses) used across screens.
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
  /** Task status chips; OVERDUE wins over TODO / DOING / FAIL (displayStatus in lib/status.ts). */
  status: { TODO: '待开始', DOING: '进行中', REVIEWING: '审核中', DONE: '完成', HALF: '拿一半', FAIL: '不通过', OVERDUE: '已过期' },
  statusEmoji: { TODO: '⭕', DOING: '🔨', REVIEWING: '⏳', DONE: '✅', HALF: '🌓', FAIL: '❌', OVERDUE: '🐢' },
};
