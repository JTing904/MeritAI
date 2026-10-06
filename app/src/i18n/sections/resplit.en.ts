import type { InlinePart } from './home.zh';
import type { Inline, Who } from './project.zh';
import type { resplitZh } from './resplit.zh';

const subj = (w: Who) => (w.you ? 'You' : w.name);
const tasks = (n: number) => (n === 1 ? '1 task' : `${n} tasks`);

export const resplitEn: typeof resplitZh = {
  tool: '✨ Let the AI split again',
  noKey: 'Splitting again with the AI needs an AI key.',
  noKeyLink: 'Add one on the Me page ›',
  invalid: (provider) => `Your ${provider} key doesn't work any more. Replace it and try again.`,
  invalidLink: 'Replace it on the Me page ›',

  sheet: {
    title: "Let the AI split the tasks nobody started",
    body: (kept, replace): InlinePart[] => [
      'Tasks already started, handed in or done ',
      { b: `(${kept}) stay as they are` },
      '; the AI splits ',
      { b: `the ${replace} not started yet` },
      " again from the brief. You see the result first, and nothing changes until you confirm.",
    ],
    briefLabel: 'Which brief the AI reads',
    saved: 'The current one',
    savedSub: (file, date, fromResplit) => `${file ?? 'Typed in'} · ${fromResplit ? 'put in by a re-split on' : 'uploaded with the project on'} ${date}`,
    fresh: 'A new one',
    freshSub: 'Got a new version from the lecturer? Upload a file or type it',
    upload: 'Upload a file',
    typeIt: 'Type it',
    pickAgain: 'Pick another file',
    pickFirst: 'Pick a file first.',
    picked: (size) => (size ? `Ready · ${size}` : 'Ready'),
    textLabel: 'The new brief',
    textPlaceholder: 'Paste the new brief here',
    quota: (provider, used, limit) =>
      `Uses the ${provider} key on your account and usually takes under a minute. Each run uses 1–3 of the smart model's daily quota (${limit ? `${used} / about ${limit} used today` : `${used} used today`}).`,
    start: 'Split again',
    pending: "The last result hasn't been confirmed yet; splitting again replaces it.",
    running: 'The AI is splitting again right now; starting over stops that run.',
    look: 'Take a look',
    tooLarge: (max) => `The file is too large (at most ${max}).`,
    unreadable: {
      TOO_LARGE: 'The file is too large (at most 10 MB).',
      EMPTY: 'This brief is empty.',
      UNSUPPORTED_TYPE: "This kind of file can't be read. Use a PDF, Word file, image or text.",
      UNREADABLE: "The AI can't read this file. Use a PDF, Word file, image or text.",
      NO_STRUCTURE: "The AI can't read this file. Use a PDF, Word file, image or text.",
    },
  },

  screen: {
    title: 'Split again with AI',
    sub: (tag) => `${tag} · only you see this`,
    loadFailed: "Can't see the AI's progress right now; trying again shortly.",
  },

  reading: {
    titlePre: 'The AI is ',
    titleHl: 'splitting again',
    titlePost: '…',
    label: "The AI's progress",
    readFile: (name, lines) => (lines ? `Read "${name}" (${lines} lines)` : `Read "${name}"`),
    readText: (lines) => (lines ? `Read the brief (${lines} lines)` : 'Read the brief'),
    keep: (n) => (n > 0 ? `Keeping ${tasks(n)} already started` : 'No task started yet'),
    split: 'Splitting the rest that nobody started…',
    match: 'Matching the choice questions',
    place: 'Putting the tasks into packages',
    hint: "Members still see the old tasks. You can leave; you'll be told when it's ready.",
    queued: (seconds) => `Queued: your key's per-minute limit was reached; starting in about ${seconds} s.`,
    stop: 'Stop',
    stopped: 'Stopped; nothing changed',
  },

  failed: {
    title: "The AI couldn't split it this time",
    quota: (provider) => `⏳ Your ${provider} quota is used up for today`,
    quotaBody: (when) => `It comes back ${when}; try again then.`,
    invalid: (provider) => `❌ Your ${provider} key doesn't work any more`,
    invalidBody: 'Replace the key on the Me page, then come back and tap Try again.',
    noKey: '❌ Your AI key was removed',
    noKeyBody: 'Add a key on the Me page, then come back and tap Try again.',
    error: '⚠️ The AI ran into an error',
    errorBody: 'It failed a few times; the AI service may be busy.',
    nothing: 'Nothing changed: members still see the old tasks.',
    goMe: 'Go to Me',
    retry: 'Try again',
    close: 'Close',
  },

  question: {
    no: (i, n) => `New choice question ${i} / ${n}`,
    titlePre: 'The new brief has one more: ',
    kept: (prompt, keys) => `The existing question "${prompt}" keeps your pick ${keys}; no need to choose again.`,
    rec: (key) => `The AI looks only at workload, material and difficulty and suggests ${key}.`,
    next: 'Next question',
    review: 'Next: see the new tasks',
    hint: 'You can still change it later with "Change picks" in the leader tools.',
  },

  review: {
    titlePre: 'Is this ',
    titleHl: 'split right?',
    sub: "Not confirmed yet: members still see the old tasks. Tap a task to change it, swipe left to delete it.",
    subWeb: 'Not confirmed yet: members still see the old tasks. Tap a task to change or delete it.',
    kept: 'Stay as they are',
    removed: 'Not started, deleted',
    added: 'New from the AI',
    keptH: (n) => `Staying · ${n} already started`,
    all: 'See all',
    fold: 'Show less',
    unchanged: '🔒 Unchanged',
    addedH: (n) => `New from the AI · ${n}`,
    pkgHead: (i, name) => (name ? `Package ${i} · ${name}` : `Package ${i} · not picked yet`),
    noPkg: 'In no package',
    plus: (pts) => `+${pts} pts`,
    rowMeta: (pts, due) => `${pts} pts · due ${due}`,
    rowMetaNoDue: (pts) => `${pts} pts · project deadline`,
    byYou: 'Added by you',
    moreNew: (pkgs, n) => `Packages ${pkgs} have ${tasks(n)} more (show).`,
    pkgSep: ', ',
    add: '+ Add a task',
    removedH: (n) => `Deleted · ${n} not started`,
    removedRow: (title, pts) => `${title} · ${pts} pts`,
    more: (n) => `${n} more…`,
    pkgsH: "How the packages' points change",
    free: 'Not picked yet',
    change: (a, b) => `${a} → ${b}`,
    chgTitle: 'When you confirm',
    chgSwap: (removed, added) =>
      `The ${tasks(removed)} nobody started are deleted and replaced by the AI's ${added} new ones, each in its package; nobody who picked a package has to pick again.`,
    chgPointsKept: 'The kept tasks keep their points and the new ones share the rest; ',
    chgPointsMoved: 'You changed some points, so everything is rescaled by workload and the kept tasks move a little too; ',
    chgPointsB: 'the total stays 100',
    chgPointsPost: '.',
    chgKept: (prompt, keys) => `The existing question "${prompt}" keeps your pick ${keys}.`,
    chgNew: (prompt, labels) => `New question "${prompt}": ${labels}.`,
    chgNotify: 'The whole group is told.',
    keysJoin: ' + ',
    labelSep: ', ',
    confirm: 'Confirm, use the new tasks',
    discard: 'No thanks, keep it as it is',
    done: 'Done; the group will be told',
    discarded: 'Kept as it is; nothing changed',
    stale: 'Someone just started a task; the result was worked out again for the project as it is now. Have another look.',
    deleted: (title) => `Deleted "${title}"`,
  },

  edit: {
    editTitle: 'Edit task',
    addTitle: 'Add a task',
    delete: 'Delete this task',
    hint: 'Points are rescaled with the other tasks; the total stays 100.',
  },

  none: {
    title: 'Nothing waiting for you',
    body: 'It may already be applied, or you kept things as they were.',
    back: 'Back to the project',
  },

  notifs: {
    ready: (): InlinePart[] => ['The AI finished splitting again. Take a look and decide whether to switch.'],
    failed: {
      QUOTA: (provider): InlinePart[] => [`Your ${provider} key's quota is used up for today, so the AI couldn't split again. Nothing changed.`],
      INVALID: (provider): InlinePart[] => [`Your ${provider} key doesn't work any more, so the AI couldn't split again. Nothing changed.`],
      NO_KEY: (): InlinePart[] => ["Your AI key was removed, so the AI couldn't split again. Nothing changed."],
      OTHER: (): InlinePart[] => ["The AI couldn't split again this time. Nothing changed."],
    },
    group: (leader, kept, removed, added): InlinePart[] => [
      { b: leader },
      ` had the AI split the unstarted tasks again: ${kept} kept, ${removed} not started replaced, ${added} new.`,
    ],
    mine: (leader, pkg, removed, added, pts): InlinePart[] => [
      { b: leader },
      ` had the AI split the unstarted tasks again. Your package ${pkg}: ${removed} removed, ${added} added, now ${pts} pts.`,
    ],
  },

  feed: (a: Who, kept, removed, added): Inline[] => [
    { b: subj(a) },
    ` had the AI split the tasks again: ${kept} kept, ${removed} not started replaced, ${added} new`,
  ],
};
