// Copy for the pick screen (选任务包) and swap requests (owned by the pick feature).
const intro = '左右滑动看看。还没开工可以直接换到没人选的包；想换别人的包，要对方同意，而且两个包都还没开工。';

export const pickZh = {
  title: '选任务包',
  sub: (tag: string, people: number) => `${tag} · ${people} 人 · 先到先得`,
  settings: '项目设置',
  /** 每包都是 <hl>20 分</hl>，<br>挑你最想做的 */
  titleEqual: '每包都是 ',
  /** 每包大约 <hl>16.7 分</hl>，<br>挑你最想做的 */
  titleAbout: '每包大约 ',
  titleHl: (points: string) => `${points} 分`,
  /** 各包的分数不一样，<br>挑你最想做的 (no highlight) */
  titleUneven: '各包的分数不一样',
  titleEnd: '，\n挑你最想做的',
  intro,
  /** The intro under the uneven title: 最多 36.8 分，最少 10.5 分。左右滑动看看。… */
  introUneven: (max: string, min: string) => `最多 ${max} 分，最少 ${min} 分。${intro}`,

  card: {
    hours: (h: number) => `约 ${h} 小时`,
    unit: '分',
    contribution: '贡献值',
  },

  // Decorative emoji and marks are separate: they are hidden from screen readers (proto §2.10).
  mine: { text: '这是你的任务包', emoji: '✓' },
  goMyTasks: '去看我的任务',
  takenBy: (name: string) => `已被 ${name} 选走`,
  takenStarted: ' · 已开工',
  pickMe: '选我！',
  switchTo: '换成这个',
  canSwitch: '你还没开工，可以直接换',
  cantSwitch: '你已开工，不能换包',
  managesOnly: '只管理的组长不用选任务包',
  requestSwap: { emoji: '🔁', text: '申请互换' },
  theyStarted: '对方已开工，不能互换',
  youStarted: '你已开工，不能互换',
  oneRequest: '一次只能申请一个互换',

  swap: {
    incoming: (name: string) => `${name} 想和你互换`,
    decline: '拒绝',
    accept: '同意互换',
    waiting: { emoji: '⏳', text: (name: string) => `已申请互换，等${name}同意` },
    cancel: '取消申请',
    hint: '3 天没回应会自动失效。任何一方开工或换包，申请也会失效。',
  },

  toast: {
    picked: (n: number) => `🎉 任务包 ${n} 是你的了！`,
    switched: (n: number) => `换好了，现在任务包 ${n} 是你的`,
    requested: (name: string) => `已向 ${name} 发出互换请求，对方同意才会换`,
    accepted: (n: number) => `互换好了！任务包 ${n} 是你的了`,
    declined: '已拒绝互换',
    cancelled: '已取消互换申请',
  },

  /** Footer hint by plan source (none for a manual plan). */
  dueHint: {
    ai: '截止日期是 AI 按里程碑建议的，组长可以再改。',
    rules: '截止日期是按项目截止日平均排的，组长可以再改。',
  },
};
