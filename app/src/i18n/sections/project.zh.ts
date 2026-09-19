// Copy for the project page, the temporary task page and the leader sheets (owned by the project feature).

/** A piece of a sentence; `{ b }` pieces are bold (names in the feed, the lightest-package note). */
export type Inline = string | { b: string };

/** A person in a feed sentence; `you` when it is the viewer (shown as 你). */
export type Who = { name: string; you: boolean };

const who = (w: Who) => (w.you ? '你' : w.name);

/** Tasks that stay put in a re-split, grouped by owner (null = nobody's). */
export type LockedGroup = { owner: string | null; titles: string[] };

export const projectZh = {
  settings: '项目设置',
  sub: {
    leader: (n: number) => `你是组长 · ${n} 人`,
    leaderManages: (n: number) => `你是组长（只管理） · ${n} 人`,
    member: (leader: string) => `你是组员 · 组长：${leader}`,
  },

  hero: {
    due: (date: string) => `截止 ${date}`,
    of: '/ 100 分',
    ring: (points: string) => `已完成 ${points} 分，共 100 分`,
    // Chip emoji are separate from the text: they are hidden from screen readers (proto §2.10).
    leftEmoji: '⏳',
    daysLeft: (n: number) => `还剩 ${n} 天`,
    dueToday: '今天截止',
    pastDeadline: '已过截止',
    milestoneEmoji: '🚩',
    milestone: (label: string, name: string, date: string) => `${[label, name].filter(Boolean).join(' ')} · ${date}`,
  },

  needs: {
    pickTitle: '还没选任务包',
    pickBody: (n: number) => `还有 ${n} 个任务包没人选，先到先得！`,
    pick: '去选任务包',
    waitTitle: '你还没有任务包',
    waitBody: '任务包都有人选了。已经提醒组长重新分包，分好后你会收到通知。',
    leaderTitle: '任务包都被选走了',
    leaderBody: '你也要做任务的话，重新分包多分出一个包。',
    others: (n: number) => `有 ${n} 位组员还没有任务包`,
    resplit: '重新分包',
  },

  tabs: { label: '项目内容', packages: '任务包', rank: '排行', feed: '动态' },

  pkg: {
    mine: '我的任务包',
    free: '还没人选',
    assign: '指派给…',
    overdue: (k: number) => `${k} 个过期`,
    earned: (p: string) => `${p} 分`,
    /** Under the earned points of an owned package. */
    total: (p: string) => `共 ${p} 分`,
    /** On its own (a package nobody picked). */
    totalOnly: (p: string) => `共 ${p} 分`,
    move: '移动任务',
    switch: { emoji: '🔁', text: '换包或申请互换' },
  },
  footer: '全组都能看到每个人的任务和 AI 审核结果。',

  tools: {
    title: '组长工具',
    onlyYou: '只有你看得到',
    addTask: '加任务',
    resplit: '重新分包',
    hint: '点任务旁边的「⋯」可以把它移到别的包；没人选的包可以指派给还没有包的人。',
  },

  addTask: {
    title: '加一个任务',
    name: '任务名称',
    kind: '类型',
    points: '贡献值',
    unit: '分',
    due: '截止日期',
    dueSmall: '· 选填',
    duePlaceholder: '不填就按项目截止',
    clearDue: '清除截止日期',
    where: (n: number | null): Inline[] => [
      '加进去后，会',
      { b: '自动放进目前最轻的任务包' },
      `${n ? `（任务包 ${n}）` : ''}。所有任务的贡献值会按比例换算，总分还是 100 分。`,
    ],
    add: '加进去',
    added: '已加入目前最轻的任务包',
    nameMissing: '请填任务名称。',
    pointsInvalid: '贡献值要填 0.1 到 99.9 之间的数字。',
  },

  move: {
    title: '移动任务',
    question: (title: string, points: string) => `把「${title}」（${points} 分）移到哪个包？`,
    here: '现在在这里',
    owned: (n: number, name: string) => `任务包 ${n} · ${name}`,
    you: (name: string) => `${name}（你）`,
    free: (n: number) => `任务包 ${n} · 还没人选`,
    change: (before: string, after: string) => `${before} → ${after} 分`,
    hint: '还没完成的任务都能移，做到一半的也可以；已交的证据跟着任务走。不用对方同意，双方都会收到通知。',
    moved: (n: number) => `已移到「任务包 ${n}」`,
  },

  assign: {
    title: (n: number) => `指派任务包 ${n}`,
    body: '指派给还没有任务包的人。TA 会收到通知；还没开工时，TA 也可以自己换到别的空包。',
    justJoined: '刚加入 · 还没有任务包',
    noPackage: '还没有任务包',
    you: (name: string) => `${name}（你）`,
    hint: '所有人都有包了？可以先用「重新分包」多分出一个包。',
    assigned: (name: string) => `已指派给 ${name}`,
  },

  resplit: {
    title: '重新分包',
    intro: '还没开始的任务会重新平均分配；已经开始或完成的任务，留在原来的人那里。每个人保留自己的包。',
    count: '分成几个包',
    minMembers: (n: number) => `· 至少要和现在的成员人数一样多（${n} 人）`,
    minCount: (n: number) => `· 至少 ${n} 个`,
    less: '减少任务包',
    more: '增加任务包',
    colPackage: '任务包',
    colBefore: '分包前',
    colAfter: '分包后',
    owned: (index: number, name: string) => `${index} · ${name}`,
    renumbered: (oldIndex: number) => `（原任务包 ${oldIndex}）`,
    free: (index: number) => `${index} · 还没人选`,
    added: (index: number) => `${index} · 新的包`,
    removed: (oldIndex: number) => `${oldIndex} · 会删掉`,
    dash: '—',
    /** `total`: every locked task; `rest`: the ones not named (after the first six titles). */
    locked: (groups: LockedGroup[], total: number, rest: number) =>
      `已开始的任务不会动：${groups
        .map((g) => `${g.owner ? `${g.owner}的` : '没人负责的'}${g.titles.map((x) => `「${x}」`).join('')}`)
        .join('、')}${rest > 0 ? `等 ${total} 个` : ''}。`,
    noneLocked: '现在还没有人开始做任务。',
    freeHint: (names: string[]) => `新的包先是灰色，可以让${names.join('、')}自己选，或由你指派。`,
    apply: '重新分包',
    confirmTitle: '重新分包？',
    confirmBody: '没开始的任务会重新分配，大家会收到通知。',
    confirm: '重新分包',
    done: '已重新分包，大家会收到通知',
  },

  feed: {
    empty: '还没有动态',
    /** An event whose actor is gone. */
    someone: '有人',
    PLAN_CONFIRMED: (a: Who, n: number): Inline[] => [{ b: who(a) }, ` 把任务分成了 ${n} 个任务包`],
    JOINED: (a: Who): Inline[] => [{ b: who(a) }, ' 加入了项目'],
    LEFT: (a: Who): Inline[] => [{ b: who(a) }, ' 退出了项目'],
    REMOVED: (a: Who, m: Who): Inline[] => [{ b: who(a) }, ' 把 ', { b: who(m) }, ' 移出了项目'],
    PICKED: (a: Who, n: number): Inline[] => [{ b: who(a) }, ` 选了「任务包 ${n}」`],
    SWITCHED: (a: Who, from: number, to: number): Inline[] => [{ b: who(a) }, ` 从「任务包 ${from}」换到了「任务包 ${to}」`],
    SWAPPED: (a: Who, requester: Who): Inline[] => [
      { b: who(a) },
      requester.you ? ' 同意了你的互换请求' : ` 同意了 ${requester.name} 的互换请求`,
    ],
    ASSIGNED: (a: Who, n: number, m: Who): Inline[] => [{ b: who(a) }, ` 把「任务包 ${n}」指派给了 `, { b: who(m) }],
    TASK_ADDED: (a: Who, title: string, n: number): Inline[] => [{ b: who(a) }, ` 加了新任务「${title}」，放进「任务包 ${n}」`],
    TASK_MOVED: (a: Who, title: string, from: number, to: number): Inline[] => [
      { b: who(a) },
      ` 把「${title}」从「任务包 ${from}」移到了「任务包 ${to}」`,
    ],
    TASK_STARTED: (a: Who, title: string): Inline[] => [{ b: who(a) }, ` 开始做「${title}」`],
    RESPLIT: (a: Who, n: number): Inline[] => [{ b: who(a) }, ` 重新分了包，现在有 ${n} 个任务包`],
    LEADER_TRANSFERRED: (a: Who, m: Who): Inline[] => [{ b: who(a) }, ' 把组长转给了 ', { b: who(m) }],
  },

  task: {
    title: '任务详情',
    sub: (tag: string, n: number | null) => (n ? `${tag} · 任务包 ${n}` : tag),
    due: (date: string) => `⏰ ${date}`,
    ownerYou: '负责人：你',
    owner: (name: string) => `负责人：${name}`,
    noOwner: '没人负责',
    start: '开始做',
    started: '已开始。开工后就不能直接换包或互换了。',
    devTitle: '开发测试',
    devHint: '只在开发版出现：直接改这个任务的状态，方便测试开工和得分。',
  },
};
