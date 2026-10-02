import type { aiZh, AiGradeText, FallbackKey } from './ai.zh';
import type { InlinePart } from './home.zh';
import { labelsEn } from './labels.en';
import type { Inline, Who } from './project.zh';

const subj = (w: Who) => (w.you ? 'You' : w.name);
const possessive = (w: Who) => (w.you ? 'your' : `${w.name}'s`);
const isFull = (g: AiGradeText['grade']) => g === 'EXCELLENT' || g === 'PASS';
const times = (n: number) => (n === 1 ? '1 time' : `${n} times`);
const tasks = (n: number) => (n === 1 ? '1 task' : `${n} tasks`);

export const aiEn: typeof aiZh = {
  provider: { GEMINI: 'Gemini', CLAUDE: 'Claude', OPENAI: 'OpenAI' },
  company: { GEMINI: 'Google', CLAUDE: 'Anthropic', OPENAI: 'OpenAI' },
  tag: '✨ Written by AI',

  me: {
    title: 'AI key',
    providers: 'AI provider',
    providerSub: { GEMINI: 'Recommended · free tier', CLAUDE: 'Beta', OPENAI: 'Beta' },
    chipEmpty: 'Not added',
    chipOk: '✓ Working',
    intro: 'With AI, briefs are split in more detail, choice questions are spotted, "How to do it" is written for you and hand-ins are reviewed automatically.',
    keyLabel: (provider) => `${provider} API key`,
    placeholder: {
      GEMINI: 'Paste the key you copied from AI Studio',
      CLAUDE: 'Paste your key (starts with sk-ant-)',
      OPENAI: 'Paste your key (starts with sk-)',
    },
    getKey: 'How to get a free Gemini key (about 2 minutes)',
    getKeyShort: 'How to get a free Gemini key',
    privacy: {
      GEMINI: "Free Gemini: Google may use what your team hands in to improve its models, and people may read it. You must be 18 or older. Don't hand in files with ID numbers, phone numbers, addresses or other personal details.",
      CLAUDE: "Claude: what your team hands in is sent to Anthropic to process. You must be 18 or older. Don't hand in files with ID numbers, phone numbers, addresses or other personal details.",
      OPENAI: "OpenAI: what your team hands in is sent to OpenAI to process. You must be 18 or older. Don't hand in files with ID numbers, phone numbers, addresses or other personal details.",
    },
    adult: "I'm 18 or older and I understand the above",
    save: 'Save and check',
    saved: 'The key works and is saved',
    ledProjects: (n, tags) => `Used by the ${n === 1 ? 'project' : `${n} projects`} you lead: ${tags}`,
    tagSep: ', ',
    onePerAccount: (led) =>
      led
        ? `One key per account. It's kept on your account. ${led}; new projects you lead use it too. Once saved, even you only see its last 4 characters.`
        : "One key per account. It's kept on your account and every project you lead uses it. Once saved, even you only see its last 4 characters.",
    withoutKey: 'It works without one too: the free rules split the brief (roughly), and you grade the files handed in yourself.',
    checked: (when) => `Last checked: ${when} · only the last 4 characters are shown`,
    usageTitle: 'Used today (all the projects you lead)',
    usageGood: 'Better model (reviews, splitting)',
    usageLight: 'Light model ("How to do it", and backup when the better one runs out)',
    usageCount: (used, limit) => (limit === null ? times(used) : `${used} / about ${limit}`),
    resetGemini: 'Resets every day at about 3 pm (Malaysia time). ',
    resetAt: (time) => `Resets every day at about ${time}. `,
    chainHint:
      'Reviews and splitting use the better model; when it runs out for the day or is busy, the light model carries on. When both are used up, you grade the hand-ins yourself.',
    limitsHint: (perProject, perTask) => `Also at most ${perProject} reviews per project and ${perTask} per task each day.`,
    replace: 'Replace',
    cancelReplace: 'Keep the current key',
    delete: 'Delete',
    deleteHint: (led) =>
      led
        ? `${led}. After deleting, these projects use the free rules and you grade the files yourself.`
        : 'After deleting, the projects you lead use the free rules and you grade the files yourself.',
    deleteTitle: 'Delete this AI key?',
    deleteBody: 'The projects you lead go back to the free rules for splitting, and you grade the hand-ins. You can add a key again later.',
    deleted: 'AI key deleted',
    invalidTitle: "❌ This key doesn't work",
    invalidCheck: (when, company) => `Check failed ${when}: ${company} says the key is invalid (it may have been deleted or expired)`,
    nowLabel: 'What happens now',
    invalidNow: ['You grade the hand-ins; they appear in "Waiting for my review" on the project page.', 'New projects and new tasks are split with the free rules (roughly).'],
    fixLabel: 'How to fix it',
    invalidFix: {
      GEMINI: 'Get a new key in Google AI Studio and paste it here.',
      CLAUDE: 'Get a new key in the Anthropic console and paste it here.',
      OPENAI: 'Get a new key in the OpenAI dashboard and paste it here.',
    },
    replaceKey: 'Replace the key',
    quotaTitle: "⏳ Today's quota is used up",
    quotaLine: (usage) => `The key is fine · reviews ${usage} (both the better and the light model are used up)`,
    quotaNow: (when) => ['You grade what is handed in today; it appears in "Waiting for my review".', `The quota comes back ${when}; after that the AI reviews again.`],
    whatLabel: 'What to do',
    quotaWhat: (company) => ['Nothing: just wait for the quota to come back.', `Often not enough? Turn on paid usage with ${company}, or use a key with a paid quota.`],
    backGemini: 'at about 3 pm',
    backAt: (time) => `at about ${time}`,
  },

  project: {
    title: 'AI',
    chipOk: '✓ Working',
    chipInvalid: "❌ Key doesn't work",
    chipQuota: '⏳ Quota used up today',
    chipNone: 'No AI',
    chipSet: (provider) => `${provider} · set up`,
    usesYourKey: (provider) => `Uses the ${provider} key on your account`,
    reviewedToday: 'Reviews in this project today',
    count: (n, max) => `${n} / ${max}`,
    limitHint: (perTask, reset) => `At most ${perTask} reviews per task each day. ${reset}`,
    goMe: 'Change the key on the Me page',
    memberLine: (leader, n, max) => `Uses the key of the leader, ${leader}. Reviews in this project today: ${n} / ${max}.`,
    privacy: {
      GEMINI: 'This project is reviewed by the free Gemini; Google may use the content to improve its models.',
      CLAUDE: 'This project is reviewed by Claude; the content is sent to Anthropic to process.',
      OPENAI: 'This project is reviewed by OpenAI; the content is sent to OpenAI to process.',
    },
    none: "The leader hasn't added an AI key, so the free rules are used: splitting is rough and the leader grades files by hand.",
    noneLeader: "You haven't added an AI key, so the free rules are used: splitting is rough and you grade the files yourself.",
    fillKey: 'Add a key on the Me page',
    leaderChange: "If the leader changes, the new leader's key is used; if they have none, the free rules.",
    invalidLeader: "This key doesn't work any more, so you grade the hand-ins for now. Replace it on the Me page to bring the AI back.",
    invalidMember: "The leader's key doesn't work right now, so the leader grades the hand-ins.",
    quotaLeader: "Today's quota is used up, so you grade the hand-ins for now; the AI reviews again once it comes back.",
    quotaMember: "The leader's key has used up today's quota, so the leader grades the hand-ins for now.",
  },

  reading: {
    titlePre: 'The AI is ',
    titleHl: 'reading',
    titlePost: '…',
    label: 'How far the AI has got',
    readFile: (name, lines) => (lines ? `Read "${name}" (${lines} lines)` : `Read "${name}"`),
    readText: 'Read your description',
    tasks: 'Find what needs doing',
    tasksDone: (n) => `Found what needs doing: ${tasks(n)}, 100 points in all`,
    choices: 'Spot choice questions',
    choicesDone: (n) => (n > 0 ? `Spotted ${n === 1 ? '1 choice question' : `${n} choice questions`}` : 'No choice questions'),
    estimate: 'Estimate the work and due dates',
    estimateDone: (hours) => (hours ? `Estimated the work and due dates: about ${hours} hours` : 'Estimated the work and due dates'),
    running: (text) => `${text}…`,
    hint: (provider) => `Uses the ${provider} on your account. Usually done within a minute.`,
    queued: (seconds) => `Queued: your key reached its limit for this minute. Starting in about ${seconds} s.`,
    useRules: "Don't wait, use the free rules",
    rulesHint: "The free rules split roughly and can't spot choice questions.",
    loadFailed: "Can't see the AI's progress right now; trying again shortly.",
  },

  failed: {
    title: "The AI didn't finish",
    quota: (provider) => `⏳ Your ${provider} quota is used up for today`,
    quotaBody: (when) => `It comes back ${when}. The brief is already uploaded; no need to upload it again.`,
    invalid: (provider) => `❌ Your ${provider} key doesn't work any more`,
    invalidBody: 'Replace it with a working key on the Me page, then come back and tap Try again. The brief is already uploaded.',
    noKey: '❌ Your AI key was deleted',
    noKeyBody: 'Add a key on the Me page, then come back and tap Try again. The brief is already uploaded.',
    error: '⚠️ The AI ran into an error',
    errorBody: "It didn't work after a few tries; the AI service may be busy. The brief is already uploaded.",
    goMe: 'Change the key on the Me page',
    label: 'What next',
    retry: '🔁 Try again',
    retrySub: "If the quota isn't back yet, it may still fail",
    retrySubError: 'Ask the AI to read the brief again',
    rules: '📏 Split with the free rules',
    rulesSub: "Done at once, but rough, can't spot choice questions, and you grade the files yourself",
    manual: '✍️ Add tasks by hand',
    manualSub: 'Write each task, its points and due date yourself',
    go: { retry: 'Try again', rules: 'Split with the free rules', manual: 'Add tasks by hand' },
  },

  choice: {
    no: (i, n) => `Choice ${i} / ${n}`,
    titlePre: 'The brief says "',
    titlePost: '"',
    quote: (q) => `In the brief: "${q}"`,
    recPick: (keys, hours, least) =>
      `The AI only weighs workload, how much material there is and difficulty, and suggests ${keys} (about ${hours} hours together${least ? ', the least work' : ''}). You're the leader; you don't have to follow it.`,
    recMethod: (label, least) =>
      `The AI only weighs workload, how much material there is and difficulty, and suggests ${label}${least ? ' (the least work)' : ''}. The whole team picks one.`,
    keysJoin: ' + ',
    optionName: (key, label) => `${key}. ${label}`,
    hours: (h) => `⏱ about ${h} h`,
    load: (h) => `⏱ workload about ${h} h`,
    material: { LOW: '📚 little material', MID: '📚 some material', HIGH: '📚 lots of material' },
    difficulty: { LOW: 'easy', MID: 'medium', HIGH: 'hard' },
    recommended: '✨ AI suggests',
    pros: 'Pros',
    cons: 'Cons',
    picked: 'Picked',
    count: (n, k) => `${n} / ${k}`,
    nextMethod: 'Next: pick a method',
    nextPick: (k) => `Next: pick ${k}`,
    confirm: 'Confirm and split',
    pickHint: (k, last) =>
      `Pick exactly ${k} to ${last ? 'confirm' : 'go on'}. You can change it later (not the options someone already started).`,
    confirmHint: (n) =>
      n > 1
        ? `Once ${n === 2 ? 'both are' : `all ${n} are`} confirmed, the AI splits the tasks by what you picked. You can change your picks later on the project page.`
        : 'Once confirmed, the AI splits the tasks by what you picked. You can change your pick later on the project page.',
  },

  plan: {
    sub: 'The AI split the brief. Tap a task to change its name, kind, points or due date; swipe left to delete.',
    found: (n) => `The AI found ${tasks(n)}, scaled to 100 points in all.`,
  },

  rechoose: {
    tool: 'Change picks',
    questionLabel: 'Which question',
    questionN: (i) => `Question ${i}`,
    title: (prompt) => `Change picks: ${prompt}`,
    now: (keys) => `Picked now: ${keys}. Options someone already started can't be swapped out.`,
    locked: (name) => `🔒 ${name} started it; can't swap it out`,
    lockedNoName: "🔒 Someone started it; can't swap it out",
    drop: 'Dropped',
    add: 'New',
    others: (keys) => `See the other options (${keys})`,
    keySep: ', ',
    changes: 'What changes',
    removeLead: (n) => `Delete ${n === 1 ? '1 unstarted task' : `${n} unstarted tasks`}: `,
    removeTail: (pts) => ` (${pts} pts in all)`,
    addLead: (n) => `Add ${n === 1 ? '1 new task' : `${n} new tasks`}: `,
    addOwner: (name) => `, in the same package, still ${name}'s`,
    addOwners: ', in the same packages, same owners',
    addFree: ', in a package nobody picked yet',
    quoted: (title) => `"${title}"`,
    rescalePre: 'Points are rescaled by workload and the other tasks shift a little; ',
    rescaleB: 'the total stays 100',
    rescalePost: '.',
    notify: 'The whole team is notified.',
    unchanged: 'Same as now; nothing changes.',
    wrongCount: (k) => `Pick exactly ${k}.`,
    confirm: 'Confirm the change',
    done: 'Picks changed; the team is notified',
  },

  howto: {
    title: 'How to do it',
    edit: 'Edit',
    hintAi: 'Written by the AI from the brief; only a suggestion. The leader and the owner can change it.',
    hint: 'The leader and the owner can change it; everyone can see it.',
    empty: 'No "How to do it" yet. Write a few steps for the owner.',
    sheetTitle: 'How to do it',
    step: (n) => `Step ${n}`,
    add: '+ Add a step',
    max: (n) => `At most ${n} steps`,
    remove: 'Remove this step',
    save: 'Save',
    saved: '"How to do it" saved',
  },

  checklistHint: 'Written by the AI from the brief; the leader and the owner can change it, and everyone can see it. The AI checks against this list when it reviews.',

  evidence: {
    privacy: {
      GEMINI: "This project is reviewed by the free Gemini; Google may use the content to improve its models. Don't hand in files with ID or phone numbers or other personal details.",
      CLAUDE: "This project is reviewed by Claude; the content is sent to Anthropic to process. Don't hand in files with ID or phone numbers or other personal details.",
      OPENAI: "This project is reviewed by OpenAI; the content is sent to OpenAI to process. Don't hand in files with ID or phone numbers or other personal details.",
    },
    submit: "I'm done, send it for AI review",
    submitHint: (n) => `The AI grades it against the brief and the checklist above, usually within a minute. AI reviews left for this task today: ${n}.`,
    limitHint: "Today's AI reviews are used up, so the leader grades this one. The leader is notified; everyone can open what you hand in.",
    submitted: 'Sent for AI review; usually graded within a minute',
  },

  reviewing: {
    chip: 'AI reviewing',
    emoji: '✨',
    title: 'The AI is reviewing it, usually within a minute',
    hintMine: 'Checking against the brief and the checklist. You can leave; you get a notification when it is graded.',
    hintOthers: 'Checking against the brief and the checklist. The grade and reasons show here when it is done.',
    left: (n, max) => `Reviews left for this task today: ${n} (at most ${max} per task each day).`,
  },

  result: {
    by: (model, when, no) => `AI review · ${model} · ${when} · attempt ${no}`,
    reasons: "The AI's reasons (against the brief)",
    suggestions: 'How to get full points',
    summary: "The AI's summary",
    redo: 'Fix it and resubmit',
    shared: 'Everyone in the team can see the reasons and suggestions.',
    left: (n) => ` AI reviews left for this task today: ${n}`,
    keep: (pts) => `; you keep ${pts} pts while it is re-reviewed`,
    end: '.',
    overrideTitle: "You're the leader",
    overrideHint: 'Think the AI got it wrong? You can override it with a reason everyone can see.',
    overrideMember: (leader) => `Think the AI got it wrong? The leader, ${leader}, can override it.`,
  },

  fallback: {
    title: {
      QUOTA: (leader) => `The AI can't review today (quota used up), so the leader, ${leader}, grades it`,
      KEY: (leader) => `The AI couldn't review it (a problem with the leader's key), so the leader, ${leader}, grades it`,
      LINKS_ONLY: (leader) => `Only links were handed in and the AI can't open links, so the leader, ${leader}, grades it`,
      UNREADABLE: (leader) => `The AI couldn't read the files, so the leader, ${leader}, grades it`,
      ERROR: (leader) => `The AI ran into an error, so the leader, ${leader}, grades it`,
      LIMIT: (leader) => `Today's AI reviews are used up, so the leader, ${leader}, grades it`,
    } as Record<FallbackKey, (leader: string) => string>,
    bodyMine: "You don't need to resubmit or do anything else. You'll be notified when it's graded. Handed in before the due date means it isn't late.",
    bodyOthers: 'The grade and reasons show here once the leader grades it.',
    leader: {
      QUOTA: "Your key's quota is used up for today, so the AI didn't review it; you grade it.",
      KEY: "There's a problem with your key, so the AI didn't review it; you grade it. Check the key on the Me page.",
      LINKS_ONLY: "Only links were handed in and the AI can't open links; you grade it.",
      UNREADABLE: "The AI couldn't read the files; you grade it.",
      ERROR: 'The AI ran into an error; you grade it.',
      LIMIT: "Today's AI reviews are used up; you grade it.",
    } as Record<FallbackKey, string>,
    chip: {
      QUOTA: 'AI quota used up',
      KEY: 'AI key problem',
      LINKS_ONLY: 'Links only',
      UNREADABLE: "AI couldn't read it",
      ERROR: "AI didn't review",
      LIMIT: 'AI reviews used up',
    } as Record<FallbackKey, string>,
  },

  notifs: {
    allLed: 'All projects you lead',
    graded: (g) => {
      const word = labelsEn.grade[g.grade];
      const why = g.reasons > 0 ? ` ${g.reasons === 1 ? '1 reason' : `${g.reasons} reasons`} and how to get full points are on the task page.` : ' The reasons are on the task page.';
      if (!g.counting) return [`Attempt ${g.no}: the AI graded your "${g.title}": `, { b: word }, `, still ${g.earned} pts from before.${why}`];
      const prefix = g.no > 1 ? `Attempt ${g.no}: the AI` : 'The AI';
      if (isFull(g.grade)) return [`${prefix} graded your "${g.title}": `, { b: word }, `, full ${g.pts} pts.`];
      const gain = g.grade === 'HALF' ? `${g.earned} pts for now` : '0 pts; fix it and resubmit';
      return [`${prefix} graded your "${g.title}": `, { b: word }, `, ${gain}.${why}`];
    },
    reviewFailed: {
      QUOTA: (provider, name, title): InlinePart[] =>
        name
          ? [`Your ${provider} key's quota is used up for today, so you grade `, { b: name }, `'s "${title}".`]
          : [`Your ${provider} key's quota is used up for today, so you grade "${title}".`],
      INVALID: (provider, name, title): InlinePart[] =>
        name
          ? [`Your ${provider} key doesn't work any more, so you grade `, { b: name }, `'s "${title}".`]
          : [`Your ${provider} key doesn't work any more, so you grade "${title}".`],
      NO_KEY: (name, title): InlinePart[] =>
        name ? ['Your AI key was deleted, so you grade ', { b: name }, `'s "${title}".`] : [`Your AI key was deleted, so you grade "${title}".`],
      LINKS_ONLY: (title): InlinePart[] => [`"${title}" was handed in as links only and the AI can't open them, so you grade it.`],
      UNREADABLE: (name, title): InlinePart[] =>
        name ? ["The AI couldn't read the files ", { b: name }, ` handed in for "${title}", so you grade it.`] : [`The AI couldn't read the files of "${title}", so you grade it.`],
      LIMIT: (name, title): InlinePart[] =>
        name ? ["Today's AI reviews are used up, so you grade ", { b: name }, `'s "${title}".`] : [`Today's AI reviews are used up, so you grade "${title}".`],
      OTHER: (name, title): InlinePart[] =>
        name ? ["The AI couldn't review it this time, so you grade ", { b: name }, `'s "${title}".`] : [`The AI couldn't review "${title}" this time, so you grade it.`],
    },
    keyQuota: (provider, when): InlinePart[] => [
      `Your ${provider} key's quota is used up for today${when ? `; it comes back ${when}` : ''}. You grade the hand-ins until then.`,
    ],
    keyInvalid: (provider, company): InlinePart[] => [
      `Your ${provider} key doesn't work any more (${company} says it's invalid). You grade the hand-ins for now; replace the key to bring AI reviews back.`,
    ],
    choiceChanged: (prompt, from, to, removed, added): InlinePart[] => [
      `The leader changed the picks for "${prompt}": `,
      { b: `${from} → ${to}` },
      removed > 0 || added > 0
        ? `. ${tasks(removed)} of "${from}" deleted, ${tasks(added)} of "${to}" added; points are rescaled and the total stays 100.`
        : '. Points are rescaled and the total stays 100.',
    ],
    labelSep: ', ',
  },

  feed: {
    CHOICE_CHANGED: (a: Who, prompt, from, to): Inline[] => [{ b: subj(a) }, ` changed the picks for "${prompt}": ${from} → ${to}`],
    GRADED_AI: (owner: Who, title, grade): Inline[] => [{ b: 'The AI' }, ' graded ', { b: possessive(owner) }, ` "${title}": ${grade}`],
    labelSep: ', ',
  },
};
