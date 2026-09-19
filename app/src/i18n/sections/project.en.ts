import type { Inline, LockedGroup, projectZh, Who } from './project.zh';

const people = (n: number) => (n === 1 ? '1 person' : `${n} people`);
/** At the start of a sentence. */
const subj = (w: Who) => (w.you ? 'You' : w.name);
/** Anywhere else. */
const obj = (w: Who) => (w.you ? 'you' : w.name);
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
  footer: "Everyone in the group can see each person's tasks and AI review results.",

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
