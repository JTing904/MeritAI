// Copy for 让 AI 重新拆 (M6 follow-up, docs/plan/m6-resplit-spec.md): the leader tools entry and its sheet, the
// re-split screen (AI reading, new 选择题, the review), and its notifications and feed line. Verbatim from the
// approved mockup 「MeritAI 样稿 · AI 重新拆」 where it has it. Reached as t.ai.resplit.
import type { BriefFailure } from '@shared/types';
import type { InlinePart } from './home.zh';
import type { Inline, Who } from './project.zh';

const who = (w: Who) => (w.you ? '你' : w.name);

export const resplitZh = {
  /** 组长工具 button. */
  tool: '✨ 让 AI 重新拆',
  /** Under the greyed-out button. */
  noKey: '让 AI 重新拆要用 AI key。',
  noKeyLink: '去「我」页填一把 ›',
  invalid: (provider: string) => `你的 ${provider} key 不能用了，换一把再试。`,
  invalidLink: '去「我」页换 key ›',

  sheet: {
    title: '让 AI 重新拆没开始的任务',
    body: (kept: number, replace: number): InlinePart[] => [
      '已经开始、交了或做完的 ',
      { b: `${kept} 个任务保留不动` },
      '；剩下 ',
      { b: `${replace} 个还没开始的` },
      '，AI 会按作业要求重新拆。拆好先给你看，你确认了才会换。',
    ],
    briefLabel: 'AI 要读哪份作业要求',
    saved: '原来那份',
    savedSub: (file: string | null, date: string, fromResplit: boolean) =>
      `${file ?? '打字输入的'} · ${date}${fromResplit ? '重新拆时换上' : '建项目时上传'}`,
    fresh: '换一份新的',
    freshSub: '老师发了新版本？上传文件或打字都行',
    upload: '上传文件',
    typeIt: '打字',
    pickAgain: '换一个文件',
    pickFirst: '先选一个文件。',
    picked: (size: string) => (size ? `已选好 · ${size}` : '已选好'),
    textLabel: '新的作业要求',
    textPlaceholder: '把新的作业要求贴在这里',
    quota: (provider: string, used: number, limit: number | null) =>
      `用你帐号上的 ${provider} key，一般 1 分钟内拆完。每拆一次用掉好模型 1–3 次额度（${limit ? `今天用了 ${used} / 约 ${limit} 次` : `今天用了 ${used} 次`}）。`,
    start: '开始重新拆',
    pending: '上次拆好的还没确认，重新拆会把它换掉。',
    running: 'AI 正在重新拆，重新开始会把这次停掉。',
    look: '去看看',
    tooLarge: (max: string) => `文件太大了，最大 ${max}。`,
    unreadable: {
      TOO_LARGE: '文件太大了，最大 10 MB。',
      EMPTY: '这份作业要求是空的。',
      UNSUPPORTED_TYPE: '这种文件读不了，换成 PDF、Word、图片或文字。',
      UNREADABLE: 'AI 读不了这个文件，换成 PDF、Word、图片或文字。',
      NO_STRUCTURE: 'AI 读不了这个文件，换成 PDF、Word、图片或文字。',
    } as Record<BriefFailure, string>,
  },

  screen: {
    title: '让 AI 重新拆',
    sub: (tag: string) => `${tag} · 只有你看得到`,
    loadFailed: '暂时看不到 AI 的进度，稍后会自动再试。',
  },

  reading: {
    titlePre: 'AI 正在',
    titleHl: '重新拆',
    titlePost: '…',
    label: 'AI 重新拆的进度',
    readFile: (name: string, lines: number | null) => (lines ? `读完「${name}」（${lines} 行）` : `读完「${name}」`),
    readText: (lines: number | null) => (lines ? `读完作业要求（${lines} 行）` : '读完作业要求'),
    keep: (n: number) => (n > 0 ? `保留 ${n} 个已经开始的任务` : '还没有已经开始的任务'),
    split: '拆剩下还没开始的部分…',
    match: '对上原来的选择题',
    place: '放进各个任务包',
    hint: '组员这时看到的还是原来的任务。你可以先离开，拆好会通知你。',
    queued: (seconds: number) => `在排队：你的 key 这一分钟能用的次数到了，大约 ${seconds} 秒后开始。`,
    stop: '不拆了',
    stopped: '已经不拆了，什么都没变',
  },

  failed: {
    title: 'AI 这次没拆成',
    quota: (provider: string) => `⏳ 你的 ${provider} 今天的额度用完了`,
    quotaBody: (when: string) => `${when}恢复，到时候再试一次。`,
    invalid: (provider: string) => `❌ 你的 ${provider} key 不能用了`,
    invalidBody: '去「我」页换一把能用的 key，再回来按「再试一次」。',
    noKey: '❌ 你的 AI key 已经删掉了',
    noKeyBody: '去「我」页填一把 key，再回来按「再试一次」。',
    error: '⚠️ AI 这次出错了',
    errorBody: '试了几次都没成功，可能是 AI 那边太忙。',
    nothing: '什么都没变，组员看到的还是原来的任务。',
    goMe: '去「我」页',
    retry: '再试一次',
    close: '关闭',
  },

  question: {
    no: (i: number, n: number) => `新的选择题 ${i} / ${n}`,
    titlePre: '新版作业多了一题：',
    kept: (prompt: string, keys: string) => `原来的选择题「${prompt}」沿用你选的 ${keys}，不用再选。`,
    rec: (key: string) => `AI 只看工作量、资料多少和难度，推荐 ${key}。`,
    next: '下一题',
    review: '下一步：看拆好的任务',
    hint: '之后还能在组长工具「改选」里换。',
  },

  review: {
    titlePre: '看看这样',
    titleHl: '拆对不对',
    sub: '还没确认，组员看到的还是原来的任务。点任务可以改，往左滑可以删除。',
    subWeb: '还没确认，组员看到的还是原来的任务。点任务可以改或删除。',
    kept: '保留不动',
    removed: '删掉没开始的',
    added: 'AI 新拆的',
    keptH: (n: number) => `保留不动 · 已经开始的 ${n} 个`,
    all: '看全部',
    fold: '收起',
    unchanged: '🔒 不变',
    addedH: (n: number) => `AI 新拆的 · ${n} 个`,
    pkgHead: (i: number, name: string | null) => (name ? `任务包 ${i} · ${name}` : `任务包 ${i} · 还没人选`),
    noPkg: '不在任务包里',
    plus: (pts: string) => `+${pts} 分`,
    rowMeta: (pts: string, due: string) => `${pts} 分 · 截止 ${due}`,
    rowMetaNoDue: (pts: string) => `${pts} 分 · 按项目截止日期`,
    byYou: '你加的',
    moreNew: (pkgs: string, n: number) => `任务包 ${pkgs} 还有 ${n} 个新任务（展开）。`,
    pkgSep: '、',
    add: '＋ 加任务',
    removedH: (n: number) => `删掉 · 还没开始的 ${n} 个`,
    removedRow: (title: string, pts: string) => `${title} · ${pts} 分`,
    more: (n: number) => `还有 ${n} 个…`,
    pkgsH: '任务包的分数会这样变',
    free: '还没人选',
    change: (a: string, b: string) => `${a} → ${b}`,
    chgTitle: '确认后会这样',
    chgSwap: (removed: number, added: number) => `没开始的 ${removed} 个任务删掉，换成 AI 新拆的 ${added} 个，放进各自的任务包；已经选了包的人不用重选。`,
    chgPointsKept: '保留的任务分数不变，新任务分掉剩下的分数，',
    chgPointsMoved: '你改了分数，所以按工作量比例重新换算，保留的任务也会微调一点，',
    chgPointsB: '总分还是 100',
    chgPointsPost: '。',
    chgKept: (prompt: string, keys: string) => `原来的选择题「${prompt}」沿用你选的 ${keys}。`,
    chgNew: (prompt: string, labels: string) => `新的选择题「${prompt}」选 ${labels}。`,
    chgNotify: '全组收到通知。',
    keysJoin: ' + ',
    labelSep: '、',
    confirm: '确认，换成新任务',
    discard: '不要了，保持原样',
    done: '换好了，全组会收到通知',
    discarded: '保持原样，什么都没变',
    stale: '刚才有人开始做任务了，已经按现在的情况重新算好，再看一下。',
    deleted: (title: string) => `已删掉「${title}」`,
  },

  edit: {
    editTitle: '改任务',
    addTitle: '加一个任务',
    delete: '删除这个任务',
    hint: '分数会和其他任务一起按比例换算，总分还是 100。',
  },

  none: {
    title: '没有等你确认的结果',
    body: '可能已经换好了，或者已经保持原样。',
    back: '回项目',
  },

  notifs: {
    ready: (): InlinePart[] => ['AI 重新拆好了，去看看要不要换。'],
    failed: {
      QUOTA: (provider: string): InlinePart[] => [`你的 ${provider} key 今天的额度用完了，AI 没重新拆成。什么都没变。`],
      INVALID: (provider: string): InlinePart[] => [`你的 ${provider} key 不能用了，AI 没重新拆成。什么都没变。`],
      NO_KEY: (): InlinePart[] => ['你的 AI key 已经删掉了，AI 没重新拆成。什么都没变。'],
      OTHER: (): InlinePart[] => ['AI 这次没重新拆成，什么都没变。'],
    },
    group: (leader: string, kept: number, removed: number, added: number): InlinePart[] => [
      { b: leader },
      ` 让 AI 重新拆了还没开始的任务：保留 ${kept} 个，换掉 ${removed} 个没开始的，新加 ${added} 个。`,
    ],
    mine: (leader: string, pkg: number, removed: number, added: number, pts: string): InlinePart[] => [
      { b: leader },
      ` 让 AI 重新拆了还没开始的任务。你的任务包 ${pkg}：删了 ${removed} 个，加了 ${added} 个，现在 ${pts} 分。`,
    ],
  },

  feed: (a: Who, kept: number, removed: number, added: number): Inline[] => [
    { b: who(a) },
    ` 让 AI 重新拆了任务：保留 ${kept} 个，换掉 ${removed} 个没开始的，新加 ${added} 个`,
  ],
};
