// Copy for the leader's grading sheets (评级、代为完成、推翻评级; owned by app-leader, M4).

/** A Latin name before Chinese text gets a space (Ahmad Faizal 会收到通知), a Chinese one doesn't (林晓雯会收到通知). */
const nm = (name: string) => (/[A-Za-z0-9.)]$/.test(name) ? `${name} ` : name);

export const gradeZh = {
  /** Sheet title (board 10 / 11). */
  title: (title: string) => `评级：${title}`,
  /** Under the title: who handed in what, when (board 10). */
  line: (name: string, when: string, n: number, due: string) => `${name} · 交于 ${when} · ${n} 份 · 截止 ${due}`,
  late: '迟交',
  level: '等级',
  /** The sub-line of each level button. */
  full: (pts: string) => `拿满 ${pts} 分`,
  half: (pts: string) => `拿一半分 · ${pts} 分`,
  fail: '0 分，要重交',
  reason: '理由',
  reasonSmall: '· 评「拿一半」或「不通过」必须写理由',
  reasonPlaceholder: '对照作业要求：哪里没做到、少了什么',
  submit: '确定评级',
  /** Toast. `Quiet`: the owner gets no notification (their own task, or they left). */
  done: (name: string) => `已评级，${nm(name)}会收到通知`,
  doneQuiet: '已评级',
  hint: (name: string) => `理由全组都看得到；${nm(name)}会收到通知。`,
  hintQuiet: '理由全组都看得到。',

  /** 代为完成并评级 (board 11): the owner gave the leader the evidence outside the app. */
  outside: {
    line: (name: string, due: string) => `${name} · 截止 ${due}`,
    empty: (n: number, max: number) => `TA 还没在 App 里交证据 · ${n} / ${max} 份`,
    toggle: '证据在 App 外交给我了（组长代为完成）',
    toggleSmall:
      'TA 私下（WhatsApp 等）把证据给了你时打开。任务会标成完成，任务页写「组长代为完成 · 证据在 App 外交了」，TA 会收到通知，分数照算。',
    note: '说明',
    noteSmall: '· 选填，全组都看得到',
    submit: '标完成并评级',
    done: (name: string) => `已标完成，${nm(name)}会收到通知`,
    doneQuiet: '已标完成',
    hint: (name: string) => `说明和等级全组都看得到；${nm(name)}会收到通知。`,
    hintQuiet: '说明和等级全组都看得到。',
  },

  /** 推翻评级 (board 13). */
  override: {
    title: (title: string) => `推翻评级：${title}`,
    /** `no`: the attempt's number, only when the task has several attempts. */
    now: (grade: string, gain: string, no: number | null) => `现在：${grade} · ${gain}${no ? ` · 第 ${no} 次` : ''}`,
    gainFull: (pts: string) => `拿满 ${pts} 分`,
    gainHalf: (pts: string) => `${pts} 分`,
    gainFail: '0 分',
    /** The live override on this attempt. `who`: null = the viewer. */
    by: (who: string | null, date: string, from: string, to: string) =>
      `${who === null ? '你' : nm(who)}在 ${date} 从「${from}」推翻成「${to}」`,
    undo: '撤销上次推翻',
    undone: (grade: string) => `已撤销推翻，回到「${grade}」`,
    to: '改成',
    current: '现在就是这个',
    reason: '理由',
    reasonSmall: '· 必填',
    /** `name`: null when nobody is notified (own task, or the owner left); `earned`: null until a level is picked. */
    hint: (name: string | null, earned: string | null) =>
      `四个等级都能改，往下改也可以。推翻后全组都看得到你的理由${name ? `，${nm(name)}会收到通知` : ''}${
        earned ? `，分数改成 ${earned} 分` : ''
      }；改错了可以撤销。会先让你再确认一次。`,
    submit: '确定推翻',
    confirmTitle: (to: string) => `推翻成「${to}」？`,
    confirmBody: (name: string) => `${nm(name)}会收到通知，全组都看得到你的理由。`,
    confirmBodyQuiet: '全组都看得到你的理由。',
    confirm: '确定推翻',
    done: (name: string, earned: string) => `已推翻，${nm(name)}拿 ${earned} 分`,
    doneYou: (earned: string) => `已推翻，你拿 ${earned} 分`,
    /** The task has no owner any more (a leaver's released task). */
    doneQuiet: '已推翻',
  },
};
