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
  footer: '全组都能看到每个人的任务和评级结果。「等组长审核」的任务在过期名单里不算；过期后交的照样能评，报告里记「迟交」。',

  /** 排行 tab (proto §4.5, REQUIREMENTS §13 排行榜). Points come formatted. */
  rank: {
    podium: '颁奖台',
    /** On the podium, instead of the viewer's short name. */
    you: '你',
    /** Under the number in a podium block. */
    unit: '分',
    youSuffix: '（你）',
    earned: (p: string) => `${p} 分`,
    packageTotal: (p: string) => `包内共 ${p} 分`,
    noPackage: '还没有任务包',
    empty: '还没有人完成任务，完成后这里会排名次。',
    leftTitle: '已退出',
    left: (name: string, p: string) => `${name} · ${p} 分`,
    formula: [
      { b: '怎么算：' },
      '整个项目 100 分，每个任务值几分。评级「优秀」「合格」拿满，「拿一半」拿一半，「不通过」是 0。写代码、写报告、开会都一样算。',
    ] as Inline[],
    /** Screen readers: a podium place and a ranked row. */
    place: (rank: number, name: string, p: string) => `第 ${rank} 名 · ${name} · ${p} 分`,
    row: (rank: number, name: string, p: string, pkg: string) => `第 ${rank} 名 · ${name} · ${p} 分 · ${pkg}`,
  },

  /** 待我审核 (leader, board 12): the PENDING submissions, oldest first. */
  queue: {
    title: (n: number) => `待我审核 · ${n}`,
    late: '迟交',
    /** `due`: only when handed in late. */
    meta: (name: string, when: string, n: number, due: string | null) =>
      `${name} · 交于 ${when} · ${n} 份${due ? ` · 截止 ${due}` : ''}`,
    grade: '评级',
    gradeLabel: (title: string, name: string) => `评级：${name}的「${title}」`,
  },

  /** 📄 作业要求 card (everyone, when the project keeps the brief's text). */
  briefCard: {
    title: '作业要求',
    file: (name: string) => `${name} · 全组都能看全文`,
    typed: '打字描述 · 全组都能看全文',
  },

  /** The full brief page (board 15). */
  brief: {
    title: '作业要求',
    sub: (tag: string, name: string) => `${tag} · ${name}`,
    typed: '打字描述',
    /** `mine`: opened from a task (the yellow block is that task's item). */
    hint: (file: string, mine: boolean) =>
      `从「${file}」读出来的文字，不是原文件。全组都能看${mine ? '；黄色那段是你现在这个任务对应的要求。' : '。'}`,
    hintTyped: (mine: boolean) => `组长打字输入的作业要求。全组都能看${mine ? '；黄色那段是你现在这个任务对应的要求。' : '。'}`,
    mine: (title: string) => `你的任务：${title}`,
    theirs: (name: string, title: string) => `${/[A-Za-z0-9.)]$/.test(name) ? `${name} ` : name}的任务：${title}`,
    nobody: (title: string) => `没人负责：${title}`,
  },

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
    // M4 (Step 0 wrote these from spec §9; app-leader owns them). `grade` words come from t.labels.grade.
    /** A task that was in no package before the move (a leaver's, or a submission that stayed with its owner). */
    TASK_MOVED_UNPACKAGED: (a: Who, title: string, to: number): Inline[] => [{ b: who(a) }, ` 把「${title}」移到了「任务包 ${to}」`],
    SUBMITTED: (a: Who, title: string, no: number): Inline[] =>
      no > 1 ? [{ b: who(a) }, ` 重交了「${title}」（第 ${no} 次）`] : [{ b: who(a) }, ` 交了「${title}」，等组长审核`],
    WITHDRAWN: (a: Who, title: string): Inline[] => [{ b: who(a) }, ` 撤回了「${title}」的提交`],
    GRADED: (a: Who, owner: Who, title: string, grade: string): Inline[] => [
      { b: who(a) },
      ' 评了 ',
      { b: who(owner) },
      ` 的「${title}」：${grade}`,
    ],
    GRADED_SELF: (a: Who, title: string): Inline[] => [{ b: who(a) }, ` 交了「${title}」，算合格（组长自评）`],
    GRADED_OUTSIDE: (a: Who, owner: Who, title: string, grade: string): Inline[] => [
      { b: who(a) },
      ' 代为完成了 ',
      { b: who(owner) },
      ` 的「${title}」：${grade}`,
    ],
    OVERRIDDEN: (a: Who, owner: Who, title: string, from: string, to: string): Inline[] => [
      { b: who(a) },
      ' 把 ',
      { b: who(owner) },
      ` 的「${title}」从「${from}」改成了「${to}」`,
    ],
    OVERRIDE_UNDONE: (a: Who, title: string, to: string): Inline[] => [{ b: who(a) }, ` 撤销了「${title}」的推翻，回到「${to}」`],
    MEETING_DONE: (a: Who, title: string, n: number): Inline[] => [{ b: who(a) }, ` 开完了「${title}」，${n} 人参加`],
    START_UNDONE: (a: Who, title: string): Inline[] => [{ b: who(a) }, ` 撤销了「${title}」的开始`],
    PREREQ_SET: (a: Who, waiting: string, prereq: string, prereqOwner: Who | null): Inline[] => [
      { b: who(a) },
      ` 标了「${waiting}」要先等「${prereq}」${prereqOwner ? `（${who(prereqOwner)}）` : ''}`,
    ],
    PREREQ_CLEARED: (a: Who, waiting: string): Inline[] => [{ b: who(a) }, ` 去掉了「${waiting}」的前置任务`],
    PROJECT_DELETED: (a: Who): Inline[] => [{ b: who(a) }, ' 删除了项目'],
    PROJECT_RESTORED: (a: Who): Inline[] => [{ b: who(a) }, ' 恢复了项目'],
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
