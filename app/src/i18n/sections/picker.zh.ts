// Copy for the date picker sheet (every date field in the app opens it).

export const pickerZh = {
  titleTask: '选截止日期',
  titleProject: '选项目截止日期',
  quickLabel: '常用日期',
  quick: {
    tomorrow: '明天',
    thisFriday: '这周五',
    nextFriday: '下周五',
    deadline: '项目截止',
    twoWeeks: '两周后',
    oneMonth: '一个月后',
    twoMonths: '两个月后',
  },
  /** Month heading: 2026 年 10 月 */
  month: (y: number, m: number) => `${y} 年 ${m} 月`,
  prevMonth: '上个月',
  nextMonth: '下个月',
  /** Sunday first. */
  weekdays: ['日', '一', '二', '三', '四', '五', '六'],
  today: '今天',
  /** A day's accessible name: 10月9日，今天 / 11月6日，项目截止. */
  day: (date: string, deadline: boolean, today: boolean) => `${date}${deadline ? '，项目截止' : ''}${today ? '，今天' : ''}`,
  /** 10月9日（周五）23:59 截止 */
  due: (when: string) => `${when} 截止`,
  noDay: '还没选日期',
  endOfDay: (city: string) => `只选日期就是当天 23:59 · ${city}时间`,
  zoneTime: (city: string) => `${city}时间`,
  changeZone: '改时区',
  deadlineDay: '🏁 项目截止日 · 任务不能晚于这一天',
  changeTime: '改时间',
  time: '时间',
  commonTimes: '常用时间',
  otherTime: '其他时间',
  hourLess: '早一小时',
  hourMore: '晚一小时',
  minuteLess: '早 5 分钟',
  minuteMore: '晚 5 分钟',
  clear: '不设日期',
  confirm: '确定',
  /** 确定 · 10月9日 18:00 */
  confirmAt: (when: string) => `确定 · ${when}`,
  noDateHint: (deadline: string) => `不设日期就按项目截止（${deadline}）提醒。`,
};
