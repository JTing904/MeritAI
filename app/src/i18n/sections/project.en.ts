import type { Inline, LockedGroup, projectZh, Who } from './project.zh';

const people = (n: number) => (n === 1 ? '1 person' : `${n} people`);
/** At the start of a sentence. */
const subj = (w: Who) => (w.you ? 'You' : w.name);
/** Anywhere else. */
const obj = (w: Who) => (w.you ? 'you' : w.name);
/** "your" / "Lin's". */
const possessive = (w: Who) => (w.you ? 'your' : `${w.name}'s`);
const pkgs = (n: number) => (n === 1 ? '1 package' : `${n} packages`);

/** "a", "b" and "c" */
function andList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export const projectEn: typeof projectZh = {
  settings: 'Project settings',
  sub: {
    leader: (n) => `You're the leader · ${people(n)}`,
    leaderManages: (n) => `You're the leader (you only manage) · ${people(n)}`,
    member: (leader) => `You're a member · Leader: ${leader}`,
    ended: (n) => `Ended · ${people(n)}`,
  },

  hero: {
    due: (date) => `Due ${date}`,
    of: '/ 100 pts',
    ring: (points) => `${points} of 100 points earned`,
    leftEmoji: '⏳',
    daysLeft: (n) => `${n === 1 ? '1 day' : `${n} days`} left`,
    dueToday: 'Due today',
    pastDeadline: 'Past the deadline',
    milestoneEmoji: '🚩',
    milestone: (label, name, date) => `${[label, name].filter(Boolean).join(' ')} · ${date}`,
  },

  needs: {
    pickTitle: "You haven't picked a package",
    pickBody: (n) => `${n === 1 ? '1 package is' : `${n} packages are`} still free. First come, first served!`,
    pick: 'Pick a package',
    waitTitle: "You don't have a package yet",
    waitBody: "All packages are taken. The leader has been asked to re-split them, and you'll be notified when it's done.",
    leaderTitle: 'All packages are taken',
    leaderBody: 'If you want to do tasks too, re-split to make one more package.',
    others: (n) => (n === 1 ? "1 member doesn't have a package yet" : `${n} members don't have a package yet`),
    resplit: 'Re-split',
  },

  tabs: { label: 'Project content', packages: 'Packages', rank: 'Ranking', feed: 'Activity' },

  pkg: {
    mine: 'My package',
    free: 'Not picked yet',
    assign: 'Assign to…',
    overdue: (k) => `${k} overdue`,
    earned: (p) => `${p} pts`,
    total: (p) => `of ${p} pts`,
    totalOnly: (p) => `${p} pts total`,
    move: 'Move task',
    switch: { emoji: '🔁', text: 'Switch or ask to swap' },
  },
  footer:
    "Everyone in the group can see each person's tasks and grades. Tasks waiting for the leader's review don't count as overdue; work handed in after the due date can still be graded, and the report marks it late.",

  rank: {
    podium: 'Podium',
    you: 'You',
    unit: 'pts',
    youSuffix: ' (you)',
    earned: (p) => `${p} pts`,
    packageTotal: (p) => `${p} pts in package`,
    noPackage: 'No package yet',
    empty: 'Nobody has finished a task yet. Once someone does, the ranking shows up here.',
    leftTitle: 'Left',
    left: (name, p) => `${name} · ${p} pts`,
    formula: [
      { b: 'How it counts: ' },
      'The whole project is worth 100 points, and each task is worth part of them. A grade of "Excellent" or "Pass" earns the full points, "Half" earns half, and "Fail" earns 0. Code, reports and meetings all count the same way.',
    ],
    place: (rank, name, p) => `Rank ${rank} · ${name} · ${p} points`,
    row: (rank, name, p, pkg) => `Rank ${rank} · ${name} · ${p} points · ${pkg}`,
  },

  queue: {
    title: (n) => `To review · ${n}`,
    late: 'Late',
    meta: (name, when, n, due) => `${name} · handed in ${when} · ${n === 1 ? '1 item' : `${n} items`}${due ? ` · due ${due}` : ''}`,
    grade: 'Grade',
    gradeLabel: (title, name) => `Grade ${name}'s "${title}"`,
  },

  briefCard: {
    title: 'Assignment brief',
    file: (name) => `${name} · everyone can read the full text`,
    typed: 'Typed description · everyone can read the full text',
  },

  brief: {
    title: 'Assignment brief',
    sub: (tag, name) => `${tag} · ${name}`,
    typed: 'Typed description',
    hint: (file, mine) =>
      `Text read from "${file}", not the original file. Everyone in the group can see it${
        mine ? '; the yellow part is what your current task has to cover.' : '.'
      }`,
    hintTyped: (mine) =>
      `The brief the leader typed in. Everyone in the group can see it${mine ? '; the yellow part is what your current task has to cover.' : '.'}`,
    mine: (title) => `Your task: ${title}`,
    theirs: (name, title) => `${name}'s task: ${title}`,
    nobody: (title) => `Nobody's task yet: ${title}`,
  },

  tools: {
    title: 'Leader tools',
    onlyYou: 'Only you can see this',
    addTask: 'Add task',
    resplit: 'Re-split',
    hint: 'Tap "⋯" next to a task to move it to another package. A package nobody picked can be assigned to someone who has none.',
  },

  addTask: {
    title: 'Add a task',
    name: 'Task name',
    kind: 'Type',
    points: 'Points',
    unit: 'pts',
    due: 'Due date',
    dueSmall: '· optional',
    duePlaceholder: 'Leave empty for the project deadline',
    clearDue: 'Clear due date',
    where: (n): Inline[] => [
      'Once added, it goes ',
      { b: 'into the lightest package right now' },
      `${n ? ` (Package ${n})` : ''}. All tasks' points are rescaled so the total stays 100.`,
    ],
    add: 'Add',
    added: 'Added to the lightest package',
    nameMissing: 'Enter a task name.',
    pointsInvalid: 'Points must be a number from 0.1 to 99.9.',
  },

  move: {
    title: 'Move task',
    question: (title, points) => `Move "${title}" (${points} pts) to which package?`,
    here: "It's here now",
    owned: (n, name) => `Package ${n} · ${name}`,
    you: (name) => `${name} (you)`,
    free: (n) => `Package ${n} · not picked yet`,
    change: (before, after) => `${before} → ${after} pts`,
    hint: "Any unfinished task can move, even one that's half done; submitted evidence goes with it. No one needs to agree, and both people are notified.",
    moved: (n) => `Moved to Package ${n}`,
  },

  assign: {
    title: (n) => `Assign Package ${n}`,
    body: "Assign it to someone who has no package. They'll be notified, and until they start they can still switch to another free package.",
    justJoined: 'Just joined · no package yet',
    noPackage: 'No package yet',
    you: (name) => `${name} (you)`,
    hint: 'Everyone has a package? Re-split first to make one more.',
    assigned: (name) => `Assigned to ${name}`,
  },

  resplit: {
    title: 'Re-split packages',
    intro:
      "Tasks nobody has started are spread evenly again; tasks already started or finished stay with their people. Everyone keeps their own package.",
    count: 'Number of packages',
    minMembers: (n) => `· at least as many as the members now (${people(n)})`,
    minCount: (n) => `· at least ${n}`,
    less: 'Fewer packages',
    more: 'More packages',
    colPackage: 'Package',
    colBefore: 'Before',
    colAfter: 'After',
    owned: (index, name) => `${index} · ${name}`,
    renumbered: (oldIndex) => ` (was Package ${oldIndex})`,
    free: (index) => `${index} · not picked yet`,
    added: (index) => `${index} · new package`,
    removed: (oldIndex) => `${oldIndex} · will be removed`,
    dash: '—',
    locked: (groups: LockedGroup[], _total, rest) =>
      `Tasks already started won't move: ${groups
        .map((g) => `${g.owner ? `${g.owner}'s` : "nobody's"} ${andList(g.titles.map((x) => `"${x}"`))}`)
        .join('; ')}${rest > 0 ? `, and ${rest} more` : ''}.`,
    noneLocked: 'Nobody has started a task yet.',
    // Follows the locked-tasks sentence in the same line.
    freeHint: (names) => ` New packages start grey. ${andList(names)} can pick one, or you can assign them.`,
    apply: 'Re-split',
    confirmTitle: 'Re-split the packages?',
    confirmBody: "Tasks nobody has started will be spread again, and everyone will be notified.",
    confirm: 'Re-split',
    done: 'Packages re-split. Everyone will be notified',
  },

  feed: {
    empty: 'Nothing here yet',
    someone: 'Someone',
    PLAN_CONFIRMED: (a, n) => [{ b: subj(a) }, ` split the tasks into ${pkgs(n)}`],
    JOINED: (a) => [{ b: subj(a) }, ' joined the project'],
    LEFT: (a) => [{ b: subj(a) }, ' left the project'],
    REMOVED: (a, m) => [{ b: subj(a) }, ' removed ', { b: obj(m) }, ' from the project'],
    PICKED: (a, n) => [{ b: subj(a) }, ` picked Package ${n}`],
    SWITCHED: (a, from, to) => [{ b: subj(a) }, ` switched from Package ${from} to Package ${to}`],
    SWAPPED: (a, requester) => [{ b: subj(a) }, ` accepted ${requester.you ? 'your' : `${requester.name}'s`} swap request`],
    ASSIGNED: (a, n, m) => [{ b: subj(a) }, ` assigned Package ${n} to `, { b: obj(m) }],
    TASK_ADDED: (a, title, n) => [{ b: subj(a) }, ` added a new task "${title}" to Package ${n}`],
    TASK_MOVED: (a, title, from, to) => [{ b: subj(a) }, ` moved "${title}" from Package ${from} to Package ${to}`],
    TASK_STARTED: (a, title) => [{ b: subj(a) }, ` started "${title}"`],
    RESPLIT: (a, n) => [{ b: subj(a) }, ` re-split the packages; there are now ${pkgs(n)}`],
    LEADER_TRANSFERRED: (a, m) => [{ b: subj(a) }, ' handed the leader role to ', { b: obj(m) }],
    TASK_MOVED_UNPACKAGED: (a, title, to) => [{ b: subj(a) }, ` moved "${title}" to Package ${to}`],
    SUBMITTED: (a, title, no) =>
      no > 1 ? [{ b: subj(a) }, ` resubmitted "${title}" (attempt ${no})`] : [{ b: subj(a) }, ` handed in "${title}" for the leader to review`],
    WITHDRAWN: (a, title) => [{ b: subj(a) }, ` withdrew "${title}"`],
    GRADED: (a, owner, title, grade) => [{ b: subj(a) }, ' graded ', { b: possessive(owner) }, ` "${title}": ${grade}`],
    GRADED_SELF: (a, title) => [{ b: subj(a) }, ` handed in "${title}", counted as Pass (the leader's own task)`],
    GRADED_OUTSIDE: (a, owner, title, grade) => [
      { b: subj(a) },
      ' completed ',
      { b: possessive(owner) },
      ` "${title}" on their behalf: ${grade}`,
    ],
    OVERRIDDEN: (a, owner, title, from, to) => [{ b: subj(a) }, ' changed ', { b: possessive(owner) }, ` "${title}" from ${from} to ${to}`],
    OVERRIDE_UNDONE: (a, title, to) => [{ b: subj(a) }, ` undid the override of "${title}", back to ${to}`],
    MEETING_DONE: (a, title, n) => [{ b: subj(a) }, ` held "${title}", ${people(n)} came`],
    START_UNDONE: (a, title) => [{ b: subj(a) }, ` undid starting "${title}"`],
    PREREQ_SET: (a, waiting, prereq, prereqOwner) => [
      { b: subj(a) },
      ` marked "${waiting}" as waiting for "${prereq}"${prereqOwner ? ` (${obj(prereqOwner)})` : ''}`,
    ],
    PREREQ_CLEARED: (a, waiting) => [{ b: subj(a) }, ` removed what "${waiting}" was waiting for`],
    PROJECT_DELETED: (a) => [{ b: subj(a) }, ' deleted the project'],
    PROJECT_RESTORED: (a) => [{ b: subj(a) }, ' restored the project'],
    PROJECT_ENDED: (a) => [{ b: subj(a) }, ' ended the project'],
    PROJECT_ENDED_AUTO: () => ['Nobody acted for 7 days after the deadline, so the project ended by itself'],
    PROJECT_REOPENED: (a, date) => [{ b: subj(a) }, ` reopened the project; the new deadline is ${date}`],
    TASK_DELAYED: (a, title, date) => [{ b: subj(a) }, ` moved "${title}" later, to ${date}`],
  },

  task: {
    title: 'Task details',
    sub: (tag, n) => (n ? `${tag} · Package ${n}` : tag),
    due: (date) => `⏰ ${date}`,
    ownerYou: 'Owner: you',
    owner: (name) => `Owner: ${name}`,
    noOwner: 'Nobody owns it',
    start: 'Start',
    started: "Started. Now that you've started, you can't switch or swap packages directly.",
    devTitle: 'Developer test',
    devHint: "Only in development builds: set this task's status directly to test starting and scoring.",
  },
};
