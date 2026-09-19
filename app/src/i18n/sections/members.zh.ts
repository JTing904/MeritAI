// Copy for project settings and the members screen (owned by the members feature).

export const membersZh = {
  /** 「5 / 6 人」 while the team is short of its planned size, else 「6 人」. */
  people: (n: number, size: number): string => (n < size ? `${n} / ${size} 人` : `${n} 人`),
  /** The project's time zone after the deadline: 「吉隆坡时间」. */
  zoneLabel: (city: string) => `${city}时间`,

  settings: {
    title: '项目设置',
    sub: (tag: string, leader: boolean): string => `${tag} · ${leader ? '你是组长' : '你是组员'}`,
    info: '项目信息',
    infoSummary: (name: string, due: string, zone: string) => `${name} · 截止 ${due} · ${zone}`,
    edit: '编辑',
    editLabel: '编辑项目信息',
    members: '成员',
    membersSubLeader: (people: string) => `${people} · 转让组长、移出成员`,
    inviteTitle: '邀请码',
    regenerate: '重新生成邀请码',
    regenerated: '已生成新的邀请码',
    regenerateHint: '重新生成后，旧的邀请码和链接就不能用了。组员也能在这里看到邀请码。',
    ai: 'AI',
    aiProviders: 'AI 平台',
    aiKey: (provider: string) => `组长的 ${provider} API key`,
    aiKeySmall: '· 全组共用',
    aiKeyPlaceholder: '还没填',
    aiHint: '不填也能用，会换成免费的规则解析：拆任务比较粗糙，认不出选择题，也不能审核上传的文件。',
    github: 'GitHub 仓库',
    githubSub: '没有写代码的作业可以不连。连了之后，成员才需要连 GitHub',
    notConnected: '未连接',
    discord: 'Discord 群',
    discordSub: '过期通知和每周小结也会发到群里',
    telegram: 'Telegram 群',
    connect: '连接',
    connectLabel: (name: string) => `连接${name}`,
    end: '结束项目',
    endHint:
      '确认作业已经交了之后，大家有 14 天可以下载团队贡献报告，之后整个项目会被删除（徽章会保留）。截止日过了 7 天还没确认，会自动结束。',
    endButton: '确认已交，结束项目',
    /** The danger card at the bottom (leader): opens DeleteProjectSheet. */
    deleteTitle: '删除项目',
    deleteHint: '为所有人删除这个项目：所有人都会马上看不到它。7 天内你可以在首页恢复，之后彻底删除。',
    deleteButton: '删除项目',
  },

  /** ProjectInfoSheet (leader): name, labels, deadline and time zone. */
  info: {
    title: '项目信息',
    name: '项目名称',
    nameRequired: '请填项目名称。',
    shortCode: '简称 / 课程代码',
    groupLabel: '组别',
    optional: '· 选填',
    course: '课程或团队名称',
    courseSmall: '· 选填，不是课程作业也可以',
    deadline: '截止日期',
    deadlinePlaceholder: '选日期和时间',
    zone: (label: string) => `时区：${label}`,
    zoneChange: '改',
    zoneSheet: '项目时区',
    zoneOthers: '组员在别的时区会自动换成当地时间',
    save: '保存',
    saved: '已保存',
    /** Saved, and the deadline change moved some due dates (`moved` = the wizard's adjusted-dates text). */
    savedMoved: (moved: string) => `已保存。${moved}`,
  },

  page: {
    title: '成员',
    sub: (tag: string, people: string) => `${tag} · ${people}`,
    pkgLine: (n: number, started: boolean): string => `任务包 ${n} · ${started ? '已开工' : '还没开工'}`,
    noPackage: (justJoined: boolean): string => (justJoined ? '还没有任务包 · 刚加入' : '还没有任务包'),
    managesOnly: '组长（只管理）',
    more: (name: string) => `更多：${name}`,
    leftTitle: '已退出',
    leftLine: (date: string, pts: string) => `${date}退出 · 做完的 ${pts} 分会保留在报告里`,
    removedLine: (date: string, pts: string) => `${date}被移出 · 做完的 ${pts} 分会保留在报告里`,
    invite: '邀请组员',
    leave: '退出项目',
    leaveTitle: (tag: string) => `退出 ${tag}？`,
    leaveBody: '你做完的分数会保留；没做完的任务会变成没人负责。之后还可以用邀请码回来。',
    leaveConfirm: '退出项目',
    left: (tag: string) => `已退出 ${tag}`,
  },

  /** LeaderLeaveSheet: the leader taps 「退出项目」 (LeaderLeave mockup). */
  leaderLeave: {
    title: (tag: string) => `退出 ${tag}？`,
    body: '你是组长，先选一个做法。',
    self: '我自己退出',
    selfSub: '选一个人当新组长，然后你退出。项目和大家的任务、分数都不受影响。',
    deleteAll: '为所有人删除项目',
    deleteAllSub: '所有人都看不到这个项目了。7 天内你可以恢复，之后彻底删除。',
    hint: '组里只剩你一个人时，只有「为所有人删除项目」。',
  },

  /** PickNewLeaderSheet (PickNewLeader mockup). */
  pickLeader: {
    title: '谁来当新组长？',
    body: 'TA 会收到通知，之后由 TA 管理任务、成员和项目设置。',
    pkg: (n: number) => `任务包 ${n}`,
    noPackage: '还没有任务包',
    confirm: (name: string) => `转让给${name}并退出`,
    hint: '你做完的分数会保留；没做完的任务会变成没人负责，新组长可以再移给别人。',
  },

  /** DeleteProjectSheet (DeleteProject mockup), from the members page and project settings. */
  deleteProject: {
    title: (tag: string) => `为所有人删除 ${tag}？`,
    warn: '所有人都会马上看不到这个项目，并收到通知。7 天内你可以在首页恢复；7 天后项目、任务、文件会彻底删除。大家的徽章会保留。',
    label: (tag: string) => `打一遍项目简称「${tag}」才能删除`,
    confirm: '为所有人删除',
    done: (tag: string) => `已删除 ${tag}，7 天内可以在首页恢复`,
  },

  /** MemberActions sheet (leader taps ⋯ on a member). */
  actions: {
    sub: (n: number, pts: string, started: boolean): string => `任务包 ${n} · ${pts} 分 · ${started ? '已开工' : '还没开工'}`,
    noPackage: '还没有任务包',
    transfer: '把组长转给 TA',
    transferSub: '你会变成普通组员，TA 可以管理任务、成员和项目设置。',
    remove: '移出项目',
    removeSub: 'TA 做完的分数会保留；没做完的任务变成没人负责，你可以再移给别人。被移出的人不能用邀请码回来。',
    hint: '这两个操作都会先让你再确认一次。',
    transferTitle: (name: string) => `把组长转给 ${name}？`,
    transferBody: (managesOnly: boolean): string =>
      managesOnly ? '你会变成普通组员。你选了「只管理」，转让后会取消：你会变成还没有任务包的组员。' : '你会变成普通组员。',
    transferConfirm: '转让组长',
    transferred: (name: string) => `${name} 现在是组长了`,
    removeTitle: (name: string) => `把 ${name} 移出项目？`,
    removeConfirm: '移出',
    removed: (name: string) => `已移出 ${name}`,
  },

  /** InviteSheet / InvitePanel (same copy as the wizard's step 6 invite box). */
  invite: {
    title: '邀请组员',
    code: (code: string) => `邀请码 ${code}`,
    copyLink: '复制链接',
    copied: '邀请链接已复制',
    field: '或者输入邮箱、GitHub 用户名',
    placeholder: 'xiaowen@uni.edu.my, @ahmad-dev',
    send: '邀请',
    hint: '对方登录后，会在首页看到邀请。组员也能在项目设置里看到邀请码，任何人都可以拉人。',
    invited: (n: number) => `已发出 ${n} 个邀请`,
    result: {
      INVITED: '已邀请',
      ALREADY_MEMBER: '已经在项目里',
      ALREADY_INVITED: '之前邀请过了',
      INVALID: '看不出是邮箱还是 GitHub 用户名',
    },
  },
};
