// Copy for the 我的任务 tab (owned by app-tabs, M4; TasksTab mockup + M4 spec §10).
export const tasksZh = {
  title: '我的任务',
  filterLabel: '任务筛选',
  filter: { open: (n: number) => `待完成 · ${n}`, done: (n: number) => `已完成 · ${n}` },
  /** Groups of 待完成 by effective due, device zone. */
  group: { overdue: '已过期', today: '今天', tomorrow: '明天', thisWeek: '这周', later: '之后' },
  /** Extras after 「●{tag} · 贡献值 {pts} 分 · {kind}」. */
  extra: {
    overdueDays: (d: number) => `过期 ${d} 天`,
    /** Due earlier today (过期 0 天 would read oddly). */
    overdueToday: '今天过期了',
    reviewing: '等组长审核',
    half: '可重交拿满',
    fail: '要重交',
  },
  /** A REVIEWING / HALF task past its due (handed in, not overdue): the date column, muted. */
  pastDue: { date: (date: string) => `截止 ${date}`, handedIn: '已交' },
  /** 已完成 rows: {tag} · {line} · +{earned} 分. */
  doneLine: {
    graded: (grade: string) => `组长评：${grade}`,
    selfGraded: '合格（组长自评）',
    outside: (grade: string) => `组长代为完成 · ${grade}`,
    meeting: '自己标记完成',
    overridden: (grade: string) => `组长改成：${grade}`,
  },
  earned: (pts: string) => `+${pts} 分`,
  withoutPackage: (tag: string) => `${tag} 还没选任务包，选好后任务会出现在这里。`,
  emptyOpen: '现在没有要做的任务 ☕',
  emptyDone: '还没有完成的任务',
  footer: '所有项目的任务都在这里，同一组里按截止时间排。「等组长审核」的还留在待完成，评好了才算完成。',
};
