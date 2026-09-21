// Copy for the project lifecycle (M5): the lifecycle card, 结束项目 / 重新打开 / 一键延后 sheets, the frozen
// note and the developer time machine. Texts from the DueLeader / DueMember / Ended / EndSheet / ReopenSheet /
// DelaySheet mockups, verbatim. Dates come formatted.
import type { InlinePart } from './home.zh';

export const lifeZh = {
  /** Above the packages and on the task page of an ENDED project. */
  frozen: '已结束，只能看',

  /** AWAITING_CONFIRM card under the hero. */
  due: {
    leaderTitle: '截止日期到了，作业交了吗？',
    leaderBody: '交了就按「结束项目」。结束后大家有 14 天看结果、下载贡献报告，之后整个项目会删除（徽章会保留）。',
    end: '结束项目',
    extend: '延后截止日期',
    leaderAuto: (date: string): InlinePart[] => [
      { b: date },
      ' 前还没处理，会自动结束，当作已经交了。结束前大家还能交证据，你也能照常评级。',
    ],
    memberTitle: '截止日期到了',
    memberBody: (leader: string | null, date: string): InlinePart[] => [
      ...(leader ? ['在等组长 ', { b: leader }, ' 确认作业已经交了。'] : ['在等组长确认作业已经交了。']),
      { b: date },
      ' 前组长没处理，会自动结束。',
    ],
    memberHint: '结束前还可以交证据；结束后就只能看了。',
  },

  /** ENDED card under the hero. */
  ended: {
    title: (date: string) => `项目已结束 · ${date}`,
    titleAuto: (date: string) => `项目自动结束了 · ${date}`,
    autoLine: '组长 7 天没处理，项目自动结束了。',
    /** `days` 0: deleted later today. */
    body: (date: string, days: number): InlinePart[] => [
      { b: date },
      days > 0 ? ` 会彻底删除（还有 ${days} 天）。` : ' 会彻底删除（就在今天）。',
      '在那之前大家可以看结果、下载贡献报告。徽章会保留。',
    ],
    report: '下载贡献报告',
    reopen: '重新打开',
  },

  /** EndSheet (leader). */
  end: {
    title: '结束项目',
    heading: (tag: string) => `结束 ${tag}？`,
    notify: '全组马上收到通知。',
    frozen: (pending: number): InlinePart[] =>
      pending > 0
        ? ['结束后只能看：不能再交证据、改评级、移任务。在等你评的 ', { b: `${pending} 个任务` }, '还可以评完。']
        : ['结束后只能看：不能再交证据、改评级、移任务。'],
    purge: (date: string): InlinePart[] => [
      { b: date },
      '（14 天后）项目、任务、文件会彻底删除；在那之前大家可以看结果、下载贡献报告。徽章会保留。',
    ],
    undo: '按错了？14 天内可以在项目页「重新打开」。',
    confirm: '确认结束',
    done: (tag: string) => `已结束 ${tag}`,
  },

  /** ReopenSheet (leader). */
  reopen: {
    title: '重新打开',
    heading: (tag: string) => `重新打开 ${tag}？`,
    passed: (date: string) => `截止日期（${date}）已经过了，先选一个新的截止日期。`,
    ahead: (date: string) => `截止日期 ${date} 还没到，可以不改；想改也可以现在选。`,
    label: '新的截止日期',
    labelOptional: '截止日期',
    after: '要在今天之后',
    unchanged: '不改',
    change: '改',
    pick: '选日期',
    hint: '重开后大家又能交证据、评级，删除倒数取消，全组收到通知。到期 7 天没处理，会再自动结束。',
    confirm: '重新打开',
    done: (tag: string) => `已重新打开 ${tag}`,
    /** `moved`: wizard.basics.adjusted (task dates that moved with the new deadline). */
    doneMoved: (tag: string, moved: string) => `已重新打开 ${tag}。${moved}`,
  },

  /** DelaySheet (leader; 一键延后). */
  delay: {
    title: '一键延后',
    /** The link on the task page's 前置任务 card. */
    link: '一键延后',
    heading: (task: string) => `「${task}」要延后吗？`,
    /** `days` 0 or less: the prerequisite isn't past its due yet. */
    blocked: (prereq: string, prereqOwner: string | null, days: number, owner: string | null, task: string) => {
      const who = prereqOwner ? `（${prereqOwner}）` : '';
      const waiter = owner ? `${owner} 的「${task}」` : `「${task}」`;
      return days > 0 ? `「${prereq}」${who}过期 ${days} 天了，${waiter}一直在等它。` : `${waiter}在等「${prereq}」${who}。`;
    },
    label: (task: string) => `「${task}」新的截止日期`,
    was: (date: string, days: number) => `原来 ${date} · 延后 ${days} 天`,
    chips: '延后几天',
    plus: (n: number) => `+${n} 天`,
    plusBlocked: (n: number) => `+${n} 天（卡住的天数）`,
    change: '改',
    hint: (deadline: string, owner: string | null) => `不会晚于项目截止日期 ${deadline}。${owner ? `${owner} 会收到通知。` : ''}`,
    atDeadline: '已经到项目截止日期了。要再延后，先改项目截止日期。',
    confirm: (date: string) => `延后到 ${date}`,
    cancel: '先不延',
    done: (date: string) => `已延后到 ${date}`,
  },

  /** Developer tools on the 我 page (development builds and the server's dev gate only). */
  timeMachine: {
    title: '时间机器',
    hint: '改服务器的时钟，跳过去后马上跑一次提醒。重启服务器会回到现在。',
    now: (time: string) => `服务器时间：${time}`,
    offset: (text: string) => `比现在快 ${text}`,
    behind: (text: string) => `比现在慢 ${text}`,
    none: '没有偏移（现在的时间）',
    days: (d: number) => `${d} 天`,
    hours: (h: number) => `${h} 小时`,
    minutes: (m: number) => `${m} 分钟`,
    hour: '+1 小时',
    day: '+1 天',
    week: '+7 天',
    sunday: '到下个周日 20:05',
    reset: '重置',
    unavailable: '这个服务器没有开启开发工具（DEV_LOGIN=true 和 APP_ENV=development）。',
    loading: '正在读取…',
    ticked: (n: number) => (n > 0 ? `已跳转，发了 ${n} 条提醒` : '已跳转，没有要发的提醒'),
  },
};
