// Copy for the notifications tab (owned by the notifs feature). Notification texts: M3 spec §8, verbatim.
import type { InlinePart } from './home.zh';

export const notifsZh = {
  title: '通知',
  filterLabel: '通知筛选',
  filter: { all: '全部', mine: '跟我有关' },
  /** Meta line: {projectTag} · {audience} · {relative time}. */
  audience: { GROUP: '全组都收到', ONLY_YOU: '只有你收到', ONLY_LEADER: '只有组长收到' },
  unread: '未读',
  empty: '还没有通知',
  footer: '提醒只跟截止日期走：到期前 24 小时提醒负责人，过期了通知全组，每种只发一次。',
  actions: { decline: '拒绝', accept: '同意互换', resplit: '重新分包', pick: '去选任务包' },
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
};
