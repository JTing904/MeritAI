// Copy for M6 (AI): the 我 page key card, the project settings AI card, the wizard's AI steps (读作业, 出错,
// 选择题), 改选, the task page's 怎么做 / AI review / fallback, AI notifications and feed lines. Verbatim from
// the approved M6 mockups (scratchpad/m6mock/gen10.py) where they have it.
import type { AiProviderName } from '@shared/constants';
import type { InlinePart } from './home.zh';
import { labelsZh } from './labels.zh';
import type { GradeText } from './notifs.zh';
import type { Inline, Who } from './project.zh';
import { resplitZh } from './resplit.zh';

const who = (w: Who) => (w.you ? '你' : w.name);
const isFull = (g: GradeText['grade']) => g === 'EXCELLENT' || g === 'PASS';

type Levels = { LOW: string; MID: string; HIGH: string };
type PerProvider = Record<AiProviderName, string>;

/** A grade by the AI, to the owner (GRADED with byAi). `reasons`: how many reasons it gave. */
export type AiGradeText = GradeText & { reasons: number };

/** Why the AI didn't grade, grouped the way the task page and the notifications say it. */
export type FallbackKey = 'QUOTA' | 'KEY' | 'LINKS_ONLY' | 'UNREADABLE' | 'ERROR' | 'LIMIT';

export const aiZh = {
  provider: { GEMINI: 'Gemini', CLAUDE: 'Claude', OPENAI: 'OpenAI' } as PerProvider,
  company: { GEMINI: 'Google', CLAUDE: 'Anthropic', OPENAI: 'OpenAI' } as PerProvider,
  /** 「✨ AI 写的」 next to 怎么做 and the checklist (gone once someone edits them). */
  tag: '✨ AI 写的',

  me: {
    title: 'AI key',
    providers: 'AI 平台',
    providerSub: { GEMINI: '推荐 · 有免费额度', CLAUDE: '测试版', OPENAI: '测试版' } as PerProvider,
    chipEmpty: '还没填',
    chipOk: '✓ 能用',
    intro: '有了 AI，才能拆得细、认出选择题、写「怎么做」、自动审核交上来的作业。',
    keyLabel: (provider: string) => `${provider} API key`,
    placeholder: {
      GEMINI: '粘贴你从 AI Studio 复制的 key',
      CLAUDE: '粘贴你的 key（sk-ant- 开头）',
      OPENAI: '粘贴你的 key（sk- 开头）',
    } as PerProvider,
    getKey: '怎么拿免费的 Gemini key？（约 2 分钟）',
    getKeyShort: '怎么拿免费的 Gemini key？',
    privacy: {
      GEMINI: '用免费的 Gemini：Google 可能会拿你们交上来的内容去改进模型，也可能有人工看到。要满 18 岁才能用。不要交有身份证号、电话、住址这类个人资料的文件。',
      CLAUDE: '用 Claude：你们交上来的内容会发给 Anthropic 处理。要满 18 岁才能用。不要交有身份证号、电话、住址这类个人资料的文件。',
      OPENAI: '用 OpenAI：你们交上来的内容会发给 OpenAI 处理。要满 18 岁才能用。不要交有身份证号、电话、住址这类个人资料的文件。',
    } as PerProvider,
    adult: '我满 18 岁，也知道上面这些',
    save: '保存并检查',
    saved: 'key 能用，已经存好了',
    /** 「你当组长的 2 个项目都用它：CS302、MKT201」 */
    ledProjects: (n: number, tags: string) => `你当组长的 ${n} 个项目都用它：${tags}`,
    tagSep: '、',
    onePerAccount: (led: string | null) =>
      led
        ? `一个帐号只存一把。存在你的帐号上，${led}；以后当组长的新项目也会自动用。存好之后连你自己也只看得到最后 4 位。`
        : '一个帐号只存一把。存在你的帐号上，以后你当组长的项目都会自动用。存好之后连你自己也只看得到最后 4 位。',
    withoutKey: '不填也能用：会用免费规则拆任务，比较粗糙，交上来的文件要你自己评。',
    checked: (when: string) => `上次检查：${when} · 只显示最后 4 位`,
    usageTitle: '今天用了多少（你当组长的项目加起来）',
    usageGood: '好模型（审核作业、拆任务）',
    usageLight: '轻量模型（写「怎么做」，好模型用完时接手）',
    usageCount: (used: number, limit: number | null) => (limit === null ? `${used} 次` : `${used} / 约 ${limit} 次`),
    /** Gemini resets at midnight Pacific (15:00 or 16:00 in Malaysia). */
    resetGemini: '每天下午 3 点左右重置。',
    resetAt: (time: string) => `每天 ${time} 左右重置。`,
    chainHint: '审核作业和拆任务用比较好的模型，它今天的次数用完或太忙时改用轻量模型接着做；两种都用完，交上来的作业改由你评。',
    limitsHint: (perProject: number, perTask: number) => `另外每个项目每天最多审核 ${perProject} 次、每个任务每天最多 ${perTask} 次。`,
    replace: '换一把',
    cancelReplace: '先不换',
    delete: '删除',
    deleteHint: (led: string | null) =>
      led ? `${led}。删除后这些项目改用免费规则，交上来的文件要你自己评。` : '删除后你当组长的项目改用免费规则，交上来的文件要你自己评。',
    deleteTitle: '删除这把 AI key？',
    deleteBody: '删除后你当组长的项目改用免费规则拆任务，交上来的作业改由你评。之后可以再填一把。',
    deleted: '已删除 AI key',
    invalidTitle: '❌ 这把 key 不能用',
    invalidCheck: (when: string, company: string) => `${when} 检查失败：${company} 说这把 key 无效（可能被删了或过期了）`,
    nowLabel: '现在会怎样',
    invalidNow: ['交上去的作业改由你评，会进项目页的「待我审核」。', '新建项目、加任务改用免费规则拆，比较粗糙。'],
    fixLabel: '怎么修',
    invalidFix: {
      GEMINI: '去 Google AI Studio 重新拿一把 key，贴到这里。',
      CLAUDE: '去 Anthropic 的控制台重新拿一把 key，贴到这里。',
      OPENAI: '去 OpenAI 的控制台重新拿一把 key，贴到这里。',
    } as PerProvider,
    replaceKey: '换一把 key',
    quotaTitle: '⏳ 今天的额度用完了',
    quotaLine: (usage: string) => `key 没问题 · 审核作业 ${usage}（好模型和轻量模型都用完了）`,
    quotaNow: (when: string) => ['今天交上去的作业改由你评，会进「待我审核」。', `${when}额度恢复，之后交的又会自动用 AI 审核。`],
    whatLabel: '怎么办',
    quotaWhat: (company: string) => ['什么都不用做，等额度恢复就好。', `常常不够用？可以在 ${company} 那边开通付费，或换一把有付费额度的 key。`],
    /** When the quota comes back: Gemini 「下午 3 点左右」, others at the time resetsAt says. */
    backGemini: '下午 3 点左右',
    backAt: (time: string) => `${time} 左右`,
  },

  project: {
    title: 'AI',
    chipOk: '✓ 能用',
    chipInvalid: '❌ key 不能用',
    chipQuota: '⏳ 今天额度用完了',
    chipNone: '没有 AI',
    chipSet: (provider: string) => `${provider} · 已设置`,
    usesYourKey: (provider: string) => `用你帐号上的 ${provider} key`,
    reviewedToday: '这个项目今天审核了',
    count: (n: number, max: number) => `${n} / ${max} 次`,
    limitHint: (perTask: number, reset: string) => `每个任务每天最多审核 ${perTask} 次。${reset}`,
    goMe: '去「我」页换 key',
    memberLine: (leader: string, n: number, max: number) => `用的是组长 ${leader} 的 key。这个项目今天审核了 ${n} / ${max} 次。`,
    privacy: {
      GEMINI: '这个项目用免费的 Gemini 审核，内容可能被 Google 用来改进模型。',
      CLAUDE: '这个项目用 Claude 审核，内容会发给 Anthropic 处理。',
      OPENAI: '这个项目用 OpenAI 审核，内容会发给 OpenAI 处理。',
    } as PerProvider,
    none: '组长还没填 AI key，现在用免费规则：拆任务比较粗糙，文件要组长手动评。',
    noneLeader: '你还没填 AI key，现在用免费规则：拆任务比较粗糙，交上来的文件要你自己评。',
    fillKey: '去「我」页填 key',
    leaderChange: '换了组长，就改用新组长帐号上的 key；新组长也没填，就用免费规则。',
    invalidLeader: '这把 key 不能用了，交上来的作业先改由你评。去「我」页换一把就会恢复。',
    invalidMember: '组长的 key 现在不能用，交上来的作业先改由组长评。',
    quotaLeader: '今天的额度用完了，交上来的作业先改由你评；额度恢复后又会自动用 AI 审核。',
    quotaMember: '组长的 key 今天的额度用完了，交上来的作业先改由组长评。',
  },

  reading: {
    titlePre: 'AI 正在',
    titleHl: '划重点',
    titlePost: '…',
    label: 'AI 读作业的进度',
    readFile: (name: string, lines: number | null) => (lines ? `读完「${name}」（${lines} 行）` : `读完「${name}」`),
    readText: '读完你写的描述',
    tasks: '找出要做的事',
    tasksDone: (n: number) => `找出要做的事：${n} 件，分数加起来 100`,
    choices: '认出选择题',
    choicesDone: (n: number) => (n > 0 ? `认出 ${n} 道选择题` : '没有选择题'),
    estimate: '估工作量和截止日期',
    estimateDone: (hours: number | null) => (hours ? `估好工作量和截止日期：约 ${hours} 小时` : '估好工作量和截止日期'),
    running: (text: string) => `${text}…`,
    hint: (provider: string) => `用你帐号上的 ${provider}，一般 1 分钟内读完。`,
    queued: (seconds: number) => `在排队：你的 key 这一分钟能用的次数到了，大约 ${seconds} 秒后开始。`,
    useRules: '不等了，改用免费规则',
    rulesHint: '免费规则拆得比较粗糙，也认不出选择题。',
    loadFailed: '暂时看不到 AI 的进度，稍后会自动再试。',
  },

  failed: {
    title: 'AI 这次没拆完',
    quota: (provider: string) => `⏳ 你的 ${provider} 今天的额度用完了`,
    quotaBody: (when: string) => `${when}恢复。作业说明已经传好了，不用再传一次。`,
    invalid: (provider: string) => `❌ 你的 ${provider} key 不能用了`,
    invalidBody: '去「我」页换一把能用的 key，再回来按「再试一次」。作业说明已经传好了，不用再传一次。',
    noKey: '❌ 你的 AI key 已经删掉了',
    noKeyBody: '去「我」页填一把 key，再回来按「再试一次」。作业说明已经传好了，不用再传一次。',
    error: '⚠️ AI 这次出错了',
    errorBody: '试了几次都没成功，可能是 AI 那边太忙。作业说明已经传好了，不用再传一次。',
    goMe: '去「我」页换 key',
    label: '接下来怎么办',
    retry: '🔁 再试一次',
    retrySub: '额度还没恢复的话，可能还是不行',
    retrySubError: '再请 AI 读一次作业说明',
    rules: '📏 改用免费规则拆',
    rulesSub: '马上就好，但拆得比较粗糙、认不出选择题，交上来的文件要你自己评',
    manual: '✍️ 手动建任务',
    manualSub: '自己一条条写要做的事、分数和截止日期',
    go: { retry: '再试一次', rules: '改用免费规则拆', manual: '手动建任务' },
  },

  choice: {
    no: (i: number, n: number) => `选择题 ${i} / ${n}`,
    titlePre: '作业说「',
    titlePost: '」',
    quote: (q: string) => `原文：「${q}」`,
    recPick: (keys: string, hours: string, least: boolean) =>
      `AI 只看工作量、资料多少和难度，推荐 ${keys}（加起来约 ${hours} 小时${least ? '，最省力' : ''}）。你是组长，不一定要听 AI 的。`,
    recMethod: (label: string, least: boolean) =>
      `AI 只看工作量、资料多少和难度，推荐 ${label}${least ? '（工作量最少）' : ''}。整组只选一种。`,
    keysJoin: ' + ',
    optionName: (key: string, label: string) => `${key}. ${label}`,
    hours: (h: string) => `⏱ 约 ${h} 小时`,
    load: (h: string) => `⏱ 工作量 约 ${h} 小时`,
    material: { LOW: '📚 资料少', MID: '📚 资料中', HIGH: '📚 资料多' } as Levels,
    difficulty: { LOW: '难度低', MID: '难度中', HIGH: '难度高' } as Levels,
    recommended: '✨ AI 推荐',
    pros: '优点',
    cons: '缺点',
    picked: '已选',
    count: (n: number, k: number) => `${n} / ${k}`,
    nextMethod: '下一题：选一种做法',
    nextPick: (k: number) => `下一题：任选 ${k} 个`,
    confirm: '确认，拆任务',
    pickHint: (k: number, last: boolean) => `要刚好选 ${k} 个才能${last ? '确认' : '下一题'}。确认后还能改选（有人开始做的就不能换掉）。`,
    confirmHint: (n: number) =>
      n > 1
        ? `${n === 2 ? '两' : n} 题都确认了，AI 才按你选的拆任务。之后还能在项目页改选。`
        : '确认了，AI 才按你选的拆任务。之后还能在项目页改选。',
  },

  plan: {
    sub: 'AI 按作业要求拆好了。点任务可以改名称、类型、分数和截止日期，往左滑可以删除。',
    found: (n: number) => `AI 找出 ${n} 件要做的事，已换算成加起来 100 分。`,
  },

  /** 让 AI 重新拆 (resplit.zh.ts). */
  resplit: resplitZh,

  rechoose: {
    tool: '改选',
    questionLabel: '改哪一题',
    questionN: (i: number) => `第 ${i} 题`,
    title: (prompt: string) => `改选：${prompt}`,
    now: (keys: string) => `现在选的是 ${keys}。有人已经开始做的选项不能换掉。`,
    locked: (name: string) => `🔒 ${name} 已开始，不能换掉`,
    lockedNoName: '🔒 已经有人开始了，不能换掉',
    drop: '取消',
    add: '新选',
    others: (keys: string) => `看别的选项（${keys}）`,
    keySep: '、',
    changes: '会有这些变化',
    removeLead: (n: number) => `删掉 ${n} 个没开始的任务：`,
    removeTail: (pts: string) => `（共 ${pts} 分）`,
    addLead: (n: number) => `加 ${n} 个新任务：`,
    addOwner: (name: string) => `，放回原来的包，还是 ${name} 负责`,
    addOwners: '，放回原来的包，负责人不变',
    addFree: '，放进还没人选的任务包',
    quoted: (title: string) => `「${title}」`,
    rescalePre: '分数按工作量比例重新换算，其余任务会跟着微调一点，',
    rescaleB: '总分还是 100',
    rescalePost: '。',
    notify: '全组收到通知。',
    unchanged: '和现在选的一样，不会有变化。',
    wrongCount: (k: number) => `要刚好选 ${k} 个。`,
    confirm: '确认改选',
    done: '已改选，全组会收到通知',
  },

  howto: {
    title: '怎么做',
    edit: '编辑',
    hintAi: 'AI 按作业要求写的，只是建议。组长和负责人都能改。',
    hint: '组长和负责人都能改，全组都看得到。',
    empty: '还没有「怎么做」，写几步给负责人参考。',
    sheetTitle: '怎么做',
    step: (n: number) => `第 ${n} 步`,
    add: '+ 加一步',
    max: (n: number) => `最多 ${n} 步`,
    remove: '删除这一步',
    save: '保存',
    saved: '「怎么做」已保存',
  },

  checklistHint: 'AI 按作业要求先写好；组长和负责人都能改，全组都看得到。AI 审核时也对照这份清单。',

  evidence: {
    privacy: {
      GEMINI: '这个项目用免费的 Gemini 审核，内容可能被 Google 用来改进模型。不要交有身份证号、电话这类个人资料的文件。',
      CLAUDE: '这个项目用 Claude 审核，内容会发给 Anthropic 处理。不要交有身份证号、电话这类个人资料的文件。',
      OPENAI: '这个项目用 OpenAI 审核，内容会发给 OpenAI 处理。不要交有身份证号、电话这类个人资料的文件。',
    } as PerProvider,
    submit: '我做完了，交给 AI 审核',
    submitHint: (n: number) => `AI 对照作业要求和上面的清单评级，一般 1 分钟内。今天这个任务还能 AI 审核 ${n} 次。`,
    limitHint: '今天 AI 审核次数用完了，改由组长评。按了之后组长会收到通知；交上去的文件全组都能看。',
    submitted: '已交给 AI 审核，一般 1 分钟内评好',
  },

  reviewing: {
    chip: 'AI 审核中',
    emoji: '✨',
    title: 'AI 正在审核，一般 1 分钟内',
    hintMine: '对照作业要求和「做到这些才算完成」在看。可以先离开，评好了会通知你。',
    hintOthers: '对照作业要求和「做到这些才算完成」在看。评好了这里会显示等级和理由。',
    left: (n: number, max: number) => `今天这个任务还能审核 ${n} 次（每个任务每天最多 ${max} 次）。`,
  },

  result: {
    by: (model: string, when: string, no: number) => `AI 审核 · ${model} · ${when} · 评的是第 ${no} 次`,
    reasons: 'AI 的理由（对照作业要求）',
    suggestions: '怎么改才能拿满',
    summary: 'AI 的总结',
    redo: '改好重交',
    shared: '理由和建议全组都看得到。',
    left: (n: number) => `今天这个任务还能 AI 审核 ${n} 次`,
    keep: (pts: string) => `；重交期间 ${pts} 分不变`,
    end: '。',
    overrideTitle: '你是组长',
    overrideHint: '觉得 AI 评错了？可以推翻，要写理由，全组都看得到。',
    overrideMember: (leader: string) => `觉得 AI 评错了？组长 ${leader} 可以推翻。`,
  },

  fallback: {
    title: {
      QUOTA: (leader: string) => `AI 今天审核不了（额度用完），已经交给组长 ${leader} 评`,
      KEY: (leader: string) => `AI 这次没审成（组长的 key 有问题），已经交给组长 ${leader} 评`,
      LINKS_ONLY: (leader: string) => `只交了链接，AI 打不开链接，已经交给组长 ${leader} 评`,
      UNREADABLE: (leader: string) => `AI 读不了交上来的文件，已经交给组长 ${leader} 评`,
      ERROR: (leader: string) => `AI 这次出错了，已经交给组长 ${leader} 评`,
      LIMIT: (leader: string) => `今天 AI 审核次数用完了，改由组长 ${leader} 评`,
    } as Record<FallbackKey, (leader: string) => string>,
    bodyMine: '你不用重交，也不用再做什么。组长评好了会通知你。截止前交了就不算过期。',
    bodyOthers: '组长评好后，这里会显示等级和理由。',
    /** The leader's 等你评级 card says why the AI didn't. */
    leader: {
      QUOTA: '你的 key 今天的额度用完了，AI 没审成，改由你评。',
      KEY: '你的 key 有问题，AI 没审成，改由你评。去「我」页检查 key。',
      LINKS_ONLY: '只交了链接，AI 打不开链接，改由你评。',
      UNREADABLE: 'AI 读不了交上来的文件，改由你评。',
      ERROR: 'AI 这次出错了，改由你评。',
      LIMIT: '今天 AI 审核次数用完了，改由你评。',
    } as Record<FallbackKey, string>,
    /** 待我审核 row chip. */
    chip: {
      QUOTA: 'AI 额度用完',
      KEY: 'AI key 有问题',
      LINKS_ONLY: '只交了链接',
      UNREADABLE: 'AI 读不了',
      ERROR: 'AI 没审成',
      LIMIT: 'AI 次数用完',
    } as Record<FallbackKey, string>,
  },

  notifs: {
    /** Meta line of AI_KEY_PROBLEM (it isn't about one project). */
    allLed: '所有你当组长的项目',
    graded: (g: AiGradeText): InlinePart[] => {
      const word = labelsZh.grade[g.grade];
      const why = g.reasons > 0 ? `有 ${g.reasons} 条理由和怎么改才能拿满。` : '理由在任务页。';
      if (!g.counting) return [`第 ${g.no} 次：AI 评了你的「${g.title}」：`, { b: word }, `，仍按之前的 ${g.earned} 分。${why}`];
      const prefix = g.no > 1 ? `第 ${g.no} 次：` : '';
      if (isFull(g.grade)) return [`${prefix}AI 评了你的「${g.title}」：`, { b: word }, `，拿满 ${g.pts} 分。`];
      const gain = g.grade === 'HALF' ? `现在拿 ${g.earned} 分` : '0 分，改好可以重交';
      return [`${prefix}AI 评了你的「${g.title}」：`, { b: word }, `，${gain}。${why}`];
    },
    reviewFailed: {
      QUOTA: (provider: string, name: string | null, title: string): InlinePart[] =>
        name ? [`你的 ${provider} key 今天的额度用完了，`, { b: name }, ` 的「${title}」改由你评。`] : [`你的 ${provider} key 今天的额度用完了，「${title}」改由你评。`],
      INVALID: (provider: string, name: string | null, title: string): InlinePart[] =>
        name ? [`你的 ${provider} key 不能用了，`, { b: name }, ` 的「${title}」改由你评。`] : [`你的 ${provider} key 不能用了，「${title}」改由你评。`],
      NO_KEY: (name: string | null, title: string): InlinePart[] =>
        name ? ['你的 AI key 已经删掉了，', { b: name }, ` 的「${title}」改由你评。`] : [`你的 AI key 已经删掉了，「${title}」改由你评。`],
      LINKS_ONLY: (title: string): InlinePart[] => [`「${title}」只交了链接，AI 看不了，改由你评。`],
      UNREADABLE: (name: string | null, title: string): InlinePart[] =>
        name ? ['AI 读不了 ', { b: name }, ` 交的「${title}」，改由你评。`] : [`AI 读不了「${title}」交上来的文件，改由你评。`],
      LIMIT: (name: string | null, title: string): InlinePart[] =>
        name ? ['今天 AI 审核次数用完了，', { b: name }, ` 的「${title}」改由你评。`] : [`今天 AI 审核次数用完了，「${title}」改由你评。`],
      OTHER: (name: string | null, title: string): InlinePart[] =>
        name ? ['AI 这次没审成，', { b: name }, ` 的「${title}」改由你评。`] : [`AI 这次没审成，「${title}」改由你评。`],
    },
    keyQuota: (provider: string, when: string | null): InlinePart[] => [
      `你的 ${provider} key 今天的额度用完了${when ? `，${when}恢复` : ''}。交上来的作业先改由你评。`,
    ],
    keyInvalid: (provider: string, company: string): InlinePart[] => [
      `你的 ${provider} key 不能用了（${company} 说无效）。交上来的作业先改由你评，换一把 key 就会恢复 AI 审核。`,
    ],
    choiceChanged: (prompt: string, from: string, to: string, removed: number, added: number): InlinePart[] => [
      `组长改选了「${prompt}」：`,
      { b: `${from} 换成 ${to}` },
      removed > 0 || added > 0
        ? `。「${from}」的 ${removed} 个任务删掉了，换成「${to}」的 ${added} 个，分数重新换算，总分还是 100。`
        : '。分数重新换算，总分还是 100。',
    ],
    labelSep: '、',
  },

  feed: {
    CHOICE_CHANGED: (a: Who, prompt: string, from: string, to: string): Inline[] => [
      { b: who(a) },
      ` 改选了「${prompt}」：${from} 换成 ${to}`,
    ],
    GRADED_AI: (owner: Who, title: string, grade: string): Inline[] => [{ b: 'AI' }, ' 评了 ', { b: who(owner) }, ` 的「${title}」：${grade}`],
    TASKS_RESPLIT: resplitZh.feed,
    labelSep: '、',
  },
};
