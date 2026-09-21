// Copy for the home screens (owned by the home feature).

/** A piece of a sentence; `{ b }` pieces are bold (names in the invite card). */
export type InlinePart = string | { b: string };

export const homeZh = {
  title: '首页',
  myProfile: '我的',
  hello: { before: '嗨，', after: '！' },
  subIdle: '这周没有要交的任务，喘口气 ☕',
  /** From HomeData.dueSoon (M4): k tasks past due, n more due by Sunday night. */
  subOverdue: (k: number, n: number) => (n > 0 ? `有 ${k} 个任务过期了，这周还有 ${n} 个要交` : `有 ${k} 个任务过期了`),
  subWeek: (n: number) => `这周有 ${n} 个任务要交`,
  subWelcome: '欢迎来到 MeritAI。先建一个项目，或者加入组员的项目。',
  myProjects: '我的项目',
  card: {
    people: (n: number) => `${n} 人`,
    peopleOf: (joined: number, size: number) => `${joined} / ${size} 人`,
    youLead: '你是组长',
    ledBy: (name: string) => `组长${name}`,
    freePackages: (n: number) => `还有 ${n} 个任务包没人选`,
    myPackage: (n: number) => `你的包：任务包 ${n}`,
    /** Active, no package and none left to pick (the leader has been reminded to re-split). */
    noPackage: '你还没有任务包',
    earned: (points: string) => `${points} / 100 分`,
    daysLeft: (n: number) => `还剩 ${n} 天`,
    dueToday: '今天截止',
    pastDeadline: '已过截止日',
    // M5 (HomeLife mockup): AWAITING_CONFIRM and ENDED cards.
    awaitingYou: '📮 等你确认已交',
    awaitingLeader: '📮 等组长确认',
    ended: '🏁 已结束',
    endedAuto: '🏁 自动结束',
    awaitingLine: (autoEnd: string) => `截止已过 · ${autoEnd} 自动结束`,
    autoEndedLine: '组长 7 天没处理，自动结束了',
    /** `days` 0: deleted later today. */
    purgeLine: (date: string, days: number) => (days > 0 ? `${date} 删除 · 还有 ${days} 天` : `${date} 删除 · 今天`),
  },
  draft: {
    tag: '草稿',
    notSplit: '还没分包',
    onlyYou: '只有你看得到',
    lastEdited: (when: string, step: number) => `上次编辑：${when} · 停在第 ${step} 步`,
    resume: '继续编辑',
    delete: '删除草稿',
    deleteTitle: (name: string) => `删除草稿「${name}」？`,
    deleteBody: '填好的内容和任务会一起删掉，不能恢复。',
    deleted: '草稿已删除',
  },
  /** A project the leader deleted for everyone (DeletedHome mockup), restorable until purgeAfter. */
  deleted: {
    chip: '已删除',
    date: (month: number, day: number) => `${month}月${day}日`,
    line: (deleted: string, purge: string) => `你在 ${deleted} 删除了这个项目。${purge} 会彻底删除，在那之前可以恢复。`,
    restore: '恢复项目',
    restored: (tag: string) => `已恢复 ${tag}`,
  },
  when: {
    today: (time: string) => `今天 ${time}`,
    yesterday: (time: string) => `昨天 ${time}`,
    thisYear: (month: number, day: number, time: string) => `${month}月${day}日 ${time}`,
    older: (year: number, month: number, day: number) => `${year}年${month}月${day}日`,
  },
  invite: {
    line: (inviter: string, project: string): InlinePart[] => [{ b: inviter }, ' 邀请你加入 ', { b: project }],
    decline: '拒绝',
    accept: '接受邀请',
    declined: '已拒绝邀请',
  },
  empty: {
    title: '还没有项目',
    body: '当组长：上传作业要求，让 MeritAI 帮你拆任务、平均分包。\n当组员：输入组员给你的邀请码。',
    demo: '先逛逛示例项目',
    demoSub: '一个假的项目，随便点，不会影响任何人',
    demoSoon: '示例项目快做好了',
  },
  newProject: '新建项目',
  joinByCode: '用邀请码加入',
  fab: {
    label: '新建或加入项目',
    title: '要做什么？',
    newSub: '你当组长，上传作业要求让 AI 拆任务',
    joinSub: '组员分享给你的邀请码或链接',
  },
};
