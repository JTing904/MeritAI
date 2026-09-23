// Copy for the notifications tab (owned by the notifs feature). Notification texts: M3 spec §8 and M4 spec §8
// (NotifsM4 mockup), verbatim.
import type { InlinePart } from './home.zh';
import { labelsZh } from './labels.zh';

export type GradeKey = keyof typeof labelsZh.grade;
/** The four levels a leader grades with. */
export type LevelKey = Exclude<GradeKey, 'SELF'>;

/** Points already formatted (formatPoints). `earned`: what the task earns after the write (its counting grade). */
export type GradeText = { title: string; grade: LevelKey; no: number; pts: string; earned: string; counting: boolean };
export type OutsideText = Omit<GradeText, 'no'> & { note: string | null };
export type OverrideText = { title: string; from: GradeKey; to: GradeKey; pts: string; earned: string; counting: boolean };
export type SubmittedText = {
  name: string;
  title: string;
  no: number;
  count: number;
  /** Every piece is a file (「份文件」, else 「份证据」). */
  allFiles: boolean;
  month: number;
  day: number;
  late: boolean;
};

const isFull = (g: GradeKey) => g === 'EXCELLENT' || g === 'PASS' || g === 'SELF';

/** GRADED / GRADED_OUTSIDE: what the grade is worth (not counting: the earlier, better attempt still counts). */
const gradeGain = (g: GradeText | OutsideText) => {
  if (!g.counting) return `仍按之前的 ${g.earned} 分`;
  if (isFull(g.grade)) return `拿满 ${g.pts} 分`;
  return g.grade === 'HALF' ? `现在拿 ${g.earned} 分，改好重交可以拿满` : '0 分，改好可以重交';
};

/** OVERRIDDEN: the task's points after the change. */
const overrideGain = (o: OverrideText) => {
  if (!o.counting) return `仍按 ${o.earned} 分`;
  if (isFull(o.to)) return `拿满 ${o.pts} 分`;
  return o.to === 'HALF' ? `现在拿 ${o.earned} 分` : '0 分';
};

/** WEEKLY_SUMMARY, points formatted. Zero parts are left out (except the total); `top` null → no last sentence. */
export type WeeklyText = {
  tag: string;
  finished: number;
  finishedPts: string;
  total: string;
  overdue: number;
  next: number;
  top: { name: string; pts: string } | null;
};

/** TASK_OVERDUE: the roast lines (M5 spec §2), index = payload.template. The emoji goes on the tile. */
type Roast = (name: string, task: string) => InlinePart[];

export const notifsZh = {
  title: '通知',
  filterLabel: '通知筛选',
  filter: { all: '全部', mine: '跟我有关' },
  /** Meta line: {projectTag} · {audience} · {relative time}. */
  audience: { GROUP: '全组都收到', ONLY_YOU: '只有你收到', ONLY_LEADER: '只有组长收到', YOU_AND_LEADER: '只有你和组长收到' },
  unread: '未读',
  empty: '还没有通知',
  footer: '提醒只跟截止日期走：到期前 24 小时提醒负责人，过期了通知全组，每种只发一次。',
  actions: {
    decline: '拒绝',
    accept: '同意互换',
    resplit: '重新分包',
    pick: '去选任务包',
    openTask: '打开任务',
    grade: '去评级',
    // M5
    delay: '一键延后',
    viewTask: '看任务',
    move: '移给谁',
    end: '结束项目',
    viewProject: '看项目',
    whatsapp: '发到 WhatsApp',
  },
  /** 发到 WhatsApp: the notification as plain text, the project tag in front unless the text names it. */
  share: (tag: string, text: string) => (tag && !text.includes(tag) ? `【${tag}】${text}` : text),
  /** Relative day words for due dates (「明天到期」), relative to when the reminder was sent. */
  /** In the meta line of a WEEKLY_SUMMARY (NotifsM5 mockup). */
  weeklyMeta: '每周小结',
  day: { today: '今天', tomorrow: '明天' },
  toast: {
    accepted: (n: number) => `互换好了！任务包 ${n} 是你的了`,
    declined: '已拒绝互换',
  },

  /** SWAP_REQUEST, to the person asked; the text follows the request's state. */
  request: {
    pending: (requester: string, rp: number, tp: number): InlinePart[] => [
      { b: requester },
      ` 想用自己的「任务包 ${rp}」换你的「任务包 ${tp}」。两个包都还没开工，你同意就立刻互换。`,
    ],
    accepted: (rp: number): InlinePart[] => [`你同意了互换，现在「任务包 ${rp}」是你的。`],
    declined: (requester: string): InlinePart[] => ['你拒绝了 ', { b: requester }, ' 的互换请求。'],
    cancelled: (requester: string): InlinePart[] => [{ b: requester }, ' 取消了互换请求。'],
    expired: (requester: string): InlinePart[] => [{ b: requester }, ' 的互换请求已失效：3 天没有回应。'],
    /** `reason` null: no reason is shown. */
    void: (requester: string, reason: string | null): InlinePart[] => [
      { b: requester },
      reason ? ` 的互换请求已失效，因为${reason}。` : ' 的互换请求已失效。',
    ],
    /** `you`: the viewer caused it; `them`: the person who asked did. */
    reason: {
      SWITCHED: { you: '你换了别的任务包', them: 'TA 换了别的任务包' },
      STARTED: { you: '你已经开工了', them: 'TA 已经开工了' },
      SWAPPED_ELSEWHERE: '其中一个包已经换给别人了',
      LEFT: 'TA 退出了项目',
      RESPLIT: '组长重新分了包',
      PROJECT_DELETED: '组长删除过这个项目',
    },
  },

  /** SWAP_ACCEPTED / DECLINED / EXPIRED / VOID, to the person who asked. */
  swapAccepted: (target: string, tp: number): InlinePart[] => [{ b: target }, ` 同意了互换，现在「任务包 ${tp}」是你的。`],
  swapDeclined: (target: string): InlinePart[] => [{ b: target }, ' 拒绝了你的互换请求。'],
  swapExpired: (target: string): InlinePart[] => ['你发给 ', { b: target }, ' 的互换请求已失效：3 天没有回应。'],
  swapVoid: (target: string, reason: string): InlinePart[] => ['你发给 ', { b: target }, ` 的互换请求已失效，因为${reason}。`],
  swapVoidReason: {
    SWITCHED: 'TA 换了别的任务包',
    STARTED: 'TA 已经开工了',
    SWAPPED_ELSEWHERE: 'TA 已经和别人换了',
    LEFT: 'TA 退出了项目',
  },

  needsPackage: {
    joined: (name: string, tag: string): InlinePart[] => [
      { b: name },
      ` 加入了 ${tag}，但任务包都有人选了。重新分包后，TA 才会有自己的包。`,
    ],
    other: (name: string): InlinePart[] => [{ b: name }, ' 还没有任务包，任务包都有人选了。重新分包后，TA 才会有自己的包。'],
  },

  taskAdded: (title: string, n: number, pts: string): InlinePart[] => [
    `组长把新任务「${title}」放进了你的「任务包 ${n}」。所有任务按比例换算，现在你的包共 ${pts} 分。`,
  ],
  movedIn: {
    fromOwned: (title: string, from: string, n: number): InlinePart[] => [
      `组长把「${title}」从 `,
      { b: from },
      ` 的包移到了你的「任务包 ${n}」。`,
    ],
    fromFree: (title: string, m: number, n: number): InlinePart[] => [`组长把「${title}」从「任务包 ${m}」移到了你的「任务包 ${n}」。`],
    /** A leaver's released task, in no package (M4). */
    fromNowhere: (title: string, n: number): InlinePart[] => [`组长把「${title}」移到了你的「任务包 ${n}」。`],
    evidence: '已交的证据也一起移过来了。',
  },
  movedOut: {
    toOwned: (title: string, m: number, to: string, n: number): InlinePart[] => [
      `组长把「${title}」从你的「任务包 ${m}」移到了 `,
      { b: to },
      ` 的「任务包 ${n}」。`,
    ],
    toFree: (title: string, m: number, n: number): InlinePart[] => [
      `组长把「${title}」从你的「任务包 ${m}」移到了「任务包 ${n}」（还没人选）。`,
    ],
    /** It was in no package before (M4: a submission that stayed with you, then 不通过). */
    fromNowhereToOwned: (title: string, to: string, n: number): InlinePart[] => [
      `组长把「${title}」移到了 `,
      { b: to },
      ` 的「任务包 ${n}」。`,
    ],
    fromNowhereToFree: (title: string, n: number): InlinePart[] => [`组长把「${title}」移到了「任务包 ${n}」（还没人选）。`],
  },
  resplit: {
    same: (n: number, pts: string): InlinePart[] => [
      `组长重新分了包：没开始的任务重新平均分配，你的「任务包 ${n}」现在共 ${pts} 分。已开始的任务没有变。`,
    ],
    renumbered: (n: number, pts: string): InlinePart[] => [
      `组长重新分了包：没开始的任务重新平均分配。你的包现在是「任务包 ${n}」，共 ${pts} 分。已开始的任务没有变。`,
    ],
    free: (free: number): InlinePart[] => [`组长重新分了包，还有 ${free} 个任务包没人选，先到先得！`],
    none: (): InlinePart[] => ['组长重新分了包。'],
  },
  assigned: (n: number): InlinePart[] => [`组长把「任务包 ${n}」指派给了你。还没开工时，你也可以换到别的空包。`],
  leaderTransferred: (from: string): InlinePart[] => [{ b: from }, ' 把组长转给了你。现在你可以管理任务、成员和项目设置。'],
  /** LEADER_TRANSFERRED with leftAfter: the old leader left right after (leave-as-leader). */
  leaderTransferredLeft: (from: string, tag: string): InlinePart[] => [
    { b: from },
    ` 把组长转给了你，然后退出了 ${tag}。现在你可以管理任务、成员和项目设置。`,
  ],
  projectDeleted: (leader: string, tag: string): InlinePart[] => [
    '组长 ',
    { b: leader },
    ' 删除了 ',
    { b: tag },
    '。7 天后会彻底删除；如果组长恢复了，项目会回到你的首页。你的徽章会保留。',
  ],
  projectRestored: (leader: string, tag: string): InlinePart[] => ['组长 ', { b: leader }, ' 恢复了 ', { b: tag }, '，项目回到了你的首页。'],
  memberLeft: (name: string, tag: string, unfinished: number): InlinePart[] => [
    { b: name },
    unfinished > 0
      ? ` 退出了 ${tag}。做完的分数会保留；没做完的 ${unfinished} 个任务现在没人负责。`
      : ` 退出了 ${tag}。做完的分数会保留。`,
  ],
  memberRemoved: (name: string, tag: string, unfinished: number): InlinePart[] => [
    '组长把 ',
    { b: name },
    unfinished > 0
      ? ` 移出了 ${tag}。做完的分数会保留；没做完的 ${unfinished} 个任务现在没人负责。`
      : ` 移出了 ${tag}。做完的分数会保留。`,
  ],
  removedYou: (tag: string): InlinePart[] => [`组长把你移出了 ${tag}。你做完的分数会保留在团队报告里。`],

  // M4: tasks and evidence.
  /** To the leader. A resubmission (no > 1) leaves out the due date unless it was late. */
  submitted: (x: SubmittedText): InlinePart[] => {
    const count = `${x.count} 份${x.allFiles ? '文件' : '证据'}`;
    const due = labelsZh.due.date(x.month, x.day);
    const last = x.late ? `${count}，截止 ${due}，迟交了。` : x.no > 1 ? `${count}。` : `${count}，截止 ${due}。`;
    return x.no > 1
      ? [{ b: x.name }, ` 重交了「${x.title}」（第 ${x.no} 次），请你审核。${last}`]
      : [{ b: x.name }, ` 交了「${x.title}」，请你审核。${last}`];
  },
  graded: (g: GradeText): InlinePart[] => {
    const word = labelsZh.grade[g.grade];
    if (!g.counting) return [`第 ${g.no} 次：组长评了你的「${g.title}」：`, { b: word }, `，${gradeGain(g)}。理由在任务页。`];
    const prefix = g.no > 1 ? `第 ${g.no} 次：` : '';
    const reason = isFull(g.grade) ? '' : '理由在任务页。';
    return [`${prefix}组长评了你的「${g.title}」：`, { b: word }, `，${gradeGain(g)}。${reason}`];
  },
  gradedOutside: (g: OutsideText): InlinePart[] => [
    `组长代为完成了你的「${g.title}」：`,
    { b: labelsZh.grade[g.grade] },
    `，${gradeGain(g)}。${g.note ? `证据在 App 外交了：「${g.note}」。` : '证据在 App 外交了。'}`,
  ],
  overridden: (o: OverrideText): InlinePart[] => [
    `组长把你的「${o.title}」从「${labelsZh.grade[o.from]}」改成了「${labelsZh.grade[o.to]}」：${overrideGain(o)}。理由在任务页。`,
  ],
  overrideUndone: (o: OverrideText): InlinePart[] => [
    `组长撤销了上次推翻，你的「${o.title}」回到「${labelsZh.grade[o.to]}」：${overrideGain(o)}。`,
  ],
  /** WAITING_ON_YOU: to the prereq's owner (set by the waiter or by the leader) or to the leader. */
  waiting: {
    byWaiter: (waiter: string, prereq: string): InlinePart[] => [{ b: waiter }, ` 说在等你的「${prereq}」。`],
    byLeader: (waiter: string, waiting: string, prereq: string): InlinePart[] => [
      '组长标了 ',
      { b: waiter },
      ` 的「${waiting}」要先等你的「${prereq}」。`,
    ],
    toLeader: (waiter: string, owner: string, prereq: string): InlinePart[] => [
      { b: waiter },
      ' 说在等 ',
      { b: owner },
      ` 的「${prereq}」。`,
    ],
    toLeaderNoOwner: (waiter: string, prereq: string): InlinePart[] => [
      { b: waiter },
      ` 说在等「${prereq}」，那个任务还没人负责。`,
    ],
  },
  prereqDone: (prereq: string, waiting: string): InlinePart[] => [`「${prereq}」做完了，可以开始「${waiting}」了。`],

  // M5: reminders (sent by the tick) and the project lifecycle (NotifsM5 mockup, M5 spec §2–§4).
  dueSoon: (title: string, when: string): InlinePart[] => [`你的「${title}」`, { b: when }, ' 到期，还没交。'],
  dueReview: (title: string, day: string, owner: string | null): InlinePart[] =>
    owner ? [`「${title}」${day}到期，`, { b: owner }, ' 已经交了，还在等你评。'] : [`「${title}」${day}到期，已经交了，还在等你评。`],
  ownerlessSoon: (title: string, day: string): InlinePart[] => [`「${title}」${day}到期，还没人负责。`],
  overdue: {
    emoji: ['🐢', '⏰', '🫠', '📣', '🧃'],
    lines: [
      (name, task) => [{ b: name }, ` 的「${task}」过期了，TA 可能还在路上…`],
      (name, task) => [`「${task}」的截止时间过了，`, { b: name }, ' 还没交。大家帮 TA 加加油？'],
      (name, task) => [`大家等「${task}」等到过期了，`, { b: name }, ' 快冲！'],
      (name, task) => ['过期提醒：', { b: name }, ` 的「${task}」还差最后一步。`],
      (name, task) => [`「${task}」过期了，`, { b: name }, ' 要不要先喝口水，再一口气交掉？'],
    ] as Roast[],
    /** Appended when the task waits for an unfinished prerequisite. */
    waiting: (owner: string | null, title: string) => (owner ? `（TA 在等 ${owner} 的「${title}」）` : `（TA 在等「${title}」）`),
  },
  ownerlessOverdue: (title: string): InlinePart[] => [`「${title}」过期了，一直没人认领。`],
  prereqBlocked: (waiting: string, prereq: string, days: number): InlinePart[] => [
    `「${waiting}」被「${prereq}」卡了 ${days} 天，要不要延后？`,
  ],
  prereqAwaitingGrade: (waiting: string, prereq: string, days: number): InlinePart[] => [
    `「${prereq}」已经交了，过了截止 ${days} 天还没评，「${waiting}」在等它。`,
  ],
  weekly: (w: WeeklyText): InlinePart[] => {
    let line = w.finished > 0 ? `完成 ${w.finished} 个任务（+${w.finishedPts} 分），` : '';
    line += `全组 ${w.total} / 100 分`;
    if (w.overdue > 0) line += `；过期 ${w.overdue} 个`;
    if (w.next > 0) line += `；下周要交 ${w.next} 个`;
    const parts: InlinePart[] = [{ b: w.tag ? `${w.tag} 这周` : '这周' }, `：${line}。`];
    if (w.top) parts.push(' ', { b: w.top.name }, ` 这周最多（+${w.top.pts} 分）。`);
    return parts;
  },
  projectDue: (tag: string, autoEnd: string): InlinePart[] => [
    `${tag} 截止日期到了。作业交了就按「结束项目」；`,
    { b: autoEnd },
    ' 前没处理会自动结束。',
  ],
  autoEndSoon: (tag: string): InlinePart[] => [`${tag} `, { b: '明天' }, '会自动结束。作业交了可以现在就按结束；还没交可以延后截止日期。'],
  projectEnded: (leader: string, tag: string, purge: string): InlinePart[] => [
    '组长 ',
    { b: leader },
    ` 结束了 ${tag}。${purge} 会彻底删除，在那之前可以看结果、下载报告。`,
  ],
  projectEndedAuto: (tag: string, purge: string): InlinePart[] => [
    `组长 7 天没处理，${tag} 自动结束了。${purge} 会彻底删除，在那之前可以看结果、下载报告。`,
  ],
  projectReopened: (leader: string, tag: string, deadline: string): InlinePart[] => [
    '组长 ',
    { b: leader },
    ` 重新打开了 ${tag}，新的截止日期 ${deadline}。`,
  ],
  deleteSoon: (tag: string, days: number): InlinePart[] => [`${tag} `, { b: `${days} 天后` }, '会彻底删除，记得下载贡献报告。'],
  taskDelayed: (title: string, date: string, prereq: string | null): InlinePart[] => [
    `组长把你的「${title}」延后到 `,
    { b: date },
    prereq ? `（在等「${prereq}」）。` : '。',
  ],
};
